import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { defineSkill, defineTool } from '../core/skill.ts';

export interface DiceRoll {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
}

/** Würfelt nach Notation wie `d20`, `2d6+3` oder `4d8-1`. */
export function rollDice(notation: string, random = Math.random): DiceRoll {
  const match = /^\s*(\d*)\s*[dwDW]\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(notation);
  if (!match) throw new Error(`"${notation}" verstehe ich nicht – probier z. B. 2d6+3`);
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0;
  if (count < 1 || count > 100) throw new Error('Zwischen 1 und 100 Würfel, bitte!');
  if (sides < 2 || sides > 1000) throw new Error('Ein Würfel braucht 2 bis 1000 Seiten.');
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return { notation: `${count}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`, rolls, modifier, total };
}

export default defineSkill({
  name: 'dice',
  description: 'Würfelt mit Höllenwürfeln (/wuerfeln, oder einfach fragen).',
  tools: [
    defineTool<{ notation: string }>({
      name: 'roll_dice',
      description: 'Würfelt mit echten Zufallszahlen. Immer benutzen, wenn jemand würfeln will.',
      parameters: {
        type: 'object',
        properties: { notation: { type: 'string', description: 'Würfelnotation, z. B. "d20" oder "2d6+3"' } },
        required: ['notation'],
      },
      execute: ({ notation }) => rollDice(notation),
    }),
  ],
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('wuerfeln')
        .setDescription('Klotzi würfelt für dich')
        .addStringOption((o) => o.setName('wuerfel').setDescription('z. B. d20 oder 2d6+3 (Standard: d6)')),
      async execute(interaction, ctx) {
        try {
          const roll = rollDice(interaction.options.getString('wuerfel') ?? 'd6');
          const detail = roll.rolls.length > 1 || roll.modifier ? ` (${roll.rolls.join(' + ')}${roll.modifier ? ` ${roll.modifier > 0 ? '+' : '-'} ${Math.abs(roll.modifier)}` : ''})` : '';
          ctx.stage.animate(interaction.guildId, 'excited');
          ctx.stage.say(interaction.guildId, `${roll.notation}: ${roll.total}!`);
          await interaction.reply(`🎲 *schubst den Würfel mit der Schnauze* **${roll.notation}** → **${roll.total}**${detail} 🔥`);
        } catch (err) {
          await interaction.reply({ content: `🐾 ${(err as Error).message}`, flags: MessageFlags.Ephemeral });
        }
      },
    },
  ],
});
