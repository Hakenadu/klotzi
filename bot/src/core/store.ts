import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimaler persistenter Speicher: ein JSON-Objekt pro Namespace,
 * gespeichert in `<dataDir>/<namespace>.json`. Schreibvorgänge werden gebündelt.
 */
export class JsonStore<T extends object> {
  readonly data: T;
  private timer: NodeJS.Timeout | undefined;
  private readonly file: string;

  constructor(dataDir: string, namespace: string, initial: T) {
    if (!/^[\w-]+$/.test(namespace)) throw new Error(`Ungültiger Store-Name: ${namespace}`);
    this.file = path.join(dataDir, `${namespace}.json`);
    this.data = { ...initial, ...JsonStore.read<T>(this.file) };
  }

  private static read<T>(file: string): Partial<T> {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<T>;
    } catch {
      return {};
    }
  }

  /** Daten ändern und (verzögert) speichern. */
  update(fn: (data: T) => void): void {
    fn(this.data);
    this.save();
  }

  save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
