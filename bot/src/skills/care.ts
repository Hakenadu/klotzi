import { SlashCommandBuilder } from 'discord.js';
import { defineSkill } from '../core/skill.ts';
import type { KlotziContext } from '../core/skill.ts';
import type { JsonStore } from '../core/store.ts';

interface CareData {
  /** userId → Anzahl Leckerlis */
  treats: Record<string, number>;
  /** userId → Anzahl Streicheleinheiten */
  pets: Record<string, number>;
  names: Record<string, string>;
}

const TREAT_LINES = [
  '*mampf mampf* Ein Lava-Knochen! Du bist der Beste! 🔥🦴',
  '*schnappt das Leckerli aus der Luft und kokelt es kurz an* Perfekt durch! 🐾',
  '*wedelt so doll, dass der ganze Hund mitwackelt* MEHR! …bitte? 🥺',
  '*kaut zufrieden und rülpst ein kleines Flämmchen* Hoppla. 🔥',
];
const PET_LINES = [
  '*schmilzt dahin und streckt dir den Bauch entgegen* 💕',
  '*lehnt sich mit dem ganzen Gewicht an dich und brummelt glücklich*',
  '*Schwanzflamme leuchtet herzförmig* Nochmal! 💖',
  '*schließt die Augen und schnurrt – ja, Höllenhunde schnurren* 🔥',
];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

let store: JsonStore<CareData>;

function count(kind: 'treats' | 'pets', userId: string, name: string): number {
  let total = 0;
  store.update((d) => {
    total = d[kind][userId] = (d[kind][userId] ?? 0) + 1;
    d.names[userId] = name;
  });
  return total;
}

function favourite(data: CareData): string | undefined {
  const scores = new Map<string, number>();
  for (const [id, n] of Object.entries(data.treats)) scores.set(id, (scores.get(id) ?? 0) + n * 2);
  for (const [id, n] of Object.entries(data.pets)) scores.set(id, (scores.get(id) ?? 0) + n);
  const best = [...scores].sort((a, b) => b[1] - a[1])[0];
  return best ? data.names[best[0]] : undefined;
}

function petFromStage(ctx: KlotziContext, guildId: string, userId: string | null) {
  ctx.stage.animate(guildId, 'love');
  if (userId) count('pets', userId, ctx.client.users.cache.get(userId)?.displayName ?? 'jemand');
  ctx.stage.say(guildId, pick(PET_LINES).replace(/\*/g, ''));
}

/** Leckerlis, Streicheleinheiten – und Klotzi merkt sich, wer ihn verwöhnt. */
export default defineSkill({
  name: 'care',
  description: 'Füttern und Streicheln – Klotzi merkt sich, wer ihn verwöhnt. Im Call: auf Klotzi klicken!',
  setup(ctx) {
    store = ctx.store<CareData>('care', { treats: {}, pets: {}, names: {} });
    ctx.stage.on('pet', (guildId, userId) => petFromStage(ctx, guildId, userId));
  },
  prompt({ userId }) {
    const d = store.data;
    const treats = d.treats[userId] ?? 0;
    const pets = d.pets[userId] ?? 0;
    const fav = favourite(d);
    return [
      `Von deinem Gegenüber hast du bisher ${treats} Leckerlis bekommen und wurdest ${pets}-mal gestreichelt.`,
      fav ? `Dein Lieblingsmensch (wer dich am meisten verwöhnt): ${fav}.` : '',
      'Leckerlis gibt es mit /leckerli, Streicheln mit /streicheln oder durch Klicken auf dich im Call.',
    ].join(' ');
  },
  commands: [
    {
      data: new SlashCommandBuilder().setName('leckerli').setDescription('Gib Klotzi ein Leckerli'),
      async execute(interaction, ctx) {
        const n = count('treats', interaction.user.id, interaction.user.displayName);
        ctx.stage.animate(interaction.guildId, 'eat');
        await interaction.reply(`${pick(TREAT_LINES)}\n-# Leckerli Nr. ${n} von dir`);
      },
    },
    {
      data: new SlashCommandBuilder().setName('streicheln').setDescription('Streichle Klotzi'),
      async execute(interaction, ctx) {
        count('pets', interaction.user.id, interaction.user.displayName);
        ctx.stage.animate(interaction.guildId, 'love');
        await interaction.reply(pick(PET_LINES));
      },
    },
  ],
});
