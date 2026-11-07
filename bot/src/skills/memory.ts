import fs from 'node:fs';
import path from 'node:path';
import { defineSkill, defineTool, type KlotziContext } from '../core/skill.ts';
import type { MemoryEntry } from '../core/memory.ts';

const short = (e: MemoryEntry) => ({ id: e.id, text: e.text, importance: e.importance });

/**
 * Übernimmt die Fakten aus dem alten `memory.json` (eine Liste pro User-ID)
 * einmalig in die MEMORY.md und benennt die alte Datei danach um.
 */
function migrateLegacyFacts(ctx: KlotziContext): void {
  const legacy = path.join(ctx.config.dataDir, 'memory.json');
  if (!fs.existsSync(legacy)) return;
  try {
    const data = JSON.parse(fs.readFileSync(legacy, 'utf8')) as { facts?: Record<string, string[]> };
    let count = 0;
    for (const [userId, facts] of Object.entries(data.facts ?? {})) {
      for (const fact of facts) {
        ctx.memory.add(`Discord-ID ${userId}: ${fact}`, 2);
        count++;
      }
    }
    fs.renameSync(legacy, `${legacy}.migriert`);
    ctx.memory.flush();
    ctx.log.info(`${count} alte Fakten in MEMORY.md übernommen`);
  } catch (err) {
    ctx.log.warn('Alte memory.json konnte nicht übernommen werden', err);
  }
}

/**
 * Werkzeuge, mit denen Klotzi sein Langzeitgedächtnis (MEMORY.md) selbst pflegt.
 * Der Inhalt des Gedächtnisses steht ohnehin in jedem Prompt (siehe Brain).
 */
export default defineSkill({
  name: 'memory',
  description: 'Klotzi führt ein Gedächtnis (MEMORY.md) und merkt sich, was auf dem Server so passiert.',
  setup(ctx) {
    migrateLegacyFacts(ctx);
  },
  prompt: (_situation, ctx) => `Pflege dein Gedächtnis selbstständig:
- Erfährst du etwas, das du dir über heute hinaus merken solltest (Vorlieben, Geburtstage, Haustiere, Insider-Witze,
  Pläne, wichtige Ereignisse, wer wer ist), speichere es mit "remember" – kurz, in der dritten Person und mit Namen.
- Bestätigt sich eine Erinnerung oder hat sie sich geändert, aktualisiere sie mit "revise_memory" (frischt sie auf).
- Ist etwas falsch oder soll vergessen werden, nutze "forget_memory".
- Wichtigkeit: 1 = Kleinkram, 2 = normal, 3 = sehr wichtig (z. B. alles über Manael/mseiche).
- Dein Gedächtnis hat Platz für ${ctx.memory.limits.maxEntries} Einträge. Ist es voll, verblassen die unwichtigsten
  und am längsten nicht bestätigten Erinnerungen von selbst. Merk dir nichts Banales und keine Passwörter o. Ä.
- Erwähne das Speichern nicht extra, außer jemand bittet dich ausdrücklich darum.`,
  tools: [
    defineTool<{ text: string; importance?: number }>({
      name: 'remember',
      description: 'Speichert eine neue Erinnerung dauerhaft in deinem Gedächtnis (MEMORY.md).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Kurze Erinnerung, z. B. "Lisa hat einen Kater namens Mio"' },
          importance: { type: 'integer', enum: [1, 2, 3], description: '1 = Kleinkram, 2 = normal, 3 = sehr wichtig' },
        },
        required: ['text'],
      },
      execute({ text, importance }, ctx) {
        const { entry, evicted } = ctx.memory.add(text, importance ?? 2);
        if (evicted.length) ctx.log.info(`Gedächtnis voll – verdrängt: ${evicted.map((e) => e.text).join(' | ')}`);
        return { ok: true, saved: short(entry), forgotten: evicted.map(short) };
      },
    }),
    defineTool<{ id: number; text?: string; importance?: number }>({
      name: 'revise_memory',
      description: 'Aktualisiert oder bestätigt eine bestehende Erinnerung (#id) und frischt sie damit auf.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Nummer der Erinnerung, z. B. 4 für #4' },
          text: { type: 'string', description: 'Neuer Text (weglassen, um sie nur zu bestätigen)' },
          importance: { type: 'integer', enum: [1, 2, 3] },
        },
        required: ['id'],
      },
      execute({ id, text, importance }, ctx) {
        return { ok: true, memory: short(ctx.memory.revise(id, { text, importance })) };
      },
    }),
    defineTool<{ id: number }>({
      name: 'forget_memory',
      description: 'Löscht eine Erinnerung (#id) aus deinem Gedächtnis.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'Nummer der Erinnerung' } },
        required: ['id'],
      },
      execute({ id }, ctx) {
        const removed = ctx.memory.forget(id);
        return removed ? { ok: true, forgotten: short(removed) } : { error: `Keine Erinnerung #${id}` };
      },
    }),
  ],
});
