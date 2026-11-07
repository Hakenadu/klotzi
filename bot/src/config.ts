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
      model: optional('OPENAI_MODEL', 'gpt-4.1-mini'),
      maxTokens: number('OPENAI_MAX_TOKENS', 600),
      baseURL: optional('OPENAI_BASE_URL') || undefined,
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
      /** Wie viele Chat-Nachrichten Klotzi als Kontext liest. */
      historyLimit: number('KLOTZI_HISTORY_LIMIT', 15),
      /** Cooldown pro User für direkte Antworten (Sekunden). */
      userCooldown: number('KLOTZI_USER_COOLDOWN', 3),
    },
    skills: {
      /** Wenn gesetzt: nur diese Skills laden. */
      enabled: list('KLOTZI_SKILLS'),
      /** Diese Skills nie laden. */
      disabled: list('KLOTZI_DISABLED_SKILLS'),
    },
    server: {
      port: number('PORT', 3001),
      /** Geheimnis, mit dem die Activity auch im normalen Browser / OBS zuschauen darf. */
      overlayKey: optional('KLOTZI_OVERLAY_KEY'),
      activityDist: path.join(ROOT_DIR, 'activity', 'dist'),
    },
    dataDir: path.resolve(ROOT_DIR, optional('KLOTZI_DATA_DIR', 'data')),
  };
}

export type Config = ReturnType<typeof loadConfig>;
