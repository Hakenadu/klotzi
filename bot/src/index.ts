import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { loadConfig } from './config.ts';
import { Brain } from './core/brain.ts';
import { createLogger } from './core/logger.ts';
import type { KlotziContext } from './core/skill.ts';
import { SkillRegistry } from './core/skill-registry.ts';
import { Stage } from './core/stage.ts';
import { JsonStore } from './core/store.ts';
import { createDiscordClient, KlotziBot } from './discord.ts';
import { startServer } from './server.ts';

const log = createLogger();
const config = loadConfig();
const stores: JsonStore<object>[] = [];
const skills = new SkillRegistry();

const ctx: KlotziContext = {
  client: createDiscordClient(),
  config,
  openai: new OpenAI({ apiKey: config.openai.apiKey, baseURL: config.openai.baseURL }),
  stage: new Stage(),
  log,
  store(namespace, initial) {
    const store = new JsonStore(config.dataDir, namespace, initial);
    stores.push(store);
    return store;
  },
  skills: () => skills.list(),
};

const skillDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills');
const loaded = await skills.loadDirectory(skillDir, config.skills);
log.info(`Skills geladen: ${loaded.map((s) => s.name).join(', ') || '(keine)'}`);
await skills.setup(ctx);

new KlotziBot(ctx, skills, new Brain(ctx, skills)).attach();
const server = startServer(ctx);
await ctx.client.login(config.discord.token);

function shutdown() {
  log.info('Klotzi rollt sich ein… 💤');
  for (const store of stores) store.flush();
  server.close();
  void ctx.client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
