import fsp from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { buildNameIndex, resolveLink, type Frontmatter, type VaultEvent } from '@forma/core';
import { createAgentRoutes } from './agent-api.js';
import { createAgentDefRoutes } from './agents-api.js';
import type { AgentService } from './agents.js';
import type { GitService } from './git.js';
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

/**
 * Rewrite inbound links so references survive a rename/move. Must run *before*
 * the file is moved (links still resolve to `from`). Rewrites both `[[wiki]]`
 * (to the new base name, or full path on a name collision) and `[md](path)`
 * links in every document that points at `from`. Returns the changed paths.
 */
async function rewriteInboundLinks(
  vault: VaultService,
  indexer: IndexService,
  from: string,
  to: string,
): Promise<string[]> {
  const sources = indexer.backlinks(from).map((s) => s.path);
  if (sources.length === 0) return [];

  const paths = new Set(indexer.listDocs().map((d) => d.path));
  const newBase = nodePath.basename(to).replace(/\.md$/, '');
  const collision = [...paths].some(
    (p) => p !== from && nodePath.basename(p).replace(/\.md$/, '') === newBase,
  );
  const wikiTarget = collision ? to.replace(/\.md$/, '') : newBase;
  const byName = buildNameIndex(paths);
  const changed: string[] = [];

  for (const src of sources) {
    let doc;
    try {
      doc = await vault.readDoc(src);
    } catch {
      continue;
    }
    let dirty = false;
    let body = doc.body;

    // [[wiki]] — preserve #section and |alias, swap only the target.
    body = body.replace(/\[\[([^\]\n]+)\]\]/g, (full, inner: string) => {
      const pipe = inner.indexOf('|');
      const alias = pipe >= 0 ? inner.slice(pipe) : '';
      const beforeAlias = pipe >= 0 ? inner.slice(0, pipe) : inner;
      const hash = beforeAlias.indexOf('#');
      const section = hash >= 0 ? beforeAlias.slice(hash) : '';
      const target = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim();
      if (resolveLink(src, target, 'wiki', paths, byName) === from) {
        dirty = true;
        return `[[${wikiTarget}${section}${alias}]]`;
      }
      return full;
    });

    // [text](path) — rewrite the relative path; skip images and external URLs.
    body = body.replace(
      /(!?)\[([^\]\n]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
      (full, bang: string, text: string, url: string, title = '') => {
        if (bang === '!') return full;
        if (resolveLink(src, url.trim(), 'md', paths, byName) !== from) return full;
        let rel = nodePath.posix.relative(nodePath.posix.dirname(src), to);
        if (!rel.startsWith('.')) rel = `./${rel}`;
        dirty = true;
        return `${bang}[${text}](${rel}${title})`;
      },
    );

    if (dirty) {
      await vault.writeDoc(src, doc.frontmatter, body, { baseMtimeMs: doc.mtimeMs });
      changed.push(src);
    }
  }
  return changed;
}

/** Switches the active vault at runtime (re-inits all services). Lives outside
 *  the rebuildable app so the route survives a switch. */
export interface VaultController {
  current(): string;
  switch(path: string): Promise<void>;
}

export function createApi(
  vault: VaultService,
  indexer: IndexService,
  runtime: AgentRuntime,
  agents: AgentService,
  scheduler: Scheduler,
  settings: SettingsService,
  git: GitService,
  vaultController: VaultController,
): Hono {
  const app = new Hono();

  app.use('/api/*', cors());

  app.route('/api/agent', createAgentRoutes(runtime));
  app.route('/api/agents', createAgentDefRoutes(agents, scheduler));
  app.route('/api/settings', createSettingsRoutes(settings, git));

  app.onError((err, c) => {
    if (err instanceof VaultError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true, vault: vault.root }));

  app.get('/api/vault', (c) => c.json({ path: vaultController.current() }));

  // Filesystem folder browser (host machine) — powers the in-app folder picker
  // used to choose a vault, consistently in the browser and the desktop app.
  app.get('/api/fs/dirs', async (c) => {
    const q = c.req.query('path');
    const base = q && q.trim() ? nodePath.resolve(q) : os.homedir();
    let entries;
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      throw new VaultError(`нельзя прочитать каталог: ${base}`, 400);
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: nodePath.join(base, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = nodePath.dirname(base);
    return c.json({ path: base, parent: parent === base ? null : parent, dirs });
  });

  app.post('/api/fs/mkdir', async (c) => {
    const { path: p, name } = await c.req
      .json<{ path?: string; name?: string }>()
      .catch(() => ({ path: undefined, name: undefined }));
    if (!p || !name || !name.trim()) throw new VaultError('нужны path и name', 400);
    if (/[/\\]/.test(name)) throw new VaultError('имя папки не должно содержать /', 400);
    const abs = nodePath.join(nodePath.resolve(p), name.trim());
    await fsp.mkdir(abs, { recursive: true });
    return c.json({ path: abs });
  });

  // Switch the active vault (works in both the browser and the desktop app).
  // Rebuilds all services for the new root; clients should reload afterwards.
  app.post('/api/vault/switch', async (c) => {
    const { path } = await c.req.json<{ path?: string }>().catch(() => ({ path: undefined }));
    if (!path || !path.trim()) throw new VaultError('параметр path обязателен', 400);
    await vaultController.switch(path.trim());
    return c.json({ path: vaultController.current() });
  });

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

  // Rename or move a document. Rewrites inbound links so references survive.
  app.post('/api/doc/move', async (c) => {
    const { from, to } = await c.req.json<{ from?: string; to?: string }>();
    if (!from || !to) throw new VaultError('нужны from и to', 400);
    const rewritten = await rewriteInboundLinks(vault, indexer, from, to);
    const doc = await vault.moveDoc(from, to);
    indexer.removeFile(from);
    await indexer.indexFile(to);
    for (const p of rewritten) await indexer.indexFile(p);
    return c.json({ doc, rewritten });
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

  app.get('/api/docs', (c) => c.json(indexer.listDocs()));

  app.get('/api/search', (c) => {
    const q = c.req.query('q') ?? '';
    return c.json(indexer.search(q));
  });

  app.get('/api/backlinks', (c) => {
    const path = c.req.query('path');
    if (!path) throw new VaultError('параметр path обязателен', 400);
    return c.json(indexer.backlinks(path));
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
