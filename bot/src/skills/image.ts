import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { toFile } from 'openai';
import type { ImageEditParamsNonStreaming, ImageGenerateParamsNonStreaming } from 'openai/resources/images';
import { findCharacter, loadCharacters, mimeType, type Character } from '../core/characters.ts';
import { defineSkill, defineTool, type KlotziContext } from '../core/skill.ts';

const SIZES = {
  quadrat: '1024x1024',
  quer: '1536x1024',
  hoch: '1024x1536',
} as const;
type Format = keyof typeof SIZES;

/** Höchstens so viele Referenzbilder pro Bild. */
const MAX_REFERENCES = 6;

/** Wann hat Klotzi in welchem Kanal zuletzt ein Bild gemalt? */
const lastImage = new Map<string, number>();

let cachedCharacters: { key: string; list: Character[] } | undefined;

/** Bekannte Charaktere (Referenzbilder), einmalig pro Verzeichnis-Konfiguration geladen. */
function characters(ctx: KlotziContext): Character[] {
  const dirs = ctx.config.images?.characterDirs ?? [];
  const key = dirs.join('|');
  if (cachedCharacters?.key !== key) cachedCharacters = { key, list: loadCharacters(...dirs) };
  return cachedCharacters.list;
}

/** Ein stabiler, anonymer Bezeichner pro Discord-User für die Missbrauchserkennung von OpenAI. */
function safetyId(userId: string): string {
  return createHash('sha256').update(`klotzi:${userId}`).digest('hex').slice(0, 32);
}

/** Bild-Prompt um die Zuordnung der Referenzbilder und Hinweise zu den Charakteren ergänzen. */
export function referencePrompt(prompt: string, refs: readonly Character[]): string {
  if (refs.length === 0) return prompt;
  const lines = refs.map((c, i) => {
    const note = c.imageNote ? ` ${c.imageNote}` : '';
    return `- Referenzbild ${i + 1} zeigt ${c.name}.${note}`;
  });
  return [
    prompt,
    '',
    'Die angehängten Referenzbilder zeigen die Charaktere, die im Bild vorkommen. ' +
      'Übernimm ihr Aussehen (Gesicht, Merkmale, Kleidung), sofern oben nichts anderes verlangt ist:',
    ...lines,
  ].join('\n');
}

/** Klotzi malt Bilder und hängt sie an seine Antwort. */
export default defineSkill({
  name: 'image',
  description: 'Klotzi malt Bilder (OpenAI Images API) – auch mit Referenzbildern bekannter Charaktere – und hängt sie an.',
  prompt: (_situation, ctx) => {
    const known = characters(ctx)
      .map((c) => `- ${c.name}${c.aliases.length ? ` (auch: ${c.aliases.join(', ')})` : ''}${c.about ? `: ${c.about}` : ''}`)
      .join('\n');
    return `Mit dem Tool "generate_image" kannst du ein Bild malen, das an deine Antwort
angehängt wird. Nutze es, wenn jemand ein Bild, eine Zeichnung, ein Foto, ein Meme o. Ä.
haben möchte, oder wenn ein Bild deine Antwort wirklich deutlich besser macht (z. B. etwas
zeigen, das sich schwer beschreiben lässt). Nicht bei normalem Smalltalk und höchstens ein
Bild pro Antwort. Schreibe den Bild-Prompt ausführlich und konkret (Motiv, Stil, Stimmung,
Perspektive). Kommentiere das Bild in deiner Antwort kurz – tu aber nicht so, als wäre es
fertig, wenn das Tool einen Fehler meldet.${
      known
        ? `

Von diesen Charakteren hast du Referenzbilder. Kommt einer davon im Bild vor (auch du selbst),
gib ihn im Parameter "characters" an, damit er wiedererkennbar aussieht:
${known}`
        : ''
    }`;
  },
  tools: [
    defineTool<{ prompt: string; format?: Format; characters?: string[] }>({
      name: 'generate_image',
      description:
        'Malt ein Bild nach einer Beschreibung und hängt es an deine Antwort. Mit "characters" werden ' +
        'Referenzbilder bekannter Charaktere mitgeschickt. Dauert einige Sekunden.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Ausführliche Bildbeschreibung (Motiv, Stil, Stimmung).' },
          format: { type: 'string', enum: Object.keys(SIZES), description: 'Bildformat (Standard: quadrat)' },
          characters: {
            type: 'array',
            items: { type: 'string' },
            description: 'Namen bekannter Charaktere, die im Bild vorkommen (Referenzbilder werden mitgeschickt).',
          },
        },
        required: ['prompt'],
      },
      async execute({ prompt, format, characters: wanted = [] }, ctx) {
        if (!prompt?.trim()) return { error: 'Leerer Bild-Prompt' };
        if (ctx.attachments().length > 0) return { error: 'Für diese Antwort hast du schon ein Bild gemalt.' };

        // Referenzbilder auflösen
        const known = characters(ctx);
        const refs: Character[] = [];
        for (const name of wanted) {
          const character = findCharacter(known, name);
          if (!character) {
            return { error: `Kein Referenzbild von "${name}". Bekannt sind: ${known.map((c) => c.name).join(', ') || 'niemand'}` };
          }
          if (!refs.includes(character)) refs.push(character);
        }
        if (refs.length > MAX_REFERENCES) return { error: `Höchstens ${MAX_REFERENCES} Charaktere pro Bild.` };

        const { model, quality, cooldown } = ctx.config.images;
        const key = ctx.channelId;
        const waitMs = (lastImage.get(key) ?? 0) + cooldown * 1000 - Date.now();
        if (waitMs > 0) {
          return { error: `Pfoten brauchen Pause: nächstes Bild in diesem Kanal erst in ${Math.ceil(waitMs / 1000)} s.` };
        }
        lastImage.set(key, Date.now());

        const common = {
          model,
          prompt: referencePrompt(prompt.trim(), refs),
          size: SIZES[format ?? 'quadrat'] ?? SIZES.quadrat,
          output_format: 'png' as const,
          n: 1,
          safety_identifier: safetyId(ctx.userId),
        };
        try {
          const response = refs.length
            ? await ctx.openai.images.edit({
                ...common,
                quality: quality as ImageEditParamsNonStreaming['quality'],
                input_fidelity: 'high',
                image: await Promise.all(
                  refs.map(async (c) => toFile(await fs.readFile(c.file), path.basename(c.file), { type: mimeType(c.file) })),
                ),
              } satisfies ImageEditParamsNonStreaming)
            : await ctx.openai.images.generate({
                ...common,
                quality: quality as ImageGenerateParamsNonStreaming['quality'],
              } satisfies ImageGenerateParamsNonStreaming);
          const b64 = response.data?.[0]?.b64_json;
          if (!b64) {
            lastImage.delete(key);
            return { error: 'Die Images API hat kein Bild geliefert.' };
          }
          ctx.attach({ name: 'klotzi.png', data: Buffer.from(b64, 'base64'), description: prompt.trim() });
          ctx.log.info(
            `Bild gemalt für ${ctx.userName} (${model}, ${format ?? 'quadrat'}` +
              `${refs.length ? `, mit ${refs.map((c) => c.name).join(', ')}` : ''})`,
          );
          return { ok: true, hinweis: 'Das Bild wird an deine Antwort angehängt.' };
        } catch (err) {
          lastImage.delete(key);
          throw err;
        }
      },
    }),
  ],
});

/** Nur für Tests: Cooldowns und geladene Charaktere zurücksetzen. */
export function resetImageCooldowns(): void {
  lastImage.clear();
  cachedCharacters = undefined;
}
