/**
 * Gemeinsames Protokoll zwischen Bot (Server) und der 3D-Activity (Client).
 * Der Bot schickt Klotzi über einen WebSocket "Regieanweisungen" – die Activity
 * setzt sie als Animation, Sprechblase und Effekte um.
 */

/** Alle Animationen, die Klotzi in der Activity beherrscht. */
export const ANIMATIONS = {
  idle: 'Ruhig dastehen, atmen, mit dem Schwanz wedeln',
  happy: 'Fröhlich hüpfen und wild wedeln',
  excited: 'Völlig aus dem Häuschen: Sprünge und eine Pirouette',
  bark: 'Laut bellen, kleine Flammen pusten',
  sad: 'Traurig: Ohren und Kopf hängen lassen',
  angry: 'Wütend knurren, Flammen lodern rot auf',
  sleep: 'Sich hinlegen und schlafen (Zzz)',
  think: 'Kopf schief legen und nachdenken',
  eat: 'Ein Leckerli mampfen',
  love: 'Verliebt kuscheln, Herzchen steigen auf',
  fetch: 'Einem Stöckchen hinterherrennen und es zurückbringen',
  dance: 'Fröhlich zu Musik tanzen',
  confused: 'Verwirrt gucken, Fragezeichen über dem Kopf',
  scared: 'Erschrecken und zittern',
} as const satisfies Record<string, string>;

export type AnimationName = keyof typeof ANIMATIONS;
export const ANIMATION_NAMES = Object.keys(ANIMATIONS) as AnimationName[];

export function isAnimationName(value: unknown): value is AnimationName {
  return typeof value === 'string' && value in ANIMATIONS;
}

/** Nachrichten Server → Activity */
export type StageEvent =
  | { type: 'hello'; botName: string }
  /** Klotzi soll eine Animation spielen. */
  | { type: 'animate'; animation: AnimationName; intensity?: number }
  /** Klotzi sagt etwas (Sprechblase). */
  | { type: 'say'; text: string; replyTo?: string }
  /** Klotzi denkt gerade nach (OpenAI-Anfrage läuft). */
  | { type: 'thinking'; active: boolean }
  /** Im Chat ist etwas passiert – Klotzi spitzt die Ohren. */
  | { type: 'notice'; author: string }
  | { type: 'error'; message: string };

/** Nachrichten Activity → Server */
export type ClientMessage =
  /**
   * Anmeldung für die Bühne einer Guild.
   * - In Discord: mit dem OAuth-Access-Token des Users.
   * - Im Browser/OBS: mit dem Overlay-Key aus der Konfiguration.
   */
  | { type: 'subscribe'; guildId: string; accessToken?: string; overlayKey?: string }
  /** Jemand hat Klotzi in der Activity gestreichelt. */
  | { type: 'pet' };

export const WS_PATH = '/ws';
