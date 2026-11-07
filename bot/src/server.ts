import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PATH, type ClientMessage, type StageEvent } from '@klotzi/shared';
import type { KlotziContext } from './core/skill.ts';

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * HTTP- und WebSocket-Server für die Activity:
 *  - liefert die gebaute 3D-Activity aus
 *  - tauscht den OAuth-Code der Activity gegen ein Access-Token
 *  - verbindet Activities per WebSocket mit Klotzis Bühne
 *
 * Discord leitet Anfragen der Activity über seinen Proxy weiter; je nach Setup
 * mit oder ohne `/.proxy`-Präfix – deshalb hören alle Routen auf beide Varianten.
 */
export function startServer(ctx: KlotziContext): http.Server {
  const { config, log: rootLog } = ctx;
  const log = rootLog.child('server');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true, bot: ctx.client.user?.tag ?? null });
  });
  // öffentliche Konfiguration für die Activity (so braucht der Build keine Umgebungsvariablen)
  api.get('/config', (_req, res) => {
    res.json({ clientId: config.discord.clientId });
  });
  api.post('/token', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!code || !config.discord.clientSecret) {
      res.status(400).json({ error: code ? 'DISCORD_CLIENT_SECRET fehlt' : 'code fehlt' });
      return;
    }
    const response = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = (await response.json()) as { access_token?: string; error?: string };
    if (!response.ok || !data.access_token) {
      log.warn('OAuth-Tausch fehlgeschlagen', data.error);
      res.status(401).json({ error: 'OAuth fehlgeschlagen' });
      return;
    }
    res.json({ access_token: data.access_token });
  });
  app.use(['/api', '/.proxy/api'], api);

  if (fs.existsSync(config.server.activityDist)) {
    const assets = express.static(config.server.activityDist);
    app.use(assets);
    app.use('/.proxy', assets);
    app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(config.server.activityDist, 'index.html')));
  } else {
    log.warn(`Keine gebaute Activity unter ${config.server.activityDist} – "npm run build" ausführen (oder Vite-Dev-Server nutzen).`);
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== WS_PATH && pathname !== `/.proxy${WS_PATH}`) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleViewer(ws, ctx));
  });

  // tote Verbindungen regelmäßig aufräumen
  const alive = new WeakSet<WebSocket>();
  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) ws.terminate();
      else {
        alive.delete(ws);
        ws.ping();
      }
    }
  }, 30_000);
  server.on('close', () => clearInterval(heartbeat));

  server.listen(config.server.port, () => {
    const address = server.address();
    log.info(`Bühne läuft auf http://localhost:${typeof address === 'object' && address ? address.port : config.server.port}`);
  });
  return server;
}

function handleViewer(ws: WebSocket, ctx: KlotziContext): void {
  const log = ctx.log.child('stage');
  const send = (event: StageEvent) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(event));
  let leave: (() => void) | undefined;
  let viewer: { guildId: string; userId: string | null } | undefined;
  let lastPet = 0;

  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === 'subscribe' && !viewer) {
      try {
        const userId = await authorize(msg, ctx);
        viewer = { guildId: msg.guildId, userId };
        leave = ctx.stage.add(msg.guildId, { send });
        send({ type: 'hello', botName: ctx.client.user?.displayName ?? 'Klotzi' });
        ctx.stage.emit('join', msg.guildId, userId);
        log.info(`Zuschauer betritt die Bühne in Guild ${msg.guildId} (${ctx.stage.audience(msg.guildId)} insgesamt)`);
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Nicht erlaubt' });
        ws.close(4401, 'unauthorized');
      }
    } else if (msg.type === 'pet' && viewer && Date.now() - lastPet > 1500) {
      lastPet = Date.now();
      ctx.stage.emit('pet', viewer.guildId, viewer.userId);
    }
  });
  ws.on('close', () => leave?.());
}

/** Prüft, ob der Client die Bühne dieser Guild sehen darf. Liefert die User-ID (oder null für Overlays). */
async function authorize(msg: Extract<ClientMessage, { type: 'subscribe' }>, ctx: KlotziContext): Promise<string | null> {
  if (typeof msg.guildId !== 'string' || !/^\d{5,25}$/.test(msg.guildId)) throw new Error('Ungültige Guild');
  const guild = ctx.client.guilds.cache.get(msg.guildId);
  if (!guild) throw new Error('Klotzi ist nicht auf diesem Server');

  const { overlayKey } = ctx.config.server;
  if (msg.overlayKey && overlayKey && safeEqual(msg.overlayKey, overlayKey)) return null;

  if (!msg.accessToken) throw new Error('Nicht angemeldet');
  const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${msg.accessToken}` } });
  if (!res.ok) throw new Error('Ungültiges Token');
  const user = (await res.json()) as { id: string };
  await guild.members.fetch(user.id).catch(() => {
    throw new Error('Du bist nicht auf diesem Server');
  });
  return user.id;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
