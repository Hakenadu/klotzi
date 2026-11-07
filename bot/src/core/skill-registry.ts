import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions';
import type { KlotziContext, Situation, Skill, SkillCommand, SkillTool } from './skill.ts';

export interface SkillFilter {
  enabled: string[];
  disabled: string[];
}

/**
 * Verwaltet alle geladenen Skills und stellt deren Tools, Prompts und
 * Commands gesammelt zur Verfügung.
 */
export class SkillRegistry {
  private readonly skills: Skill[] = [];
  private readonly tools = new Map<string, SkillTool>();
  private readonly commands = new Map<string, SkillCommand>();

  register(skill: Skill): void {
    if (this.skills.some((s) => s.name === skill.name)) {
      throw new Error(`Skill "${skill.name}" ist doppelt registriert`);
    }
    for (const tool of skill.tools ?? []) {
      if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" (Skill ${skill.name}) existiert bereits`);
    }
    for (const command of skill.commands ?? []) {
      const name = commandJson(command).name;
      if (this.commands.has(name)) throw new Error(`Command "/${name}" (Skill ${skill.name}) existiert bereits`);
    }
    this.skills.push(skill);
    for (const tool of skill.tools ?? []) this.tools.set(tool.name, tool);
    for (const command of skill.commands ?? []) this.commands.set(commandJson(command).name, command);
  }

  /**
   * Lädt automatisch alle Skills aus einem Verzeichnis. Jede Datei muss
   * `export default defineSkill({...})` enthalten. Dateien mit `_` am Anfang
   * werden ignoriert (z. B. für Hilfsfunktionen).
   */
  async loadDirectory(dir: string, filter: SkillFilter): Promise<Skill[]> {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith('.d.ts') && !f.startsWith('_'))
      .sort();
    const loaded: Skill[] = [];
    for (const file of files) {
      const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as { default?: Skill };
      const skill = mod.default;
      if (!skill?.name) throw new Error(`${file} exportiert keinen Skill (export default defineSkill(...))`);
      if (!isEnabled(skill.name, filter)) continue;
      this.register(skill);
      loaded.push(skill);
    }
    return loaded;
  }

  async setup(ctx: KlotziContext): Promise<void> {
    for (const skill of this.skills) await skill.setup?.(ctx);
  }

  list(): readonly Skill[] {
    return this.skills;
  }

  getTool(name: string): SkillTool | undefined {
    return this.tools.get(name);
  }

  getCommand(name: string): SkillCommand | undefined {
    return this.commands.get(name);
  }

  allCommands(): SkillCommand[] {
    return [...this.commands.values()];
  }

  /** Tool-Definitionen im OpenAI-Format. */
  openAiTools(): ChatCompletionFunctionTool[] {
    return [...this.tools.values()].map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters as any },
    }));
  }

  /** Alle Prompt-Bausteine der Skills für eine konkrete Situation. */
  async prompts(situation: Situation, ctx: KlotziContext): Promise<string[]> {
    const parts = await Promise.all(
      this.skills.map(async (skill) => {
        try {
          return typeof skill.prompt === 'function' ? await skill.prompt(situation, ctx) : skill.prompt;
        } catch (err) {
          ctx.log.warn(`Prompt von Skill ${skill.name} fehlgeschlagen`, err);
          return undefined;
        }
      }),
    );
    return parts.filter((p): p is string => Boolean(p?.trim()));
  }

  /** Hooks aller Skills; `true`, wenn ein Skill die Nachricht vollständig erledigt hat. */
  async runMessageHooks(...args: Parameters<NonNullable<Skill['onMessage']>>): Promise<boolean> {
    const [, ctx] = args;
    for (const skill of this.skills) {
      try {
        if (await skill.onMessage?.(...args)) return true;
      } catch (err) {
        ctx.log.warn(`onMessage von Skill ${skill.name} fehlgeschlagen`, err);
      }
    }
    return false;
  }
}

export function commandJson(command: SkillCommand) {
  return 'toJSON' in command.data ? command.data.toJSON() : command.data;
}

function isEnabled(name: string, filter: SkillFilter): boolean {
  if (filter.disabled.includes(name)) return false;
  return filter.enabled.length === 0 || filter.enabled.includes(name);
}
