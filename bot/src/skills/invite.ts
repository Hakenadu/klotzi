import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Events,
  InviteTargetType,
  PermissionFlagsBits,
  type Message,
  type VoiceBasedChannel,
} from 'discord.js';
import { defineSkill, type KlotziContext } from '../core/skill.ts';

/** Klotzis Fragen, ob er mitmachen darf – `{link}` wird durch den Einladungslink ersetzt. */
export const INVITE_LINES = [
  '*wedelt aufgeregt* Wuff! Ihr seid im Sprach-Chat! 🔥 Darf ich mitmachen? Dann klickt hier: {link}',
  '*spitzt die Ohren* Ich hör da Stimmen… darf ich mit in den Call? 🐾 {link}',
  '*setzt sich brav hin und schaut mit großen Glutaugen* Darf ich auch dabei sein? 🔥 {link}',
  'Wuff wuff! Ein Sprach-Chat! Holt ihr mich dazu? Ein Klick und ich bin da 🐾 {link}',
];

export function inviteText(link: string, random = Math.random): string {
  const line = INVITE_LINES[Math.floor(random() * INVITE_LINES.length)] ?? INVITE_LINES[0]!;
  return line.replace('{link}', link);
}

/**
 * Hat gerade ein Sprach-Chat angefangen? Das ist der Fall, wenn ein Mensch einen
 * Channel betritt, in dem vorher niemand war – und Klotzi nicht erst vor Kurzem gefragt hat.
 */
export function isVoiceChatStart(opts: {
  humansAfter: number;
  lastInviteAt: number | undefined;
  now: number;
  cooldownMs: number;
}): boolean {
  if (opts.humansAfter !== 1) return false;
  return opts.lastInviteAt === undefined || opts.now - opts.lastInviteAt >= opts.cooldownMs;
}

let ctx: KlotziContext;
let log: KlotziContext['log'];
/** Wann hat Klotzi zuletzt in diesem Channel gefragt? */
const lastInvite = new Map<string, number>();
/** Klotzis letzte Frage pro Channel – wird durch die nächste ersetzt, damit sich nichts stapelt. */
const openInvites = new Map<string, Message>();

function humansIn(channel: VoiceBasedChannel): number {
  return channel.members.filter((m) => !m.user.bot).size;
}

function allowed(channel: VoiceBasedChannel): boolean {
  if (channel.type !== ChannelType.GuildVoice) return false; // Stage-Channels haben keine Activities
  if (channel.id === channel.guild.afkChannelId) return false;
  const only = ctx.config.voice.channelIds;
  return only.length === 0 || only.includes(channel.id);
}

/** Wohin schreibt Klotzi? Standard ist der Text-Chat des Sprach-Channels selbst. */
async function targetChannel(voice: VoiceBasedChannel) {
  const id = ctx.config.voice.inviteChannelId;
  const channel = id ? await voice.guild.channels.fetch(id).catch(() => null) : voice;
  return channel?.isSendable() ? channel : null;
}

async function invite(voice: VoiceBasedChannel): Promise<void> {
  const me = voice.guild.members.me;
  if (!me) return;
  if (!voice.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite)) {
    log.warn(`Keine Berechtigung "Einladung erstellen" in ${voice.name} – Klotzi kann nicht fragen`);
    return;
  }
  const target = await targetChannel(voice);
  if (!target) {
    log.warn(`Kein Text-Chat für die Einladung zu ${voice.name} gefunden`);
    return;
  }

  // Eine Einladung, die direkt in den Sprach-Channel führt und dort Klotzis Activity startet.
  const link = await voice.createInvite({
    targetType: InviteTargetType.EmbeddedApplication,
    targetApplication: ctx.config.discord.clientId,
    maxAge: 12 * 60 * 60,
    unique: false,
    reason: 'Klotzi möchte im Sprach-Chat mitmachen',
  });

  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(link.url)
    .setLabel('Klotzi in den Call holen')
    .setEmoji('🔥');
  const message = await target.send({
    content: inviteText(link.url),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  });
  const previous = openInvites.get(voice.id);
  openInvites.set(voice.id, message);
  if (previous) await previous.delete().catch(() => {});
  ctx.stage.animate(voice.guild.id, 'happy');
  log.info(`Klotzi fragt in ${voice.name} (${voice.guild.name}), ob er mitmachen darf 🐾`);
}

/** Beim Start eines Sprach-Chats fragt Klotzi mit einem Klick-Link, ob er per Activity mitmachen darf. */
export default defineSkill({
  name: 'invite',
  description: 'Beginnt ein Sprach-Chat, fragt Klotzi im Chat per Link, ob er mitmachen darf – ein Klick startet seine Activity im Call.',
  setup(context) {
    ctx = context;
    log = context.log.child('invite');
    if (!context.config.voice.invite) return;

    context.client.on(Events.VoiceStateUpdate, (before, after) => {
      if (before.channelId === after.channelId) return; // nur Stummschalten o. Ä.
      if (after.member?.user.bot) return;

      const joined = after.channel;
      if (!joined || !allowed(joined)) return;
      const now = Date.now();
      const start = isVoiceChatStart({
        humansAfter: humansIn(joined),
        lastInviteAt: lastInvite.get(joined.id),
        now,
        cooldownMs: context.config.voice.inviteCooldown * 60_000,
      });
      if (!start) return;
      lastInvite.set(joined.id, now);
      invite(joined).catch((err) => log.warn(`Einladung für ${joined.name} fehlgeschlagen`, err));
    });
  },
});
