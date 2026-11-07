import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { SkillRegistry } from '../src/core/skill-registry.ts';
import { defineSkill } from '../src/core/skill.ts';
import { rollDice } from '../src/skills/dice.ts';
import { splitMessage } from '../src/discord.ts';
import { parseReaction } from '../src/core/brain.ts';

const skillDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/skills');

test('alle mitgelieferten Skills laden ohne Namenskonflikte', async () => {
  const registry = new SkillRegistry();
  const loaded = await registry.loadDirectory(skillDir, { enabled: [], disabled: [] });
  const names = loaded.map((s) => s.name);
  for (const expected of ['core', 'emote', 'dice', 'clock', 'care', 'fetch', 'memory']) {
    assert.ok(names.includes(expected), `Skill ${expected} fehlt`);
  }
  assert.ok(registry.getTool('perform_animation'));
  assert.ok(registry.getCommand('leckerli'));
  for (const tool of registry.openAiTools()) {
    assert.equal(tool.parameters?.type, 'object');
  }
});

test('Skills lassen sich per Konfiguration ein- und ausschalten', async () => {
  const only = new SkillRegistry();
  await only.loadDirectory(skillDir, { enabled: ['dice', 'clock'], disabled: [] });
  assert.deepEqual(only.list().map((s) => s.name).sort(), ['clock', 'dice']);

  const without = new SkillRegistry();
  await without.loadDirectory(skillDir, { enabled: [], disabled: ['memory'] });
  assert.ok(!without.list().some((s) => s.name === 'memory'));
});

test('doppelte Tool-Namen werden abgelehnt', () => {
  const registry = new SkillRegistry();
  const tool = { name: 'x', description: '', parameters: { type: 'object' as const, properties: {} }, execute: () => 1 };
  registry.register(defineSkill({ name: 'a', description: '', tools: [tool] }));
  assert.throws(() => registry.register(defineSkill({ name: 'b', description: '', tools: [tool] })), /existiert bereits/);
});

test('rollDice versteht übliche Notationen', () => {
  const max = () => 0.9999;
  assert.deepEqual(rollDice('2d6+3', max), { notation: '2d6+3', rolls: [6, 6], modifier: 3, total: 15 });
  assert.equal(rollDice('d20', () => 0).total, 1);
  assert.equal(rollDice('3W4-2', () => 0).total, 1);
  assert.throws(() => rollDice('banane'));
  assert.throws(() => rollDice('500d6'));
});

test('splitMessage teilt lange Texte an Wortgrenzen', () => {
  const text = 'wuff '.repeat(1000).trim();
  const parts = splitMessage(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 2000));
  assert.equal(parts.join(' '), text);
  assert.deepEqual(splitMessage('kurz'), ['kurz']);
});

test('parseReaction ist robust gegen kaputte Antworten', () => {
  assert.deepEqual(parseReaction('{"animation":"love","emoji":"❤️","comment":null}'), {
    animation: 'love',
    emoji: '❤️',
    comment: null,
  });
  assert.equal(parseReaction('{"animation":"fliegen"}').animation, 'idle');
  assert.equal(parseReaction('kein json').animation, 'idle');
});
