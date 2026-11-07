import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INVITE_LINES, inviteText, isVoiceChatStart } from '../src/skills/invite.ts';

const MIN = 60_000;

test('der erste Mensch im leeren Channel startet den Sprach-Chat', () => {
  assert.equal(isVoiceChatStart({ humansAfter: 1, lastInviteAt: undefined, now: 0, cooldownMs: 10 * MIN }), true);
});

test('wer zu einem laufenden Sprach-Chat dazukommt, löst keine Frage aus', () => {
  assert.equal(isVoiceChatStart({ humansAfter: 2, lastInviteAt: undefined, now: 0, cooldownMs: 10 * MIN }), false);
});

test('kurz nach der letzten Frage fragt Klotzi nicht schon wieder', () => {
  const base = { humansAfter: 1, lastInviteAt: 0, cooldownMs: 10 * MIN };
  assert.equal(isVoiceChatStart({ ...base, now: 5 * MIN }), false);
  assert.equal(isVoiceChatStart({ ...base, now: 10 * MIN }), true);
});

test('jede Frage enthält den Link', () => {
  INVITE_LINES.forEach((_, i) => {
    const text = inviteText('https://discord.gg/abc', () => i / INVITE_LINES.length);
    assert.ok(text.includes('https://discord.gg/abc'), text);
    assert.ok(!text.includes('{link}'));
  });
});
