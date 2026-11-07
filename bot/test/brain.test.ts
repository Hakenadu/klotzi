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

/** Attrappe der Responses API, die vorbereitete Ausgaben der Reihe nach zurückgibt. */
function fakeOpenAI(outputs: unknown[][], requests: any[]): OpenAI {
  return {
    responses: {
      create: async (body: unknown) => {
        requests.push(structuredClone(body));
        const output = outputs.shift() ?? [];
        const output_text = output
          .flatMap((item: any) => (item.type === 'message' ? item.content.map((c: any) => c.text) : []))
          .join('');
        return { output, output_text };
      },
    },
  } as unknown as OpenAI;
}

const message = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (call_id: string, name: string, args: string) => ({ type: 'function_call', call_id, name, arguments: args });
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'geheim' };

function context(openai: OpenAI, stage = new Stage()): KlotziContext {
  return {
    client: {} as any,
    config: { openai: { model: 'gpt-6-luna', maxTokens: 100, reasoningEffort: 'low' } } as any,
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
    [[reasoning, call('call_1', 'perform_animation', '{"animation":"happy"}')], [message('Wuff! Hallo Lisa! 🔥')]],
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
  const [first, second] = requests;
  assert.equal(first.model, 'gpt-6-luna');
  assert.equal(first.store, false);
  assert.deepEqual(first.reasoning, { effort: 'low' });
  assert.match(first.instructions, /Geheimwissen über Lisa/);
  assert.deepEqual(first.input, [{ role: 'user', content: 'Lisa: Hallo Klotzi!' }]);
  assert.equal(first.tools[0].name, 'perform_animation');
  // zweite Runde: Reasoning + Tool-Aufruf + Ergebnis werden zurückgereicht
  assert.deepEqual(
    second.input.slice(1).map((i: any) => i.type),
    ['reasoning', 'function_call', 'function_call_output'],
  );
  assert.equal(second.input.at(-1).call_id, 'call_1');
});

test('Fehler in Tools landen als Ergebnis beim Modell statt den Bot abstürzen zu lassen', async () => {
  const requests: any[] = [];
  const openai = fakeOpenAI(
    [[call('x', 'boom', '{}')], [message('Ups.')]],
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
  assert.match(requests[1].input.at(-1).output, /kaputt!/);
});

test('spontane Reaktionen nutzen strukturierte Ausgabe', async () => {
  const requests: any[] = [];
  const openai = fakeOpenAI([[message('{"animation":"dance","emoji":"🎶","comment":null}')]], requests);
  const reaction = await new Brain(context(openai), new SkillRegistry()).react(
    { guildId: '1', channelId: 'c', userId: 'u', userName: 'X' },
    [{ author: 'X', fromKlotzi: false, content: 'Party!' }],
  );
  assert.deepEqual(reaction, { animation: 'dance', emoji: '🎶', comment: null });
  assert.equal(requests[0].text.format.type, 'json_schema');
});
