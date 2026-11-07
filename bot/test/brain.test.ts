import assert from 'node:assert/strict';
import { test } from 'node:test';
import type OpenAI from 'openai';
import type { StageEvent } from '@klotzi/shared';
import { Brain } from '../src/core/brain.ts';
import { createLogger } from '../src/core/logger.ts';
import type { KlotziContext } from '../src/core/skill.ts';
import { defineSkill } from '../src/core/skill.ts';
import { SkillRegistry } from '../src/core/skill-registry.ts';
import { Stage } from '../src/core/stage.ts';
import emote from '../src/skills/emote.ts';

/** OpenAI-Attrappe, die vorbereitete Antworten der Reihe nach zurückgibt. */
function fakeOpenAI(responses: unknown[], requests: any[]): OpenAI {
  return {
    chat: {
      completions: {
        create: async (body: unknown) => {
          requests.push(structuredClone(body));
          return { choices: [{ message: responses.shift() }] };
        },
      },
    },
  } as unknown as OpenAI;
}

function context(openai: OpenAI, stage = new Stage()): KlotziContext {
  return {
    client: {} as any,
    config: { openai: { model: 'test-model', maxTokens: 100 } } as any,
    openai,
    stage,
    log: createLogger('test'),
    store: () => {
      throw new Error('kein Store im Test');
    },
    skills: () => [],
  };
}

test('Brain führt Tool-Aufrufe aus und schickt Animationen auf die Bühne', async () => {
  const requests: any[] = [];
  const openai = fakeOpenAI(
    [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'perform_animation', arguments: '{"animation":"happy"}' } }],
      },
      { role: 'assistant', content: 'Wuff! Hallo Lisa! 🔥' },
    ],
    requests,
  );
  const stage = new Stage();
  const events: StageEvent[] = [];
  stage.add('123456', { send: (e) => events.push(e) });

  const skills = new SkillRegistry();
  skills.register(emote);
  skills.register(defineSkill({ name: 'extra', description: '', prompt: ({ userName }) => `Geheimwissen über ${userName}` }));

  const brain = new Brain(context(openai, stage), skills);
  const answer = await brain.reply(
    { guildId: '123456', channelId: 'c', userId: 'u', userName: 'Lisa' },
    [{ author: 'Lisa', fromKlotzi: false, content: 'Hallo Klotzi!' }],
  );

  assert.equal(answer, 'Wuff! Hallo Lisa! 🔥');
  assert.deepEqual(events, [{ type: 'animate', animation: 'happy', intensity: undefined }]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /Geheimwissen über Lisa/);
  assert.equal(requests[0].messages[1].content, 'Lisa: Hallo Klotzi!');
  const toolMessage = requests[1].messages.at(-1);
  assert.equal(toolMessage.role, 'tool');
  assert.equal(toolMessage.tool_call_id, 'call_1');
});

test('Fehler in Tools landen als Ergebnis beim Modell statt den Bot abstürzen zu lassen', async () => {
  const requests: any[] = [];
  const openai = fakeOpenAI(
    [
      { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'boom', arguments: '{}' } }] },
      { role: 'assistant', content: 'Ups.' },
    ],
    requests,
  );
  const skills = new SkillRegistry();
  skills.register(
    defineSkill({
      name: 'kaputt',
      description: '',
      tools: [{ name: 'boom', description: '', parameters: { type: 'object', properties: {} }, execute: () => { throw new Error('kaputt!'); } }],
    }),
  );
  const answer = await new Brain(context(openai), skills).reply({ guildId: null, channelId: 'c', userId: 'u', userName: 'X' }, []);
  assert.equal(answer, 'Ups.');
  assert.match(requests[1].messages.at(-1).content, /kaputt!/);
});
