import { ANIMATION_NAMES, isAnimationName } from '@klotzi/shared';
import { ANIMATION_GUIDE } from '../core/persona.ts';
import { defineSkill, defineTool } from '../core/skill.ts';

/** Lässt Klotzi im Call (3D-Activity) passende Animationen spielen. */
export default defineSkill({
  name: 'emote',
  description: 'Klotzi drückt seine Gefühle im Call mit 3D-Animationen aus.',
  prompt: `Du trittst im Sprach-Call als animierter 3D-Höllenhund auf. Mit dem Tool
"perform_animation" zeigst du dort deine Gefühle. Nutze es bei fast jeder Antwort
genau einmal mit der Animation, die am besten zu deiner Antwort passt. Animationen:
${ANIMATION_GUIDE}`,
  tools: [
    defineTool<{ animation: string; intensity?: number }>({
      name: 'perform_animation',
      description: 'Spielt eine Animation von Klotzi im Sprach-Call ab.',
      parameters: {
        type: 'object',
        properties: {
          animation: { type: 'string', enum: ANIMATION_NAMES },
          intensity: { type: 'number', minimum: 0.3, maximum: 1.5, description: 'Wie stark (1 = normal)' },
        },
        required: ['animation'],
      },
      execute({ animation, intensity }, ctx) {
        if (!isAnimationName(animation)) return { error: `Unbekannte Animation ${animation}` };
        ctx.stage.animate(ctx.guildId, animation, intensity);
        const audience = ctx.guildId ? ctx.stage.audience(ctx.guildId) : 0;
        return { ok: true, zuschauer: audience };
      },
    }),
  ],
});
