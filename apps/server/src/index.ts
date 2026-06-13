import { serve } from '@hono/node-server';
import { createApi } from './api.js';
import {
  AGENT_MODEL,
  DEFAULT_MAX_COST_USD,
  DEFAULT_MAX_TURNS,
  MAX_CONCURRENT_TURNS,
  PORT,
  VAULT_ROOT,
} from './config.js';
import { IndexService } from './indexer.js';
import { AgentRuntime } from './runtime.js';
import { VaultService } from './vault.js';

async function main(): Promise<void> {
  const vault = new VaultService(VAULT_ROOT);
  await vault.init();
  console.log(`[forma] vault: ${VAULT_ROOT}`);

  const indexer = new IndexService(vault);
  const indexed = await indexer.reindexAll();
  console.log(`[forma] индекс: ${indexed} документов`);
  indexer.startWatcher();

  const runtime = new AgentRuntime(VAULT_ROOT, {
    model: AGENT_MODEL,
    maxConcurrentTurns: MAX_CONCURRENT_TURNS,
    maxTurns: DEFAULT_MAX_TURNS,
    maxCostUsd: DEFAULT_MAX_COST_USD,
  });

  const app = createApi(vault, indexer, runtime);
  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[forma] server: http://localhost:${info.port}`);
  });

  const shutdown = async () => {
    server.close();
    await runtime.stop();
    await indexer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
