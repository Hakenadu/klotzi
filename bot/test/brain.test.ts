import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type OpenAI from 'openai';
import type { StageEvent } from '@klotzi/shared';
import { Brain } from '../src/core/brain.ts';
import { createLogger } from '../src/core/logger.ts';
import type { KlotziContext } from '../src/core/skill.ts';
import { defineSkill } from '../src/core/skill.ts';
import { SkillRegistry } from '../src/core/skill-registry.ts';
import { Memory } from '../src/core/memory.ts';
import { Stage } from '../src/core/stage.ts';
import emote from '../src/skills/emote.ts';
import image, { resetImageCooldowns } from '../src/skills/image.ts';

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

function context(openai: OpenAI, stage = new Stage(), memory?: Memory): KlotziContext {
  return {
    client: {} as any,
    config: { openai: { model: 'gpt-6-luna', decisionModel: 'gpt-6-luna', maxTokens: 100, reasoningEffort: 'low' } } as any,
    openai,
    stage,
    memory: memory ?? new Memory(fs.mkdtempSync(path.join(os.tmpdir(), 'klotzi-')), { maxEntries: 10, maxChars: 1000 }),
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

  assert.deepEqual(answer, { text: 'Wuff! Hallo Lisa! 🔥', files: [] });
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
  assert.equal(answer.text, 'Ups.');
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

test('Gedächtnis und Zeitstempel landen im Prompt', async () => {
  const requests: any[] = [];
  const openai = fakeOpenAI([[message('Wuff!')]], requests);
  const memory = new Memory(fs.mkdtempSync(path.join(os.tmpdir(), 'klotzi-')), { maxEntries: 10, maxChars: 1000 });
  memory.add('mseiche hat Klotzi aus dem Warp beschworen', 3);
  const at = Date.UTC(2026, 10, 7, 13, 3);
  await new Brain(context(openai, new Stage(), memory), new SkillRegistry()).reply(
    { guildId: '1', channelId: 'c', userId: '42', userName: 'mseiche' },
    [
      { author: 'mseiche', fromKlotzi: false, content: 'Na, Klotzi?', at },
      { author: 'Klotzi', fromKlotzi: true, content: 'Wuff!', at },
    ],
  );
  const [req] = requests;
  assert.match(req.instructions, /#1 ★★★ mseiche hat Klotzi aus dem Warp beschworen/);
  assert.match(req.instructions, /Discord-ID 42/);
  assert.match(req.instructions, /Manael/);
  assert.deepEqual(req.input, [
    { role: 'user', content: '[Sa., 14:03] mseiche: Na, Klotzi?' },
    { role: 'assistant', content: 'Wuff!' },
  ]);
});

test('isAboutKlotzi fragt die Decisions API und liefert die Wahrscheinlichkeit', async () => {
  const bodies: any[] = [];
  const decide = (answers: unknown[]) =>
    ({
      decisions: {
        create: async (body: unknown) => {
          bodies.push(body);
          return { answers, model: 'gpt-6-luna', usage: {} };
        },
      },
    }) as unknown as OpenAI;
  const history = [
    { author: 'Klotzi', fromKlotzi: true, content: 'Willst du ein Stöckchen werfen?' },
    { author: 'Lisa', fromKlotzi: false, content: 'Ja, fang!' },
  ];

  const yes = new Brain(context(decide([{ type: 'predicate', name: 'addressed_to_klotzi', probability: 0.92 }])), new SkillRegistry());
  assert.equal(await yes.isAboutKlotzi(history), 0.92);
  const [body] = bodies;
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.questions[0].type, 'predicate');
  assert.deepEqual(body.input.slice(1), [
    { role: 'assistant', content: 'Willst du ein Stöckchen werfen?' },
    { role: 'user', content: 'Lisa: Ja, fang!' },
  ]);

  const refused = new Brain(context(decide([{ type: 'refusal', name: 'addressed_to_klotzi' }])), new SkillRegistry());
  assert.equal(await refused.isAboutKlotzi(history), 0);
  // letzte Nachricht von Klotzi selbst → gar nicht erst fragen
  assert.equal(await refused.isAboutKlotzi(history.slice(0, 1)), 0);
  assert.equal(bodies.length, 2);
});

test('Klotzi malt per Tool ein Bild und hängt es an die Antwort', async () => {
  resetImageCooldowns();
  const requests: any[] = [];
  const imageRequests: any[] = [];
  const openai = fakeOpenAI(
    [
      [call('img', 'generate_image', '{"prompt":"Ein Höllenhund mit Sonnenbrille","format":"quer"}')],
      [call('img2', 'generate_image', '{"prompt":"Noch eins"}')],
      [message('Hier, frisch aus dem Höllenfeuer! 🎨')],
    ],
    requests,
  );
  (openai as any).images = {
    generate: async (body: unknown) => {
      imageRequests.push(body);
      return { created: 0, data: [{ b64_json: Buffer.from('PNG!').toString('base64') }] };
    },
  };
  const ctx = context(openai);
  (ctx.config as any).images = { model: 'gpt-image-2.5-sunburst', quality: 'medium', cooldown: 60, characterDirs: [] };
  const skills = new SkillRegistry();
  skills.register(image);

  const answer = await new Brain(ctx, skills).reply({ guildId: '1', channelId: 'bilder', userId: 'u', userName: 'Lisa' }, []);

  assert.equal(answer.text, 'Hier, frisch aus dem Höllenfeuer! 🎨');
  assert.equal(answer.files.length, 1, 'höchstens ein Bild pro Antwort');
  assert.equal(answer.files[0]!.name, 'klotzi.png');
  assert.equal(answer.files[0]!.data.toString(), 'PNG!');
  assert.equal(imageRequests.length, 1);
  assert.equal(imageRequests[0].model, 'gpt-image-2.5-sunburst');
  assert.equal(imageRequests[0].size, '1536x1024');
  assert.match(requests[2].input.at(-1).output, /schon ein Bild/);

  // Cooldown pro Kanal
  const again = fakeOpenAI([[call('img3', 'generate_image', '{"prompt":"Nochmal"}')], [message('Später!')]], requests);
  (again as any).images = (openai as any).images;
  const second = await new Brain({ ...ctx, openai: again }, skills).reply(
    { guildId: '1', channelId: 'bilder', userId: 'u', userName: 'Lisa' },
    [],
  );
  assert.equal(second.files.length, 0);
  assert.equal(imageRequests.length, 1);
  assert.match(requests.at(-1).input.at(-1).output, /Pause/);
});

test('Klotzi schickt Referenzbilder bekannter Charaktere über die Edit API mit', async () => {
  resetImageCooldowns();
  const requests: any[] = [];
  const edits: any[] = [];
  const openai = fakeOpenAI(
    [
      [call('img', 'generate_image', '{"prompt":"Tana und Klotzi beim Picknick","characters":["Tana","klotzi"]}')],
      [message('Picknick! 🧺')],
    ],
    requests,
  );
  (openai as any).images = {
    generate: async () => assert.fail('ohne Referenzbilder nicht erwartet'),
    edit: async (body: any) => {
      edits.push(body);
      return { created: 0, data: [{ b64_json: Buffer.from('PNG!').toString('base64') }] };
    },
  };
  const ctx = context(openai);
  const characterDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../characters');
  (ctx.config as any).images = { model: 'gpt-image-2.5-sunburst', quality: 'medium', cooldown: 0, characterDirs: [characterDir] };
  const skills = new SkillRegistry();
  skills.register(image);

  const brain = new Brain(ctx, skills);
  const answer = await brain.reply({ guildId: '1', channelId: 'ref', userId: 'u', userName: 'Lisa' }, []);

  assert.equal(answer.files.length, 1);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].image.map((f: File) => f.name), ['Shashangli.jpg', 'Klotzi.png']);
  assert.equal(edits[0].input_fidelity, 'high');
  assert.match(edits[0].prompt, /Referenzbild 1 zeigt Shashangli\. WICHTIG: .*weiße Haare/);
  assert.match(edits[0].prompt, /Referenzbild 2 zeigt Klotzi/);
  // alle mitgelieferten Charaktere stehen im System-Prompt
  for (const name of ['Klotzi', 'Manael', 'Karaski', 'Gideon', 'Shashangli', 'Caldros']) {
    assert.match(requests[0].instructions, new RegExp(`- ${name}`));
  }

  // unbekannte Charaktere landen als Fehler beim Modell
  const unknown = fakeOpenAI([[call('x', 'generate_image', '{"prompt":"x","characters":["Gandalf"]}')], [message('Hm.')]], requests);
  (unknown as any).images = (openai as any).images;
  const none = await new Brain({ ...ctx, openai: unknown }, skills).reply({ guildId: '1', channelId: 'ref2', userId: 'u', userName: 'Lisa' }, []);
  assert.equal(none.files.length, 0);
  assert.match(requests.at(-1).input.at(-1).output, /Kein Referenzbild von \\"Gandalf\\"/);
});
