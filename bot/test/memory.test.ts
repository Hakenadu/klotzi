import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChatLog, type LoggedMessage } from '../src/core/chat-log.ts';
import { Memory, relevance } from '../src/core/memory.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'klotzi-mem-'));
const DAY = 24 * 60 * 60 * 1000;

test('MEMORY.md übersteht einen Neustart', () => {
  const dir = tmp();
  const memory = new Memory(dir, { maxEntries: 10, maxChars: 1000 });
  memory.add('mseiche ist Manael, mein Beschwörer', 3);
  memory.add('Lisa mag Pizza Hawaii');
  memory.add('lisa mag pizza hawaii'); // Duplikat → nur aufgefrischt
  memory.flush();

  const markdown = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8');
  assert.match(markdown, /^# Klotzis Gedächtnis/);
  assert.match(markdown, /- ★★★ mseiche ist Manael, mein Beschwörer _\(angelegt \d{4}-\d{2}-\d{2}, zuletzt \d{4}-\d{2}-\d{2}\)_/);

  const again = new Memory(dir, { maxEntries: 10, maxChars: 1000 });
  assert.deepEqual(
    again.list().map((e) => [e.text, e.importance]),
    [
      ['mseiche ist Manael, mein Beschwörer', 3],
      ['Lisa mag Pizza Hawaii', 2],
    ],
  );
});

test('von Hand ergänzte Zeilen werden verstanden, Kommentare ignoriert', () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, 'MEMORY.md'),
    '# Klotzis Gedächtnis\n\n<!--\n- das ist nur ein Kommentar\n-->\n\n- Tom hat Geburtstag am 3. März\n- ★ Max spielt Gitarre\n',
  );
  const memory = new Memory(dir, { maxEntries: 10, maxChars: 1000 });
  assert.deepEqual(
    memory.list().map((e) => [e.text, e.importance]),
    [
      ['Tom hat Geburtstag am 3. März', 2],
      ['Max spielt Gitarre', 2],
    ],
  );
});

test('volles Gedächtnis verdrängt alte und unwichtige Erinnerungen', () => {
  let now = new Date('2026-01-01T12:00:00Z');
  const memory = new Memory(tmp(), { maxEntries: 3, maxChars: 10_000 }, () => now);
  const wichtig = memory.add('sehr wichtig', 3).entry;
  memory.add('Kleinkram von früher', 1);
  const normal = memory.add('normal', 2).entry;

  now = new Date('2026-03-01T12:00:00Z');
  const { evicted } = memory.add('ganz neu', 1);
  assert.deepEqual(evicted.map((e) => e.text), ['Kleinkram von früher']);

  // Auffrischen schützt vor dem Vergessen
  memory.revise(normal.id, {});
  now = new Date('2026-04-15T12:00:00Z');
  const second = memory.add('noch neuer', 1);
  assert.deepEqual(second.evicted.map((e) => e.text), ['ganz neu']);
  assert.ok(memory.get(wichtig.id));
  assert.ok(memory.get(normal.id));
});

test('auch die Zeichengrenze wird eingehalten', () => {
  const memory = new Memory(tmp(), { maxEntries: 100, maxChars: 50 });
  for (let i = 0; i < 10; i++) memory.add(`Erinnerung Nummer ${i}`);
  const total = memory.list().reduce((sum, e) => sum + e.text.length, 0);
  assert.ok(total <= 50, `zu lang: ${total}`);
  assert.equal(memory.list().at(-1)!.text, 'Erinnerung Nummer 9');
});

test('relevance: Wichtigkeit hält länger frisch', () => {
  const now = new Date('2026-06-01');
  assert.ok(relevance({ importance: 3, lastSeen: '2026-04-10' }, now) > relevance({ importance: 1, lastSeen: '2026-05-25' }, now));
});

const msg = (id: string, at: number, content = `Nachricht ${id}`): LoggedMessage => ({
  id,
  at,
  author: 'Lisa',
  fromKlotzi: false,
  content,
});

test('ChatLog liefert die letzten 24 Stunden – einmalig nachgeladen, danach live', async () => {
  const now = Date.UTC(2026, 10, 7, 12);
  const log = new ChatLog({ hours: 24, maxMessages: 100, maxChars: 100_000 }, () => now);
  log.record('c', msg('5', now - 1000));

  let backfills = 0;
  const backfill = async (since: number) => {
    backfills++;
    assert.equal(since, now - DAY);
    return [msg('2', now - 2 * 60 * 60 * 1000), msg('5', now - 1000), msg('1', now - DAY - 1)];
  };
  const first = await log.recent('c', backfill);
  assert.deepEqual(first.map((m) => m.id), ['2', '5']);

  log.record('c', msg('6', now));
  log.edit('c', '2', 'bearbeitet');
  log.remove('c', '5');
  const second = await log.recent('c', backfill);
  assert.deepEqual(second.map((m) => [m.id, m.content]), [['2', 'bearbeitet'], ['6', 'Nachricht 6']]);
  assert.equal(backfills, 1);

  assert.deepEqual((await log.recent('c', backfill, 1)).map((m) => m.id), ['6']);
});

test('ChatLog hält Nachrichten- und Zeichenbudget ein', async () => {
  const now = Date.now();
  const log = new ChatLog({ hours: 24, maxMessages: 3, maxChars: 30 }, () => now);
  for (let i = 0; i < 5; i++) log.record('c', msg(String(i), now - (5 - i) * 1000, 'x'.repeat(10)));
  const lines = await log.recent('c');
  // max. 3 Nachrichten, davon passen nur 2 ins Zeichenbudget (je 10 + "Lisa")
  assert.deepEqual(lines.map((m) => m.id), ['3', '4']);
});
