import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { Frontmatter, VaultEvent } from '@forma/core';
import { createAgentRoutes } from './agent-api.js';
import { createAgentDefRoutes } from './agents-api.js';
import type { AgentService } from './agents.js';
import type { IndexService } from './indexer.js';
import type { AgentRuntime } from './runtime.js';
import type { Scheduler } from './scheduler.js';
import { createSettingsRoutes } from './settings-api.js';
import type { SettingsService } from './settings.js';
import { VaultError, type VaultService } from './vault.js';

interface WriteDocBody {
  path: string;
  frontmatter?: Frontmatter;
  body?: string;
  baseMtimeMs?: number;
}

interface PatchTaskBody {
  path: string;
  /** Частичное обновление frontmatter; значение null удаляет ключ. */
  patch: Record<string, unknown>;
}

export function createApi(
  vault: VaultService,
  indexer: IndexService,
  runtime: AgentRuntime,
  agents: AgentService,
  scheduler: Scheduler,
  settings: SettingsService,
): Hono {
  const app = new Hono();

  app.use('/api/*', cors());

  app.route('/api/agent', createAgentRoutes(runtime));
  app.route('/api/agents', createAgentDefRoutes(agents, scheduler));
  app.route('/api/settings', createSettingsRoutes(settings));

  app.onError((err, c) => {
    if (err instanceof VaultError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true, vault: vault.root }));

  app.get('/api/tree', async (c) => c.json(await vault.listTree()));

  app.get('/api/doc', async (c) => {
    const path = c.req.query('path');
    if (!path) throw new VaultError('параметр path обязателен', 400);
    return c.json(await vault.readDoc(path));
  });

  app.post('/api/doc', async (c) => {
    const { path, frontmatter = {}, body = '' } = await c.req.json<WriteDocBody>();
    if (!path) throw new VaultError('параметр path обязателен', 400);
    const doc = await vault.writeDoc(path, frontmatter, body, { mustNotExist: true });
    await indexer.indexFile(path);
    return c.json(doc, 201);
  });

  app.put('/api/doc', async (c) => {
    const { path, frontmatter = {}, body = '', baseMtimeMs } = await c.req.json<WriteDocBody>();
    if (!path) throw new VaultError('параметр path обязателен', 400);
    const doc = await vault.writeDoc(path, frontmatter, body, { baseMtimeMs });
    await indexer.indexFile(path);
    return c.json(doc);
  });

  app.delete('/api/doc', async (c) => {
    const path = c.req.query('path');
    if (!path) throw new VaultError('параметр path обязателен', 400);
    await vault.deleteDoc(path);
    indexer.removeFile(path);
    return c.json({ ok: true });
  });

  app.get('/api/tasks', (c) =>
    c.json(
      indexer.listTasks({
        status: c.req.query('status'),
        project: c.req.query('project'),
      }),
    ),
  );

  app.patch('/api/task', async (c) => {
    const { path, patch } = await c.req.json<PatchTaskBody>();
    if (!path || !patch) throw new VaultError('нужны path и patch', 400);
    const doc = await vault.readDoc(path);
    const frontmatter = { ...doc.frontmatter };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete frontmatter[key];
      else frontmatter[key] = value;
    }
    const updated = await vault.writeDoc(path, frontmatter, doc.body, {
      baseMtimeMs: doc.mtimeMs,
    });
    await indexer.indexFile(path);
    return c.json(updated);
  });

  app.get('/api/projects', (c) => c.json(indexer.listProjects()));

  app.get('/api/search', (c) => {
    const q = c.req.query('q') ?? '';
    return c.json(indexer.search(q));
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let alive = true;
      const handler = (event: VaultEvent) => {
        void stream.writeSSE({ event: 'vault', data: JSON.stringify(event) });
      };
      indexer.on('vault', handler);
      stream.onAbort(() => {
        alive = false;
        indexer.off('vault', handler);
      });
      while (alive) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(25_000);
      }
    }),
  );

  return app;
}
