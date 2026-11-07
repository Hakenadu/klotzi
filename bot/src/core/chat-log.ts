import type { ChatLine } from './brain.ts';

/** Eine gemerkte Chat-Nachricht. */
export interface LoggedMessage extends ChatLine {
  id: string;
  /** Zeitpunkt in ms seit 1970. */
  at: number;
}

export interface ChatLogOptions {
  /** Wie weit Klotzi zurückblickt (Stunden). */
  hours: number;
  /** Höchstens so viele Nachrichten pro Kanal. */
  maxMessages: number;
  /** Höchstens so viele Zeichen Verlauf pro Anfrage (älteste fliegen zuerst raus). */
  maxChars: number;
}

/** Lädt ältere Nachrichten eines Kanals nach (z. B. über die Discord-API). */
export type Backfill = (since: number) => Promise<LoggedMessage[]>;

interface ChannelState {
  messages: Map<string, LoggedMessage>;
  backfill?: Promise<void>;
}

/**
 * Klotzis Kurzzeitgedächtnis: der Chatverlauf der letzten Stunden pro Kanal.
 *
 * Neue Nachrichten kommen live über die Discord-Events herein. Beim ersten
 * Zugriff auf einen Kanal wird einmalig nachgeladen, was vor dem Start
 * geschrieben wurde – danach braucht es keine weiteren API-Aufrufe.
 */
export class ChatLog {
  private readonly channels = new Map<string, ChannelState>();

  constructor(
    private readonly options: ChatLogOptions,
    private readonly clock: () => number = Date.now,
  ) {}

  private channel(channelId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) this.channels.set(channelId, (state = { messages: new Map() }));
    return state;
  }

  private get since(): number {
    return this.clock() - this.options.hours * 60 * 60 * 1000;
  }

  /** Neue oder bearbeitete Nachricht merken. */
  record(channelId: string, message: LoggedMessage): void {
    const state = this.channel(channelId);
    state.messages.set(message.id, message);
    this.prune(state);
  }

  /** Inhalt einer bekannten Nachricht aktualisieren (Bearbeitung). */
  edit(channelId: string, id: string, content: string): void {
    const existing = this.channels.get(channelId)?.messages.get(id);
    if (existing) existing.content = content;
  }

  remove(channelId: string, id: string): void {
    this.channels.get(channelId)?.messages.delete(id);
  }

  /**
   * Der Verlauf eines Kanals, chronologisch. Beim ersten Aufruf pro Kanal wird
   * über `backfill` nachgeladen. Mit `limit` nur die letzten N Nachrichten.
   */
  async recent(channelId: string, backfill?: Backfill, limit?: number): Promise<LoggedMessage[]> {
    const state = this.channel(channelId);
    if (backfill && !state.backfill) {
      state.backfill = backfill(this.since)
        .then((older) => {
          for (const m of older) if (!state.messages.has(m.id)) state.messages.set(m.id, m);
        })
        .catch(() => {
          // beim nächsten Mal erneut versuchen
          state.backfill = undefined;
        });
    }
    await state.backfill;
    this.prune(state);

    let lines = [...state.messages.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    if (limit !== undefined) lines = lines.slice(-Math.max(1, limit));
    // Zeichenbudget: von hinten auffüllen, die neueste Nachricht ist immer dabei
    let chars = 0;
    let start = lines.length;
    while (start > 0) {
      chars += lines[start - 1]!.content.length + lines[start - 1]!.author.length;
      if (chars > this.options.maxChars && start < lines.length) break;
      start--;
    }
    return lines.slice(start);
  }

  private prune(state: ChannelState): void {
    const since = this.since;
    for (const [id, m] of state.messages) if (m.at < since) state.messages.delete(id);
    const overflow = state.messages.size - this.options.maxMessages;
    if (overflow > 0) {
      const oldest = [...state.messages.values()].sort((a, b) => a.at - b.at).slice(0, overflow);
      for (const m of oldest) state.messages.delete(m.id);
    }
  }
}
