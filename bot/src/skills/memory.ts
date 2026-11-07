import { defineSkill, defineTool } from '../core/skill.ts';
import type { JsonStore } from '../core/store.ts';

interface MemoryData {
  /** userId → gemerkte Fakten */
  facts: Record<string, string[]>;
}

const MAX_FACTS = 20;
let store: JsonStore<MemoryData>;

/** Klotzi merkt sich Dinge über die Leute im Chat (Hundegedächtnis, aber dauerhaft). */
export default defineSkill({
  name: 'memory',
  description: 'Klotzi merkt sich, was ihr ihm über euch erzählt.',
  setup(ctx) {
    store = ctx.store<MemoryData>('memory', { facts: {} });
  },
  prompt({ userId, userName }) {
    const facts = store.data.facts[userId] ?? [];
    const known = facts.length
      ? `Was du über ${userName} weißt:\n${facts.map((f) => `- ${f}`).join('\n')}`
      : `Über ${userName} weißt du noch nichts.`;
    return `${known}\nWenn ${userName} dir etwas Persönliches erzählt, das du dir merken solltest (Vorlieben, Haustiere, Geburtstag …), speichere es mit "remember_fact". Soll etwas vergessen werden, nutze "forget_facts".`;
  },
  tools: [
    defineTool<{ fact: string }>({
      name: 'remember_fact',
      description: 'Merkt sich einen kurzen Fakt über die Person, mit der du gerade sprichst.',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string', description: 'Kurzer Fakt in der dritten Person, z. B. "mag Pizza Hawaii"' } },
        required: ['fact'],
      },
      execute({ fact }, ctx) {
        const clean = fact.trim().slice(0, 200);
        if (!clean) return { error: 'leerer Fakt' };
        store.update((d) => {
          const list = (d.facts[ctx.userId] ??= []);
          if (!list.includes(clean)) list.push(clean);
          if (list.length > MAX_FACTS) list.splice(0, list.length - MAX_FACTS);
        });
        return { ok: true };
      },
    }),
    defineTool<{ contains?: string }>({
      name: 'forget_facts',
      description: 'Vergisst Fakten über die aktuelle Person – alle oder nur die, die einen Suchbegriff enthalten.',
      parameters: {
        type: 'object',
        properties: { contains: { type: 'string', description: 'Optionaler Suchbegriff' } },
      },
      execute({ contains }, ctx) {
        let removed = 0;
        store.update((d) => {
          const list = d.facts[ctx.userId] ?? [];
          const keep = contains ? list.filter((f) => !f.toLowerCase().includes(contains.toLowerCase())) : [];
          removed = list.length - keep.length;
          d.facts[ctx.userId] = keep;
        });
        return { ok: true, removed };
      },
    }),
  ],
});
