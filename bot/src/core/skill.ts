import type {
  ChatInputCommandInteraction,
  Client,
  Message,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type OpenAI from 'openai';
import type { Config } from '../config.ts';
import type { Logger } from './logger.ts';
import type { Stage } from './stage.ts';
import type { JsonStore } from './store.ts';

/**
 * Alles, was ein Skill von Klotzi benutzen darf.
 */
export interface KlotziContext {
  client: Client;
  config: Config;
  openai: OpenAI;
  /** Die Bühne: steuert Klotzis 3D-Auftritt in den Calls. */
  stage: Stage;
  /** Persistenter JSON-Speicher (eine Datei pro Namespace). */
  store<T extends object>(namespace: string, initial: T): JsonStore<T>;
  log: Logger;
  /** Alle geladenen Skills (z. B. für eine Hilfe-Übersicht). */
  skills(): readonly Skill[];
}

/** Infos darüber, wer gerade mit Klotzi spricht. */
export interface Situation {
  guildId: string | null;
  channelId: string;
  userId: string;
  userName: string;
  /** Die auslösende Chat-Nachricht (fehlt z. B. bei Slash-Commands). */
  message?: Message;
}

export type ToolContext = KlotziContext & Situation;

/** JSON-Schema für die Parameter eines Tools (OpenAI Function Calling). */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Ein Werkzeug, das Klotzis "Gehirn" (OpenAI) selbstständig aufrufen kann.
 */
export interface SkillTool<Args = any> {
  /** Eindeutiger Name, z. B. `roll_dice`. */
  name: string;
  /** Beschreibung für das Modell: wann und wofür das Tool benutzt wird. */
  description: string;
  parameters: JsonSchemaObject;
  /** Ergebnis wird als JSON an das Modell zurückgegeben. */
  execute(args: Args, ctx: ToolContext): unknown | Promise<unknown>;
}

/** Ein Slash-Command, den der Skill mitbringt. */
export interface SkillCommand {
  /** z. B. ein `SlashCommandBuilder` oder rohes JSON. */
  data: RESTPostAPIChatInputApplicationCommandsJSONBody | { toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction, ctx: KlotziContext): Promise<void>;
}

/**
 * Ein Skill erweitert Klotzi modular. Jede Datei in `src/skills/` exportiert
 * per `export default defineSkill({...})` genau einen Skill und wird beim Start
 * automatisch geladen.
 */
export interface Skill {
  /** Eindeutiger, kurzer Name (wird auch für KLOTZI_SKILLS / KLOTZI_DISABLED_SKILLS benutzt). */
  name: string;
  /** Für Menschen: was kann der Skill? (erscheint in /klotzi) */
  description: string;
  /**
   * Zusätzlicher Text für Klotzis System-Prompt. Kann dynamisch sein,
   * z. B. um Wissen über den aktuellen User einzublenden.
   */
  prompt?: string | ((situation: Situation, ctx: KlotziContext) => string | undefined | Promise<string | undefined>);
  /** Werkzeuge für das Sprachmodell. */
  tools?: SkillTool[];
  /** Slash-Commands. */
  commands?: SkillCommand[];
  /** Einmalig beim Start aufgerufen – z. B. um Event-Listener zu registrieren. */
  setup?(ctx: KlotziContext): void | Promise<void>;
  /**
   * Wird für jede Chat-Nachricht aufgerufen, bevor Klotzi antwortet.
   * Gibt der Hook `true` zurück, ist die Nachricht erledigt und Klotzi antwortet nicht mehr.
   */
  onMessage?(message: Message, ctx: KlotziContext): boolean | void | Promise<boolean | void>;
}

/** Hilfsfunktion für saubere Typen beim Schreiben eines Skills. */
export function defineSkill(skill: Skill): Skill {
  return skill;
}

/** Hilfsfunktion für typisierte Tool-Argumente. */
export function defineTool<Args>(tool: SkillTool<Args>): SkillTool<Args> {
  return tool;
}
