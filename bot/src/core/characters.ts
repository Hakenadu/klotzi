import fs from 'node:fs';
import path from 'node:path';

/** Ein Charakter, von dem Klotzi ein Referenzbild kennt. */
export interface Character {
  /** Anzeigename = Dateiname ohne Endung, z. B. `Manael`. */
  name: string;
  /** Weitere Namen, unter denen der Charakter angefragt werden kann. */
  aliases: string[];
  /** Wer ist das? (für Klotzis System-Prompt) */
  about?: string;
  /**
   * Hinweis, der beim Malen an den Bild-Prompt gehängt wird – z. B. wenn
   * der Charakter heute anders aussieht als auf dem Referenzbild.
   */
  imageNote?: string;
  file: string;
}

/** Zusatzwissen zu bekannten Charakteren (Schlüssel: Dateiname klein geschrieben). */
const KNOWN: Record<string, Pick<Character, 'aliases' | 'about' | 'imageNote'>> = {
  klotzi: {
    aliases: ['höllenhund'],
    about: 'du selbst, Klotzi, der riesige verspielte Höllenhund',
    imageNote: 'Klotzi ist ein riesiger, verspielter schwarzer Höllenhund mit glühenden gelben Augen, kleinen Hörnern und rotem Stachelhalsband.',
  },
  manael: {
    aliases: ['mseiche', 'herrchen'],
    about: 'dein Herrchen, der Psioniker, der dich beschworen hat (im Chat "mseiche")',
  },
  shashangli: {
    aliases: [],
    about: 'mit roten Haaren, so wie früher (heute wird sie Tana genannt, siehe dort)',
  },
  tarras: {
    aliases: ['taras', 'tarras gun', 'taras gun'],
  },
};

/**
 * Charaktere, die ein vorhandenes Referenzbild mitbenutzen, aber anders
 * gemalt werden (Schlüssel: Name klein geschrieben).
 */
const VARIANTS: Record<string, { name: string; base: string } & Pick<Character, 'aliases' | 'about' | 'imageNote'>> = {
  tana: {
    name: 'Tana',
    base: 'shashangli',
    aliases: [],
    about: 'so heißt Shashangli heute – sie hat inzwischen weiße Haare',
    imageNote:
      'WICHTIG: Tana hat schneeweiße Haare. Übernimm Gesicht und Ausstrahlung vom Referenzbild, ' +
      'aber male ihre Haare unbedingt weiß, NICHT rot.',
  },
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Lädt alle Charakterbilder aus den angegebenen Verzeichnissen. Spätere
 * Verzeichnisse überschreiben frühere (z. B. eigene Bilder in `data/characters`).
 */
export function loadCharacters(...dirs: string[]): Character[] {
  const byName = new Map<string, Character>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      const ext = path.extname(entry).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      const name = path.basename(entry, path.extname(entry));
      const known = KNOWN[name.toLowerCase()];
      byName.set(name.toLowerCase(), {
        name,
        aliases: known?.aliases ?? [],
        about: known?.about,
        imageNote: known?.imageNote,
        file: path.join(dir, entry),
      });
    }
  }
  for (const [key, { base, ...variant }] of Object.entries(VARIANTS)) {
    const original = byName.get(base);
    if (original && !byName.has(key)) byName.set(key, { ...variant, file: original.file });
  }
  return [...byName.values()];
}

/** Sucht einen Charakter über Namen oder Alias (ohne Groß-/Kleinschreibung). */
export function findCharacter(characters: readonly Character[], query: string): Character | undefined {
  const q = query.trim().toLowerCase();
  return characters.find((c) => c.name.toLowerCase() === q || c.aliases.includes(q));
}

export function mimeType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}
