import { SlashCommandBuilder } from 'discord.js';
import { defineSkill } from '../core/skill.ts';

const STICKS = ['ein Stöckchen', 'einen glühenden Ast', 'einen Knochen aus der Unterwelt', 'einen Tennisball (jetzt leicht angekokelt)'];

/** Stöckchen werfen – Klotzi rennt im Call los und bringt es zurück. */
export default defineSkill({
  name: 'fetch',
  description: 'Wirf Klotzi ein Stöckchen (/stoeckchen) – im Call rennt er hinterher.',
  commands: [
    {
      data: new SlashCommandBuilder().setName('stoeckchen').setDescription('Wirf Klotzi ein Stöckchen'),
      async execute(interaction, ctx) {
        const stick = STICKS[Math.floor(Math.random() * STICKS.length)];
        ctx.stage.animate(interaction.guildId, 'fetch');
        await interaction.reply(`*${interaction.user.displayName} wirft ${stick}* … 💨 *Klotzi flitzt los* … 🐾🐾🐾`);
        setTimeout(() => {
          interaction.followUp(`*bringt ${stick} stolz zurück und legt es dir vor die Füße* Nochmal! 🔥`).catch(() => {});
        }, 4000);
      },
    },
  ],
});
