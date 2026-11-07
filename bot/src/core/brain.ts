import { ANIMATION_NAMES, isAnimationName, type AnimationName } from '@klotzi/shared';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';
import type { ReasoningEffort } from 'openai/resources/shared';
import { PERSONA, ANIMATION_GUIDE } from './persona.ts';
import type { KlotziContext, Situation } from './skill.ts';
import type { SkillRegistry } from './skill-registry.ts';

/** Eine Zeile aus dem Chatverlauf. */
export interface ChatLine {
  author: string;
  fromKlotzi: boolean;
  content: string;
  /** Zeitpunkt der Nachricht (ms seit 1970), falls bekannt. */
  at?: number;
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
 * Anfrage an die OpenAI Responses API und führt die Tool-Aufrufe der Skills aus.
 *
 * Die Anfragen sind zustandslos (`store: false`): der komplette Verlauf inkl.
 * Tool-Aufrufen wird jedes Mal mitgeschickt. Damit Reasoning-Modelle ihre
 * Gedanken zwischen den Tool-Runden behalten, wird das verschlüsselte
 * Reasoning mit angefordert und zurückgereicht.
 */
export class Brain {
  constructor(
    private readonly ctx: KlotziContext,
    private readonly skills: SkillRegistry,
  ) {}

  /** Gemeinsame Parameter aller Anfragen. */
  private baseParams(maxTokens = this.ctx.config.openai.maxTokens) {
    const { model, reasoningEffort } = this.ctx.config.openai;
    return {
      model,
      max_output_tokens: maxTokens,
      store: false,
      include: ['reasoning.encrypted_content'],
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort as ReasoningEffort } } : {}),
    } satisfies Partial<ResponseCreateParamsNonStreaming>;
  }

  private async instructions(situation: Situation): Promise<string> {
    const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const skillPrompts = await this.skills.prompts(situation, this.ctx);
    const hours = this.ctx.config.chat?.historyHours ?? 24;
    return [
      PERSONA,
      `Aktuelle Zeit (Europe/Berlin): ${now}.`,
      `Du siehst den Chatverlauf dieses Kanals der letzten ${hours} Stunden (Zeitangaben in eckigen Klammern). ` +
        `Beziehe dich vor allem auf die neueste Nachricht, nutze den Rest als Kontext.`,
      `Du sprichst gerade mit ${situation.userName} (Discord-ID ${situation.userId}).`,
      this.ctx.memory.prompt(),
      ...skillPrompts,
    ].join('\n\n');
  }

  /** Zeitstempel für den Verlauf, z. B. "Sa 14:03". */
  static formatTime(at: number): string {
    return new Date(at).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private static historyInput(history: ChatLine[]): ResponseInputItem[] {
    return history.map((line) =>
      line.fromKlotzi
        ? { role: 'assistant', content: line.content }
        : {
            role: 'user',
            content: `${line.at !== undefined ? `[${Brain.formatTime(line.at)}] ` : ''}${line.author}: ${line.content}`,
          },
    );
  }

  /** Eine Antwort auf den Chat formulieren (inkl. Tool-Aufrufen der Skills). */
  async reply(situation: Situation, history: ChatLine[]): Promise<string> {
    const { openai, log } = this.ctx;
    const instructions = await this.instructions(situation);
    const input: ResponseInputItem[] = Brain.historyInput(history);
    const tools = this.skills.openAiTools();

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const response = await openai.responses.create({
        ...this.baseParams(),
        instructions,
        input,
        ...(tools.length && !lastRound ? { tools } : {}),
      });

      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');
      if (calls.length === 0) return response.output_text?.trim() || '*wedelt verlegen mit dem Schwanz* 🐾';

      // Ausgabe (Reasoning, Tool-Aufrufe) zurück in den Verlauf, dann die Ergebnisse anhängen
      input.push(...(response.output as ResponseInputItem[]));
      for (const call of calls) {
        const result = await this.runTool(call, situation);
        log.debug(`Tool ${call.name}(${call.arguments}) →`, result);
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result ?? null) });
      }
    }
    return '*verheddert sich im eigenen Schwanz* Wuff… da ist was schiefgelaufen. 🔥';
  }

  private async runTool(call: ResponseFunctionToolCall, situation: Situation): Promise<unknown> {
    const tool = this.skills.getTool(call.name);
    if (!tool) return { error: `Unbekanntes Tool ${call.name}` };
    try {
      const args = call.arguments ? JSON.parse(call.arguments) : {};
      return await tool.execute(args, { ...this.ctx, ...situation });
    } catch (err) {
      this.ctx.log.warn(`Tool ${call.name} fehlgeschlagen`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Klotzi hat gerade etwas gesagt und lauscht noch mit: Bezieht sich die
   * neueste Nachricht (ohne dass sein Name fällt) trotzdem auf ihn?
   * Nutzt die Decisions API und liefert eine Wahrscheinlichkeit (0–1).
   */
  async isAboutKlotzi(history: ChatLine[]): Promise<number> {
    const last = history.at(-1);
    if (!last || last.fromKlotzi) return 0;
    const decision = await this.ctx.openai.decisions.create({
      model: this.ctx.config.openai.decisionModel,
      input: [
        {
          role: 'developer',
          content:
            'Ausschnitt aus einem Discord-Chat. "Klotzi" ist ein Bot (ein riesiger, verspielter Höllenhund), ' +
            'seine eigenen Nachrichten sind die Assistant-Nachrichten. Er hat gerade selbst etwas geschrieben.',
        },
        ...history.map((line) =>
          line.fromKlotzi
            ? ({ role: 'assistant', content: line.content } as const)
            : ({ role: 'user', content: `${line.author}: ${line.content}` } as const),
        ),
      ],
      questions: [
        {
          type: 'predicate',
          name: 'addressed_to_klotzi',
          instructions:
            'Ist die LETZTE Nachricht an Klotzi gerichtet oder bezieht sie sich so direkt auf ihn ' +
            '(z. B. Antwort auf seine Frage, Reaktion auf das, was er gesagt hat, Bitte oder Frage an ihn), ' +
            'dass Klotzi darauf antworten sollte? Unterhalten sich die Leute nur untereinander über etwas ' +
            'anderes, ist die Antwort nein.',
        },
      ],
    });
    const answer = decision.answers.find((a) => a.name === 'addressed_to_klotzi') ?? decision.answers[0];
    return answer?.type === 'predicate' ? answer.probability : 0;
  }

  /**
   * Spontane Reaktion auf eine Nachricht, die nicht an Klotzi gerichtet war:
   * eine Animation im Call, optional ein Emoji und selten ein Kommentar.
   */
  async react(_situation: Situation, history: ChatLine[]): Promise<Reaction> {
    const response = await this.ctx.openai.responses.create({
      ...this.baseParams(Math.min(1000, this.ctx.config.openai.maxTokens)),
      instructions: `${PERSONA}

Du liest gerade im Chat mit, die letzte Nachricht war aber NICHT an dich gerichtet.
Reagiere wie ein Hund: wähle eine passende Animation für deinen 3D-Auftritt im Call,
optional ein passendes Emoji als Reaktion auf die Nachricht und nur ganz selten
(wenn es wirklich lustig oder passend ist) einen sehr kurzen Kommentar, sonst null.

Animationen:
${ANIMATION_GUIDE}`,
      input: Brain.historyInput(history),
      text: {
        format: {
          type: 'json_schema',
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
    return parseReaction(response.output_text);
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
