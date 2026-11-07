import { ANIMATION_NAMES, isAnimationName, type AnimationName } from '@klotzi/shared';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/completions';
import { PERSONA, ANIMATION_GUIDE } from './persona.ts';
import type { KlotziContext, Situation } from './skill.ts';
import type { SkillRegistry } from './skill-registry.ts';

/** Eine Zeile aus dem Chatverlauf. */
export interface ChatLine {
  author: string;
  fromKlotzi: boolean;
  content: string;
}

/** Spontane, meist nonverbale Reaktion auf eine Chat-Nachricht. */
export interface Reaction {
  animation: AnimationName;
  emoji: string | null;
  comment: string | null;
}

const MAX_TOOL_ROUNDS = 5;

/**
 * Klotzis Gehirn: baut aus Persona, Skill-Prompts und Chatverlauf eine
 * Anfrage an OpenAI und führt die Tool-Aufrufe der Skills aus.
 */
export class Brain {
  constructor(
    private readonly ctx: KlotziContext,
    private readonly skills: SkillRegistry,
  ) {}

  private async systemPrompt(situation: Situation): Promise<string> {
    const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const skillPrompts = await this.skills.prompts(situation, this.ctx);
    return [
      PERSONA,
      `Aktuelle Zeit (Europe/Berlin): ${now}.`,
      `Du sprichst gerade mit ${situation.userName}.`,
      ...skillPrompts,
    ].join('\n\n');
  }

  private static historyMessages(history: ChatLine[]): ChatCompletionMessageParam[] {
    return history.map((line) =>
      line.fromKlotzi
        ? { role: 'assistant', content: line.content }
        : { role: 'user', content: `${line.author}: ${line.content}` },
    );
  }

  /** Eine Antwort auf den Chat formulieren (inkl. Tool-Aufrufen der Skills). */
  async reply(situation: Situation, history: ChatLine[]): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: await this.systemPrompt(situation) },
      ...Brain.historyMessages(history),
    ];
    const tools = this.skills.openAiTools();
    const { openai, config, log } = this.ctx;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const completion = await openai.chat.completions.create({
        model: config.openai.model,
        max_completion_tokens: config.openai.maxTokens,
        messages,
        ...(tools.length && !lastRound ? { tools } : {}),
      });
      const message = completion.choices[0]?.message;
      if (!message) break;

      const calls = (message.tool_calls ?? []).filter(
        (c): c is ChatCompletionMessageFunctionToolCall => c.type === 'function',
      );
      if (calls.length === 0) return message.content?.trim() || '*wedelt verlegen mit dem Schwanz* 🐾';

      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const result = await this.runTool(call, situation);
        log.debug(`Tool ${call.function.name}(${call.function.arguments}) →`, result);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result ?? null) });
      }
    }
    return '*verheddert sich im eigenen Schwanz* Wuff… da ist was schiefgelaufen. 🔥';
  }

  private async runTool(call: ChatCompletionMessageFunctionToolCall, situation: Situation): Promise<unknown> {
    const tool = this.skills.getTool(call.function.name);
    if (!tool) return { error: `Unbekanntes Tool ${call.function.name}` };
    try {
      const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      return await tool.execute(args, { ...this.ctx, ...situation });
    } catch (err) {
      this.ctx.log.warn(`Tool ${call.function.name} fehlgeschlagen`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Spontane Reaktion auf eine Nachricht, die nicht an Klotzi gerichtet war:
   * eine Animation im Call, optional ein Emoji und selten ein Kommentar.
   */
  async react(situation: Situation, history: ChatLine[]): Promise<Reaction> {
    const { openai, config } = this.ctx;
    const completion = await openai.chat.completions.create({
      model: config.openai.model,
      max_completion_tokens: 200,
      messages: [
        {
          role: 'system',
          content: `${PERSONA}

Du liest gerade im Chat mit, die letzte Nachricht war aber NICHT an dich gerichtet.
Reagiere wie ein Hund: wähle eine passende Animation für deinen 3D-Auftritt im Call,
optional ein passendes Emoji als Reaktion auf die Nachricht und nur ganz selten
(wenn es wirklich lustig oder passend ist) einen sehr kurzen Kommentar, sonst null.

Animationen:
${ANIMATION_GUIDE}`,
        },
        ...Brain.historyMessages(history),
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'reaction',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['animation', 'emoji', 'comment'],
            properties: {
              animation: { type: 'string', enum: ANIMATION_NAMES },
              emoji: { type: ['string', 'null'], description: 'Ein einzelnes Unicode-Emoji oder null' },
              comment: { type: ['string', 'null'], description: 'Sehr kurzer Kommentar oder null' },
            },
          },
        },
      },
    });
    return parseReaction(completion.choices[0]?.message.content);
  }
}

export function parseReaction(raw: string | null | undefined): Reaction {
  const fallback: Reaction = { animation: 'idle', emoji: null, comment: null };
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof Reaction, unknown>>;
    return {
      animation: isAnimationName(data.animation) ? data.animation : 'idle',
      emoji: typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : null,
      comment: typeof data.comment === 'string' && data.comment.trim() ? data.comment.trim() : null,
    };
  } catch {
    return fallback;
  }
}
