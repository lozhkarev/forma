import { serve } from '@hono/node-server';
import { createApi } from './api.js';
import { PORT, VAULT_ROOT } from './config.js';
import { IndexService } from './indexer.js';
import { VaultService } from './vault.js';

async function main(): Promise<void> {
  const vault = new VaultService(VAULT_ROOT);
  await vault.init();
  console.log(`[forma] vault: ${VAULT_ROOT}`);

  const indexer = new IndexService(vault);
  const indexed = await indexer.reindexAll();
  console.log(`[forma] индекс: ${indexed} документов`);
  indexer.startWatcher();

  const app = createApi(vault, indexer);
  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[forma] server: http://localhost:${info.port}`);
  });

  const shutdown = async () => {
    server.close();
    await indexer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
