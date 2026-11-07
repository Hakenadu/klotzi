import { defineSkill, defineTool } from '../core/skill.ts';

/** Gibt Klotzi Zugriff auf die genaue Uhrzeit in beliebigen Zeitzonen. */
export default defineSkill({
  name: 'clock',
  description: 'Kennt Datum und Uhrzeit überall auf der Welt (und im Warp).',
  tools: [
    defineTool<{ timezone?: string }>({
      name: 'get_time',
      description: 'Aktuelles Datum und Uhrzeit in einer Zeitzone (IANA, z. B. "America/New_York").',
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string', description: 'IANA-Zeitzone, Standard Europe/Berlin' } },
      },
      execute({ timezone = 'Europe/Berlin' }) {
        const formatted = new Date().toLocaleString('de-DE', {
          timeZone: timezone,
          dateStyle: 'full',
          timeStyle: 'long',
        });
        return { timezone, now: formatted };
      },
    }),
  ],
});
