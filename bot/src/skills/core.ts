import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { defineSkill } from '../core/skill.ts';

/** Grundfunktionen: Hilfe-Übersicht über alle geladenen Skills. */
export default defineSkill({
  name: 'core',
  description: 'Stellt Klotzi vor und listet seine Fähigkeiten (/klotzi).',
  commands: [
    {
      data: new SlashCommandBuilder().setName('klotzi').setDescription('Wer ist Klotzi und was kann er?'),
      async execute(interaction, ctx) {
        const skills = ctx
          .skills()
          .map((s) => {
            const cmds = (s.commands ?? []).map((c) => `\`/${'toJSON' in c.data ? c.data.toJSON().name : c.data.name}\``);
            return `**${s.name}** – ${s.description}${cmds.length ? ` ${cmds.join(' ')}` : ''}`;
          })
          .join('\n');
        const embed = new EmbedBuilder()
          .setColor(0xff5a1f)
          .setTitle('🔥 Wuff! Ich bin Klotzi, dein Höllenhund 🐾')
          .setDescription(
            [
              'Erwähne mich, antworte auf meine Nachrichten oder ruf einfach meinen Namen – dann belle ich zurück.',
              'Im Sprach-Call kannst du mich über den **Aktivitäten-Button (🚀)** auf die Bühne holen und mir live zuschauen.',
              '',
              '__Meine Fähigkeiten__',
              skills,
            ].join('\n'),
          );
        await interaction.reply({ embeds: [embed] });
        ctx.stage.animate(interaction.guildId, 'bark');
      },
    },
  ],
});
