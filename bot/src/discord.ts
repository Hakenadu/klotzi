import {
  ApplicationCommandType,
  AttachmentBuilder,
  ChannelType,
  Client,
  Events,
  MessageFlags,
  GatewayIntentBits,
  Partials,
  type ApplicationCommandDataResolvable,
  type Interaction,
  type Message,
} from 'discord.js';
import type { Brain, ChatLine } from './core/brain.ts';
import { ChatLog, type LoggedMessage } from './core/chat-log.ts';
import type { KlotziContext, Situation } from './core/skill.ts';
import { commandJson, type SkillRegistry } from './core/skill-registry.ts';

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
      // Wer sitzt in welchem Sprach-Channel? (für den Voice-Skill, nicht privilegiert)
      GatewayIntentBits.GuildVoiceStates,
      // Privilegiert: im Developer-Portal unter "Bot" aktivieren!
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
}

/** Kommt "Klotzi" irgendwo im Text vor – auch in "Klotzis", "@klotzi" oder "Klotzilein"? */
export function mentionsKlotzi(text: string): boolean {
  return /klotzi/i.test(text);
}

/** Teilt lange Antworten in Discord-taugliche Stücke (max. 2000 Zeichen). */
export function splitMessage(text: string, limit = 2000): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Verbindet Discord-Events mit Klotzis Gehirn, den Skills und der Bühne.
 */
export class KlotziBot {
  private readonly userCooldowns = new Map<string, number>();
  private readonly ambientCooldowns = new Map<string, number>();
  /** Kanäle, in denen Klotzi nach einer eigenen Nachricht noch mitlauscht. */
  private readonly listening = new Map<string, { remaining: number; until: number }>();
  private readonly chatLog: ChatLog;
  private readonly log;

  constructor(
    private readonly ctx: KlotziContext,
    private readonly skills: SkillRegistry,
    private readonly brain: Brain,
  ) {
    this.log = ctx.log.child('discord');
    const { chat } = ctx.config;
    this.chatLog = new ChatLog({
      hours: chat.historyHours,
      maxMessages: chat.historyMaxMessages,
      maxChars: chat.historyMaxChars,
    });
  }

  attach(): void {
    const { client } = this.ctx;
    client.once(Events.ClientReady, async (c) => {
      this.log.info(`Eingeloggt als ${c.user.tag} – Wuff! 🔥`);
      await this.registerCommands().catch((err) => this.log.error('Slash-Commands konnten nicht registriert werden', err));
    });
    client.on(Events.MessageCreate, (message) => {
      // alles mitschreiben – auch Klotzis eigene Nachrichten und andere Bots
      this.record(message);
      this.onMessage(message).catch((err) => this.log.error('Fehler bei Nachricht', err));
    });
    client.on(Events.MessageUpdate, (_old, message) => {
      if (!message.partial) this.chatLog.edit(message.channelId, message.id, this.cleanContent(message));
    });
    client.on(Events.MessageDelete, (message) => this.chatLog.remove(message.channelId, message.id));
    client.on(Events.InteractionCreate, (interaction) => {
      this.onInteraction(interaction).catch((err) => this.log.error('Fehler bei Interaktion', err));
    });
  }

  // ───────────────────────────── Slash-Commands ─────────────────────────────

  private async registerCommands(): Promise<void> {
    const { client, config } = this.ctx;
    const commands: ApplicationCommandDataResolvable[] = this.skills
      .allCommands()
      .map((c) => commandJson(c) as ApplicationCommandDataResolvable);

    if (config.discord.guildId) {
      const guild = await client.guilds.fetch(config.discord.guildId);
      await guild.commands.set(commands);
      this.log.info(`${commands.length} Slash-Commands in Guild ${guild.name} registriert`);
      return;
    }
    // Globale Commands: der "Entry Point"-Command der Activity darf beim
    // Überschreiben nicht verloren gehen, sonst lehnt Discord die Anfrage ab.
    const existing = await client.application!.commands.fetch();
    const entryPoints = existing
      .filter((c) => c.type === ApplicationCommandType.PrimaryEntryPoint)
      .map((c) => ({ name: c.name, description: c.description, type: c.type, handler: (c as any).handler }) as any);
    await client.application!.commands.set([...commands, ...entryPoints]);
    this.log.info(`${commands.length} globale Slash-Commands registriert`);
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    const command = this.skills.getCommand(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, this.ctx);
    } catch (err) {
      this.log.error(`/${interaction.commandName} fehlgeschlagen`, err);
      const content = 'Wuff… da ist etwas angebrannt. 🔥 Versuch es gleich nochmal.';
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  }

  // ───────────────────────────── Chat ─────────────────────────────

  private isAddressed(message: Message): boolean {
    const { client, config } = this.ctx;
    if (message.channel.type === ChannelType.DM) return true;
    if (config.chat.channelIds.includes(message.channelId)) return true;
    if (message.mentions.users.has(client.user!.id)) return true;
    if (message.mentions.repliedUser?.id === client.user!.id) return true;
    return config.chat.respondToName && mentionsKlotzi(message.content);
  }

  private async onMessage(message: Message): Promise<void> {
    if (message.author.bot || message.system) return;
    const { stage } = this.ctx;

    stage.broadcast(message.guildId, { type: 'notice', author: message.member?.displayName ?? message.author.username });

    if (await this.skills.runMessageHooks(message, this.ctx)) return;

    if (this.isAddressed(message) || (await this.isFollowUp(message))) {
      if (this.onCooldown(this.userCooldowns, message.author.id, this.ctx.config.chat.userCooldown)) {
        // keine neue OpenAI-Anfrage, aber in der Activity reagiert Klotzi trotzdem
        stage.animate(message.guildId, 'happy');
        return;
      }
      await this.reply(message);
    } else if (message.guildId && Math.random() < this.ctx.config.chat.ambientChance) {
      if (this.onCooldown(this.ambientCooldowns, message.channelId, this.ctx.config.chat.ambientCooldown)) return;
      await this.react(message);
    }
  }

  // ───────────────────────────── Nachlauschen ─────────────────────────────

  /** Nachdem Klotzi etwas gesagt hat, hört er noch ein paar Nachrichten lang genauer hin. */
  private listen(channelId: string): void {
    const { followUpMessages, followUpMinutes } = this.ctx.config.chat;
    if (followUpMessages <= 0) return;
    const until = followUpMinutes > 0 ? Date.now() + followUpMinutes * 60_000 : Infinity;
    this.listening.set(channelId, { remaining: followUpMessages, until });
  }

  /** Zählt eine Nachricht vom Lausch-Kontingent ab. `true`, wenn Klotzi noch zuhört. */
  private consumeListening(channelId: string): boolean {
    const state = this.listening.get(channelId);
    if (!state) return false;
    if (Date.now() > state.until) {
      this.listening.delete(channelId);
      return false;
    }
    if (--state.remaining <= 0) this.listening.delete(channelId);
    return true;
  }

  /**
   * Bezieht sich eine Nachricht ohne "Klotzi" trotzdem auf ihn? Wird nur kurz
   * nach Klotzis eigenen Nachrichten über die Decisions API geprüft.
   */
  private async isFollowUp(message: Message): Promise<boolean> {
    if (!this.consumeListening(message.channelId)) return false;
    try {
      const history = await this.history(message, this.ctx.config.chat.historyLimit);
      const probability = await this.brain.isAboutKlotzi(history);
      const yes = probability >= this.ctx.config.chat.followUpThreshold;
      this.log.debug(`Nachlauschen: "${message.content.slice(0, 60)}" → ${probability.toFixed(2)} (${yes ? 'antworten' : 'ignorieren'})`);
      return yes;
    } catch (err) {
      this.log.warn('Nachlauschen fehlgeschlagen', err);
      return false;
    }
  }

  private onCooldown(map: Map<string, number>, key: string, seconds: number): boolean {
    const now = Date.now();
    if ((map.get(key) ?? 0) > now) return true;
    map.set(key, now + seconds * 1000);
    return false;
  }

  private situation(message: Message): Situation {
    return {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      userName: message.member?.displayName ?? message.author.displayName,
      message,
    };
  }

  // ───────────────────────────── Verlauf ─────────────────────────────

  private toLogged(m: Message): LoggedMessage {
    return {
      id: m.id,
      at: m.createdTimestamp,
      author: m.member?.displayName ?? m.author.displayName,
      fromKlotzi: m.author.id === this.ctx.client.user?.id,
      content: this.cleanContent(m),
    };
  }

  private record(message: Message): void {
    if (message.system) return;
    const line = this.toLogged(message);
    if (line.content.trim()) this.chatLog.record(message.channelId, line);
  }

  /** Lädt einmalig pro Kanal die Nachrichten der letzten Stunden über die Discord-API nach. */
  private async backfill(message: Message, since: number): Promise<LoggedMessage[]> {
    const max = this.ctx.config.chat.historyMaxMessages;
    const lines: LoggedMessage[] = [];
    let before: string | undefined;
    while (lines.length < max) {
      const batch = await message.channel.messages.fetch({ limit: Math.min(100, max - lines.length), before });
      if (batch.size === 0) break;
      let reachedEnd = false;
      for (const m of batch.values()) {
        if (m.createdTimestamp < since) {
          reachedEnd = true;
          continue;
        }
        if (m.system) continue;
        const line = this.toLogged(m);
        if (line.content.trim()) lines.push(line);
      }
      if (reachedEnd || batch.size < 100) break;
      before = batch.last()!.id;
    }
    this.log.debug(`Verlauf für #${message.channelId} nachgeladen: ${lines.length} Nachrichten`);
    return lines;
  }

  /** Der Chatverlauf als Kontext für das Gehirn: die letzten Stunden, oder nur die letzten `limit` Nachrichten. */
  private async history(message: Message, limit?: number): Promise<ChatLine[]> {
    return this.chatLog.recent(message.channelId, (since) => this.backfill(message, since), limit);
  }

  private cleanContent(message: Message): string {
    let text = message.cleanContent;
    if (message.attachments.size) text += ` [${message.attachments.size} Anhang/Anhänge]`;
    return text.slice(0, 1500);
  }

  private async reply(message: Message): Promise<void> {
    const { stage, log } = this.ctx;
    const situation = this.situation(message);
    // Hat das Modell selbst eine Animation gewählt? Wenn nicht, springt Klotzi trotzdem sichtbar an.
    let animated = false;
    const onAnimate = (guildId: string) => {
      if (guildId === message.guildId) animated = true;
    };
    stage.on('animate', onAnimate);
    stage.thinking(message.guildId, true);
    const typing = setInterval(() => void sendTyping(message), 8000);
    void sendTyping(message);
    try {
      const { text, files } = await this.brain.reply(situation, await this.history(message));
      if (!animated) stage.animate(message.guildId, 'happy');
      if (text) stage.say(message.guildId, text, situation.userName);
      const [first, ...rest] = splitMessage(text);
      if (first || files.length) {
        await message.reply({
          content: first ?? '',
          files: files.map((f) => new AttachmentBuilder(f.data, { name: f.name, description: f.description?.slice(0, 1000) })),
          allowedMentions: { repliedUser: false },
        });
      }
      for (const part of rest) if (message.channel.isSendable()) await message.channel.send(part);
      this.listen(message.channelId);
    } catch (err) {
      log.error('Antwort fehlgeschlagen', err);
      stage.animate(message.guildId, 'confused');
      await message.reply('*jault leise* Mein Höllenfeuer flackert gerade… versuch es gleich nochmal. 🔥').catch(() => {});
    } finally {
      stage.off('animate', onAnimate);
      clearInterval(typing);
      stage.thinking(message.guildId, false);
    }
  }

  private async react(message: Message): Promise<void> {
    const { stage, log } = this.ctx;
    try {
      const reaction = await this.brain.react(
        this.situation(message),
        await this.history(message, this.ctx.config.chat.historyLimit),
      );
      log.debug('Spontane Reaktion', reaction);
      if (reaction.animation !== 'idle') stage.animate(message.guildId, reaction.animation);
      if (reaction.emoji) await message.react(reaction.emoji).catch(() => {});
      if (reaction.comment) {
        stage.say(message.guildId, reaction.comment);
        if (message.channel.isSendable()) await message.channel.send(reaction.comment);
        this.listen(message.channelId);
      }
    } catch (err) {
      log.warn('Spontane Reaktion fehlgeschlagen', err);
    }
  }
}

async function sendTyping(message: Message): Promise<void> {
  if ('sendTyping' in message.channel) await message.channel.sendTyping().catch(() => {});
}
