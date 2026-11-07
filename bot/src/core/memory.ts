import fs from 'node:fs';
import path from 'node:path';

/** Wie wichtig eine Erinnerung ist: 1 = Kleinkram, 2 = normal, 3 = sehr wichtig. */
export type Importance = 1 | 2 | 3;

export interface MemoryEntry {
  /** Laufende Nummer – stabil, solange der Prozess läuft (wird nicht in der Datei gespeichert). */
  id: number;
  text: string;
  importance: Importance;
  /** Angelegt am (YYYY-MM-DD). */
  created: string;
  /** Zuletzt bestätigt / aufgefrischt am (YYYY-MM-DD). */
  lastSeen: string;
}

export interface MemoryLimits {
  /** Maximale Anzahl an Erinnerungen. */
  maxEntries: number;
  /** Maximale Gesamtlänge aller Erinnerungstexte (Zeichen). */
  maxChars: number;
}

const DAY = 24 * 60 * 60 * 1000;
/** So viele Tage "trägt" eine Wichtigkeitsstufe, bevor eine Erinnerung als veraltet gilt. */
const DAYS_PER_IMPORTANCE = 30;
const MAX_TEXT = 300;

const HEADER = `# Klotzis Gedächtnis

<!--
  Diese Datei pflegt Klotzi selbst. Sie darf auch von Hand bearbeitet werden.
  Format pro Zeile:  - ★★ Text _(angelegt JJJJ-MM-TT, zuletzt JJJJ-MM-TT)_
  ★ = Kleinkram, ★★ = normal, ★★★ = sehr wichtig.
  Ist das Gedächtnis voll, verdrängt Klotzi die unwichtigsten und am längsten
  nicht mehr bestätigten Erinnerungen.
-->
`;

const LINE = /^-\s+(★{1,3})\s+(.+?)\s+_\(angelegt (\d{4}-\d{2}-\d{2}), zuletzt (\d{4}-\d{2}-\d{2})\)_\s*$/;

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function clampImportance(value: unknown): Importance {
  const n = Math.round(Number(value));
  return n >= 3 ? 3 : n <= 1 ? 1 : 2;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/**
 * Wie "relevant" ist eine Erinnerung gerade? Wichtigkeit hält eine Erinnerung
 * frisch, das Alter seit der letzten Bestätigung lässt sie verblassen.
 */
export function relevance(entry: Pick<MemoryEntry, 'importance' | 'lastSeen'>, now = new Date()): number {
  const age = Math.max(0, (now.getTime() - Date.parse(entry.lastSeen)) / DAY);
  return entry.importance * DAYS_PER_IMPORTANCE - age;
}

/**
 * Klotzis Langzeitgedächtnis: eine `MEMORY.md` im Datenverzeichnis, die über
 * Neustarts hinweg erhalten bleibt. Das Gedächtnis ist begrenzt – wird es zu
 * voll, werden die am wenigsten relevanten Einträge verdrängt.
 */
export class Memory {
  private entries: MemoryEntry[] = [];
  private nextId = 1;
  private timer: NodeJS.Timeout | undefined;
  readonly file: string;

  constructor(
    dataDir: string,
    readonly limits: MemoryLimits,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.file = path.join(dataDir, 'MEMORY.md');
    this.load();
  }

  list(): readonly MemoryEntry[] {
    return this.entries;
  }

  get(id: number): MemoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Neue Erinnerung anlegen. Gibt es sie schon, wird sie nur aufgefrischt. */
  add(text: string, importance: unknown = 2): { entry: MemoryEntry; evicted: MemoryEntry[] } {
    const clean = cleanText(text);
    if (!clean) throw new Error('leere Erinnerung');
    const now = today(this.clock());
    const existing = this.entries.find((e) => e.text.toLowerCase() === clean.toLowerCase());
    if (existing) {
      existing.lastSeen = now;
      existing.importance = Math.max(existing.importance, clampImportance(importance)) as Importance;
      this.save();
      return { entry: existing, evicted: [] };
    }
    const entry: MemoryEntry = { id: this.nextId++, text: clean, importance: clampImportance(importance), created: now, lastSeen: now };
    this.entries.push(entry);
    const evicted = this.evict(entry.id);
    this.save();
    return { entry, evicted };
  }

  /** Erinnerung ändern und gleichzeitig auffrischen. */
  revise(id: number, change: { text?: string; importance?: unknown }): MemoryEntry {
    const entry = this.get(id);
    if (!entry) throw new Error(`Keine Erinnerung #${id}`);
    if (change.text !== undefined) {
      const clean = cleanText(change.text);
      if (!clean) throw new Error('leere Erinnerung');
      entry.text = clean;
    }
    if (change.importance !== undefined && change.importance !== null) entry.importance = clampImportance(change.importance);
    entry.lastSeen = today(this.clock());
    this.evict(entry.id);
    this.save();
    return entry;
  }

  forget(id: number): MemoryEntry | undefined {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index < 0) return undefined;
    const [removed] = this.entries.splice(index, 1);
    this.save();
    return removed;
  }

  /** Das Gedächtnis als Text für Klotzis System-Prompt. */
  prompt(): string {
    if (this.entries.length === 0) return 'Dein Gedächtnis (MEMORY.md) ist noch leer.';
    const lines = this.entries.map(
      (e) => `- #${e.id} ${'★'.repeat(e.importance)} ${e.text} (seit ${e.created}, zuletzt ${e.lastSeen})`,
    );
    return `Dein Langzeitgedächtnis (MEMORY.md, ${this.entries.length}/${this.limits.maxEntries} Einträge):\n${lines.join('\n')}`;
  }

  /**
   * Verdrängt die am wenigsten relevanten Erinnerungen, bis die Grenzen wieder
   * eingehalten werden. `keepId` (die gerade gespeicherte Erinnerung) bleibt.
   */
  private evict(keepId?: number): MemoryEntry[] {
    const evicted: MemoryEntry[] = [];
    const now = this.clock();
    const size = () => this.entries.reduce((sum, e) => sum + e.text.length, 0);
    while (this.entries.length > 1 && (this.entries.length > this.limits.maxEntries || size() > this.limits.maxChars)) {
      let worst: MemoryEntry | undefined;
      for (const e of this.entries) {
        if (e.id === keepId) continue;
        if (!worst) {
          worst = e;
          continue;
        }
        const diff = relevance(e, now) - relevance(worst, now);
        // bei Gleichstand fliegt die ältere Erinnerung
        if (diff < 0 || (diff === 0 && e.created < worst.created)) worst = e;
      }
      if (!worst) break;
      this.entries.splice(this.entries.indexOf(worst), 1);
      evicted.push(worst);
    }
    return evicted;
  }

  // ───────────────────────────── Datei ─────────────────────────────

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    this.entries = Memory.parse(raw, today(this.clock())).map((e) => ({ ...e, id: this.nextId++ }));
    // falls die Grenzen inzwischen kleiner sind oder von Hand zu viel eingetragen wurde
    if (this.evict().length) this.save();
  }

  static parse(markdown: string, fallbackDate: string): Omit<MemoryEntry, 'id'>[] {
    const entries: Omit<MemoryEntry, 'id'>[] = [];
    let inComment = false;
    for (const rawLine of markdown.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (inComment) {
        if (line.includes('-->')) inComment = false;
        continue;
      }
      if (line.startsWith('<!--')) {
        inComment = !line.includes('-->');
        continue;
      }
      if (!line.startsWith('- ')) continue;
      const match = LINE.exec(line);
      if (match) {
        entries.push({
          importance: match[1]!.length as Importance,
          text: cleanText(match[2]!),
          created: match[3]!,
          lastSeen: match[4]!,
        });
      } else {
        // von Hand ergänzte Zeile ohne Metadaten
        const text = cleanText(line.slice(2).replace(/^★{1,3}\s*/, ''));
        if (text) entries.push({ text, importance: 2, created: fallbackDate, lastSeen: fallbackDate });
      }
    }
    return entries;
  }

  static render(entries: readonly MemoryEntry[]): string {
    const lines = entries.map((e) => `- ${'★'.repeat(e.importance)} ${e.text} _(angelegt ${e.created}, zuletzt ${e.lastSeen})_`);
    return `${HEADER}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
  }

  save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Memory.render(this.entries));
    fs.renameSync(tmp, this.file);
  }
}
