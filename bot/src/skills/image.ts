import { createHash } from 'node:crypto';
import type { ImageGenerateParamsNonStreaming } from 'openai/resources/images';
import { defineSkill, defineTool } from '../core/skill.ts';

const SIZES = {
  quadrat: '1024x1024',
  quer: '1536x1024',
  hoch: '1024x1536',
} as const;
type Format = keyof typeof SIZES;

/** Wann hat Klotzi in welchem Kanal zuletzt ein Bild gemalt? */
const lastImage = new Map<string, number>();

/** Ein stabiler, anonymer Bezeichner pro Discord-User für die Missbrauchserkennung von OpenAI. */
function safetyId(userId: string): string {
  return createHash('sha256').update(`klotzi:${userId}`).digest('hex').slice(0, 32);
}

/** Klotzi malt Bilder und hängt sie an seine Antwort. */
export default defineSkill({
  name: 'image',
  description: 'Klotzi malt Bilder (OpenAI Images API) und hängt sie an seine Antworten.',
  prompt: `Mit dem Tool "generate_image" kannst du ein Bild malen, das an deine Antwort
angehängt wird. Nutze es, wenn jemand ein Bild, eine Zeichnung, ein Foto, ein Meme o. Ä.
haben möchte, oder wenn ein Bild deine Antwort wirklich deutlich besser macht (z. B. etwas
zeigen, das sich schwer beschreiben lässt). Nicht bei normalem Smalltalk und höchstens ein
Bild pro Antwort. Schreibe den Bild-Prompt ausführlich und konkret (Motiv, Stil, Stimmung,
Perspektive). Wenn du dich selbst malst: ein riesiger, verspielter Höllenhund. Kommentiere
das Bild in deiner Antwort kurz – der Text darf aber nicht so tun, als wäre es schon fertig,
wenn das Tool einen Fehler meldet.`,
  tools: [
    defineTool<{ prompt: string; format?: Format }>({
      name: 'generate_image',
      description:
        'Malt ein Bild nach einer Beschreibung und hängt es an deine Antwort. Dauert einige Sekunden.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Ausführliche Bildbeschreibung (Motiv, Stil, Stimmung).' },
          format: { type: 'string', enum: Object.keys(SIZES), description: 'Bildformat (Standard: quadrat)' },
        },
        required: ['prompt'],
      },
      async execute({ prompt, format }, ctx) {
        if (!prompt?.trim()) return { error: 'Leerer Bild-Prompt' };
        if (ctx.attachments().length > 0) return { error: 'Für diese Antwort hast du schon ein Bild gemalt.' };

        const { model, quality, cooldown } = ctx.config.images;
        const key = ctx.channelId;
        const waitMs = (lastImage.get(key) ?? 0) + cooldown * 1000 - Date.now();
        if (waitMs > 0) {
          return { error: `Pfoten brauchen Pause: nächstes Bild in diesem Kanal erst in ${Math.ceil(waitMs / 1000)} s.` };
        }
        lastImage.set(key, Date.now());

        try {
          const response = await ctx.openai.images.generate({
            model,
            prompt: prompt.trim(),
            size: SIZES[format ?? 'quadrat'] ?? SIZES.quadrat,
            quality: quality as ImageGenerateParamsNonStreaming['quality'],
            output_format: 'png',
            n: 1,
            safety_identifier: safetyId(ctx.userId),
          } satisfies ImageGenerateParamsNonStreaming);
          const b64 = response.data?.[0]?.b64_json;
          if (!b64) {
            lastImage.delete(key);
            return { error: 'Die Images API hat kein Bild geliefert.' };
          }
          ctx.attach({ name: 'klotzi.png', data: Buffer.from(b64, 'base64'), description: prompt.trim() });
          ctx.log.info(`Bild gemalt für ${ctx.userName} (${model}, ${format ?? 'quadrat'})`);
          return { ok: true, hinweis: 'Das Bild wird an deine Antwort angehängt.' };
        } catch (err) {
          lastImage.delete(key);
          throw err;
        }
      },
    }),
  ],
});

/** Nur für Tests: Cooldowns zurücksetzen. */
export function resetImageCooldowns(): void {
  lastImage.clear();
}
