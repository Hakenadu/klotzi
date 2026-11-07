import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '../..');

// .env aus dem Projekt-Root laden (falls vorhanden) – ohne zusätzliche Abhängigkeit.
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // keine .env – Umgebungsvariablen kommen dann z. B. aus Docker
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`Umgebungsvariable ${name} muss eine Zahl sein`);
  return value;
}

function list(name: string): string[] {
  return optional(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(raw);
}

export function loadConfig() {
  const dataDir = path.resolve(ROOT_DIR, optional('KLOTZI_DATA_DIR', 'data'));
  return {
    discord: {
      token: required('DISCORD_TOKEN'),
      clientId: required('DISCORD_CLIENT_ID'),
      /** Nur für den OAuth-Token-Tausch der Activity nötig. */
      clientSecret: optional('DISCORD_CLIENT_SECRET'),
      /** Wenn gesetzt, werden Slash-Commands nur in dieser Guild registriert (sofort verfügbar). */
      guildId: optional('DISCORD_GUILD_ID'),
    },
    openai: {
      apiKey: required('OPENAI_API_KEY'),
      model: optional('OPENAI_MODEL', 'gpt-6-luna'),
      /** Obergrenze für Ausgabe-Tokens (inkl. Reasoning-Tokens). */
      maxTokens: number('OPENAI_MAX_TOKENS', 2000),
      /** Optional: Reasoning-Aufwand (z. B. minimal, low, medium, high) – leer = Modell-Standard. */
      reasoningEffort: optional('OPENAI_REASONING_EFFORT'),
      baseURL: optional('OPENAI_BASE_URL') || undefined,
      /** Modell für schnelle Ja/Nein-Entscheidungen über die Decisions API. */
      decisionModel: optional('OPENAI_DECISION_MODEL', 'gpt-6-luna'),
    },
    images: {
      /** Modell für Bilder, die Klotzi an seine Antworten hängt. */
      model: optional('OPENAI_IMAGE_MODEL', 'gpt-image-2.5-sunburst'),
      /** Qualität: low, medium, high, xhigh, max oder auto. */
      quality: optional('OPENAI_IMAGE_QUALITY', 'medium'),
      /** Mindestabstand zwischen zwei Bildern pro Kanal (Sekunden). */
      cooldown: number('KLOTZI_IMAGE_COOLDOWN', 60),
      /** Referenzbilder bekannter Charaktere (Dateiname = Name); data/characters ergänzt/überschreibt. */
      characterDirs: [path.join(ROOT_DIR, 'bot', 'characters'), path.join(dataDir, 'characters')],
    },
    chat: {
      /** Kanäle, in denen Klotzi auf jede Nachricht antwortet. */
      channelIds: list('KLOTZI_CHAT_CHANNELS'),
      /** Reagiert Klotzi, wenn sein Name in einer Nachricht vorkommt? */
      respondToName: bool('KLOTZI_RESPOND_TO_NAME', true),
      /** Wahrscheinlichkeit (0–1), dass Klotzi auf beliebige Nachrichten nonverbal reagiert. */
      ambientChance: number('KLOTZI_AMBIENT_CHANCE', 0.15),
      /** Mindestabstand zwischen zwei spontanen Reaktionen pro Kanal (Sekunden). */
      ambientCooldown: number('KLOTZI_AMBIENT_COOLDOWN', 60),
      /** Wie viele Chat-Nachrichten Klotzi für spontane Reaktionen und das Nachlauschen liest. */
      historyLimit: number('KLOTZI_HISTORY_LIMIT', 15),
      /** Für Antworten sieht Klotzi den gesamten Verlauf dieser letzten Stunden. */
      historyHours: number('KLOTZI_HISTORY_HOURS', 24),
      /** Obergrenze an Nachrichten im Verlauf (pro Kanal). */
      historyMaxMessages: number('KLOTZI_HISTORY_MAX_MESSAGES', 500),
      /** Obergrenze an Zeichen im Verlauf pro Anfrage (schützt vor riesigen Prompts). */
      historyMaxChars: number('KLOTZI_HISTORY_MAX_CHARS', 60000),
      /** Nach einer Antwort lauscht Klotzi noch so viele Nachrichten weiter mit. */
      followUpMessages: number('KLOTZI_FOLLOW_UP_MESSAGES', 2),
      /** … aber höchstens so viele Minuten lang (0 = unbegrenzt). */
      followUpMinutes: number('KLOTZI_FOLLOW_UP_MINUTES', 15),
      /** Ab dieser Wahrscheinlichkeit (0–1) gilt eine Nachricht als an Klotzi gerichtet. */
      followUpThreshold: number('KLOTZI_FOLLOW_UP_THRESHOLD', 0.5),
      /** Cooldown pro User für direkte Antworten (Sekunden). */
      userCooldown: number('KLOTZI_USER_COOLDOWN', 3),
    },
    skills: {
      /** Wenn gesetzt: nur diese Skills laden. */
      enabled: list('KLOTZI_SKILLS'),
      /** Diese Skills nie laden. */
      disabled: list('KLOTZI_DISABLED_SKILLS'),
    },
    memory: {
      /** Maximale Anzahl an Erinnerungen in MEMORY.md. */
      maxEntries: number('KLOTZI_MEMORY_MAX_ENTRIES', 80),
      /** Maximale Gesamtlänge der Erinnerungen (Zeichen). */
      maxChars: number('KLOTZI_MEMORY_MAX_CHARS', 8000),
    },
    voice: {
      /** Nur diese Sprach-Channels betreten (leer = alle, die Klotzi betreten darf). */
      channelIds: list('KLOTZI_VOICE_CHANNELS'),
      /** Geräusche (Bellen, Jaulen …) im Sprach-Channel abspielen. */
      sounds: bool('KLOTZI_VOICE_SOUNDS', true),
      /** Lautstärke der Geräusche (0–1). */
      volume: number('KLOTZI_VOICE_VOLUME', 0.35),
    },
    server: {
      port: number('PORT', 3001),
      /** Geheimnis, mit dem die Activity auch im normalen Browser / OBS zuschauen darf. */
      overlayKey: optional('KLOTZI_OVERLAY_KEY'),
      activityDist: path.join(ROOT_DIR, 'activity', 'dist'),
    },
    dataDir,
  };
}

export type Config = ReturnType<typeof loadConfig>;
