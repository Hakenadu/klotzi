import { Readable } from 'node:stream';
import { ChannelType, Events, PermissionFlagsBits, type Guild } from 'discord.js';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from '@discordjs/voice';
import type { AnimationName } from '@klotzi/shared';
import { defineSkill, type KlotziContext } from '../core/skill.ts';
import { renderAnimation, toPcmStereo } from './_sounds.ts';

/** Ein Sprach-Channel, den Klotzi betreten könnte. */
export interface VoiceCandidate {
  id: string;
  /** Anzahl Menschen (keine Bots) im Channel. */
  humans: number;
}

/**
 * Entscheidet, in welchem Sprach-Channel Klotzi sein soll:
 * Er bleibt, solange in seinem Channel noch Menschen sind, sonst geht er dorthin,
 * wo die meisten sind – und ist niemand mehr da, verlässt er den Sprach-Chat (`null`).
 */
export function pickVoiceChannel(candidates: VoiceCandidate[], currentId: string | null): string | null {
  const current = candidates.find((c) => c.id === currentId);
  if (current && current.humans > 0) return current.id;
  const best = candidates.filter((c) => c.humans > 0).sort((a, b) => b.humans - a.humans)[0];
  return best?.id ?? null;
}

/** Kurz warten, bevor Klotzi reagiert – sonst springt er bei schnellem Channel-Wechsel hin und her. */
const SETTLE_MS = 1500;

let ctx: KlotziContext;
let log: KlotziContext['log'];
const timers = new Map<string, NodeJS.Timeout>();
const players = new Map<string, AudioPlayer>();
const soundCache = new Map<AnimationName, Buffer | null>();

/** Alle Sprach-Channels der Guild, die Klotzi betreten darf und will. */
function candidates(guild: Guild): VoiceCandidate[] {
  const me = guild.members.me;
  if (!me) return [];
  const allowed = ctx.config.voice.channelIds;
  const currentId = me.voice.channelId;
  const result: VoiceCandidate[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice) continue;
    if (channel.id === guild.afkChannelId) continue;
    if (allowed.length && !allowed.includes(channel.id)) continue;
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) continue;
    if (channel.id !== currentId && !channel.joinable) continue; // z. B. voll
    const humans = guild.voiceStates.cache.filter(
      (s) => s.channelId === channel.id && s.id !== ctx.client.user?.id && !s.member?.user.bot,
    ).size;
    result.push({ id: channel.id, humans });
  }
  return result;
}

/** Nach einer Änderung kurz abwarten und dann prüfen, wo Klotzi hin soll. */
function schedule(guild: Guild): void {
  clearTimeout(timers.get(guild.id));
  timers.set(
    guild.id,
    setTimeout(() => {
      timers.delete(guild.id);
      reconcile(guild).catch((err) => log.warn(`Sprach-Channel in ${guild.name} fehlgeschlagen`, err));
    }, SETTLE_MS),
  );
}

async function reconcile(guild: Guild): Promise<void> {
  const currentId = guild.members.me?.voice.channelId ?? null;
  const targetId = pickVoiceChannel(candidates(guild), currentId);
  const connection = getVoiceConnection(guild.id);

  if (!targetId) {
    if (connection) {
      log.info(`Niemand mehr im Sprach-Chat von ${guild.name} – Klotzi trottet raus 🐾`);
      connection.destroy();
    }
    return;
  }
  if (targetId === currentId && connection && connection.state.status !== VoiceConnectionStatus.Destroyed) return;

  const channel = guild.channels.cache.get(targetId);
  log.info(`Klotzi springt in den Sprach-Channel ${channel?.name ?? targetId} (${guild.name}) 🔥`);
  const fresh = !connection || connection.state.status === VoiceConnectionStatus.Destroyed;
  const next = joinVoiceChannel({
    guildId: guild.id,
    channelId: targetId,
    // discord.js und @discordjs/voice bringen leicht unterschiedliche Typversionen mit
    adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
    selfDeaf: true, // Klotzi hört nicht mit – er braucht nur seine eigene Stimme
    selfMute: false,
  });
  if (fresh) watch(guild, next);
  next.subscribe(player(guild.id));

  try {
    await entersState(next, VoiceConnectionStatus.Ready, 20_000);
    ctx.stage.animate(guild.id, 'happy'); // Begrüßungs-Wuff (spielt auch in der Activity)
  } catch {
    log.warn(`Verbindung zum Sprach-Channel in ${guild.name} kam nicht zustande`);
    next.destroy();
  }
}

/** Verbindungsabbrüche abfangen: kurz auf Wiederverbindung warten, sonst sauber neu entscheiden. */
function watch(guild: Guild, connection: VoiceConnection): void {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Discord verschiebt die Verbindung nur (z. B. Channel-Wechsel) – das regelt sich von selbst
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      // wirklich getrennt (z. B. rausgeworfen) – aufräumen und neu entscheiden
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      schedule(guild);
    }
  });
}

function player(guildId: string): AudioPlayer {
  let p = players.get(guildId);
  if (!p) {
    p = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    p.on('error', (err) => log.warn('Geräusch konnte nicht abgespielt werden', err));
    players.set(guildId, p);
  }
  return p;
}

function sound(animation: AnimationName): Buffer | null {
  if (!soundCache.has(animation)) {
    const mono = renderAnimation(animation, ctx.config.voice.volume);
    soundCache.set(animation, mono ? toPcmStereo(mono) : null);
  }
  return soundCache.get(animation)!;
}

/** Spielt das Geräusch zur Animation im Sprach-Channel – das neueste gewinnt. */
function playFor(guildId: string, animation: AnimationName): void {
  const connection = getVoiceConnection(guildId);
  if (connection?.state.status !== VoiceConnectionStatus.Ready) return;
  const pcm = sound(animation);
  if (!pcm) return;
  const p = player(guildId);
  if (p.state.status !== AudioPlayerStatus.Idle) p.stop(true);
  p.play(createAudioResource(Readable.from([pcm]), { inputType: StreamType.Raw }));
}

/** Klotzi setzt sich automatisch zu den Leuten in den Sprach-Chat und bellt dort hörbar mit. */
export default defineSkill({
  name: 'voice',
  description: 'Klotzi setzt sich automatisch zu euch in den Sprach-Chat und bellt, jault und knurrt dort hörbar mit.',
  setup(context) {
    ctx = context;
    log = context.log.child('voice');
    const { client, stage, config } = context;

    client.once(Events.ClientReady, () => {
      for (const guild of client.guilds.cache.values()) schedule(guild);
    });
    client.on(Events.VoiceStateUpdate, (before, after) => {
      schedule(after.guild);
      if (before.guild.id !== after.guild.id) schedule(before.guild);
    });
    client.on(Events.GuildCreate, (guild) => schedule(guild));
    client.on(Events.GuildDelete, (guild) => getVoiceConnection(guild.id)?.destroy());

    if (config.voice.sounds) stage.on('animate', (guildId, animation) => playFor(guildId, animation));
  },
});
