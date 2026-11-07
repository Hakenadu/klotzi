import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import WebSocket from 'ws';
import type { StageEvent } from '@klotzi/shared';
import { createLogger } from '../src/core/logger.ts';
import type { KlotziContext } from '../src/core/skill.ts';
import { Memory } from '../src/core/memory.ts';
import { Stage } from '../src/core/stage.ts';
import { startServer } from '../src/server.ts';

function context(stage: Stage): KlotziContext {
  return {
    client: {
      user: { tag: 'Klotzi#0001', displayName: 'Klotzi' },
      guilds: { cache: new Map([['123456', { id: '123456' }]]) },
    } as any,
    config: {
      discord: { clientId: '1', clientSecret: '' },
      server: { port: 0, overlayKey: 'geheim', activityDist: '/nicht/vorhanden' },
    } as any,
    openai: {} as any,
    stage,
    memory: new Memory(fs.mkdtempSync(path.join(os.tmpdir(), 'klotzi-')), { maxEntries: 10, maxChars: 1000 }),
    log: createLogger('test'),
    store: () => {
      throw new Error();
    },
    skills: () => [],
  };
}

function nextEvent(ws: WebSocket): Promise<StageEvent> {
  return once(ws, 'message').then(([data]) => JSON.parse(String(data)) as StageEvent);
}

test('Overlay kann die Bühne abonnieren, Events empfangen und streicheln', async () => {
  const stage = new Stage();
  const server = startServer(context(stage));
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const health = await fetch(`http://localhost:${port}/.proxy/api/health`).then((r) => r.json());
    assert.deepEqual(health, { ok: true, bot: 'Klotzi#0001' });

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'subscribe', guildId: '123456', overlayKey: 'geheim' }));
    assert.equal((await nextEvent(ws)).type, 'hello');
    assert.equal(stage.audience('123456'), 1);

    stage.animate('123456', 'dance');
    assert.deepEqual(await nextEvent(ws), { type: 'animate', animation: 'dance' });

    const petted = once(stage, 'pet');
    ws.send(JSON.stringify({ type: 'pet' }));
    assert.deepEqual(await petted, ['123456', null]);

    ws.close();
    await once(ws, 'close');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stage.audience('123456'), 0);
  } finally {
    server.close();
  }
});

test('falscher Overlay-Key wird abgewiesen', async () => {
  const server = startServer(context(new Stage()));
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const ws = new WebSocket(`ws://localhost:${port}/.proxy/ws`);
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'subscribe', guildId: '123456', overlayKey: 'falsch' }));
    const event = await nextEvent(ws);
    assert.equal(event.type, 'error');
    const [code] = await once(ws, 'close');
    assert.equal(code, 4401);
  } finally {
    server.close();
  }
});
