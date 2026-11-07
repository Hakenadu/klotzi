import { WS_PATH, type ClientMessage, type StageEvent } from '@klotzi/shared';

export type Mode = 'discord' | 'browser' | 'demo';

export interface Subscription {
  guildId: string;
  accessToken?: string;
  overlayKey?: string;
}

export interface Session {
  mode: Mode;
  subscription?: Subscription;
  /** Wird nur im Discord-Modus gesetzt */
  platform?: 'desktop' | 'mobile';
  userName?: string;
}

const params = new URLSearchParams(location.search);

/** Läuft die Seite als Discord-Activity (im iFrame von discordsays.com)? */
export const inDiscord = params.has('frame_id');
/** Discord leitet Anfragen der Activity über seinen Proxy unter `/.proxy` weiter. */
const prefix = inDiscord ? '/.proxy' : '';

/**
 * Meldet die Activity an:
 * - in Discord über das Embedded App SDK (OAuth → Access-Token)
 * - im Browser/OBS über `?guild=<id>&key=<overlay-key>`
 * - sonst Demo-Modus ohne Server.
 */
export async function createSession(): Promise<Session> {
  if (inDiscord) return discordSession();
  const guildId = params.get('guild');
  if (guildId) return { mode: 'browser', subscription: { guildId, overlayKey: params.get('key') ?? undefined } };
  return { mode: 'demo' };
}

async function discordSession(): Promise<Session> {
  const configResponse = await fetch(`${prefix}/api/config`).catch(() => undefined);
  const { clientId } = configResponse?.ok ? ((await configResponse.json()) as { clientId?: string }) : {};
  if (!clientId) throw new Error('Klotzis Server ist nicht erreichbar (/api/config)');
  // erst hier laden: im Browser-/Demo-Modus wird das SDK nicht gebraucht
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });
  const response = await fetch(`${prefix}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error('Anmeldung bei Klotzi fehlgeschlagen');
  const { access_token } = (await response.json()) as { access_token: string };
  const auth = await sdk.commands.authenticate({ access_token });

  if (!sdk.guildId) throw new Error('Klotzi wohnt nur auf Servern – starte ihn in einem Server-Sprachkanal.');
  return {
    mode: 'discord',
    platform: sdk.platform === 'mobile' ? 'mobile' : 'desktop',
    userName: auth.user.global_name ?? auth.user.username,
    subscription: { guildId: sdk.guildId, accessToken: access_token },
  };
}

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'denied';

/**
 * WebSocket zur Bühne mit automatischem Wiederverbinden.
 */
export class StageConnection {
  private ws: WebSocket | undefined;
  private retry = 0;
  private closed = false;

  constructor(
    private readonly subscription: Subscription,
    private readonly onEvent: (event: StageEvent) => void,
    private readonly onState: (state: ConnectionState, detail?: string) => void,
  ) {
    this.open();
  }

  private open(): void {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}${prefix}${WS_PATH}`);
    this.ws = ws;
    this.onState('connecting');
    ws.onopen = () => {
      this.send({ type: 'subscribe', ...this.subscription });
    };
    ws.onmessage = (msg) => {
      let event: StageEvent;
      try {
        event = JSON.parse(String(msg.data)) as StageEvent;
      } catch {
        return;
      }
      if (event.type === 'hello') {
        this.retry = 0;
        this.onState('online');
      }
      if (event.type === 'error') {
        this.closed = true;
        this.onState('denied', event.message);
      }
      this.onEvent(event);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.onState('offline');
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}
