import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  buildNameIndex,
  detectKind,
  detectZone,
  extractLinks,
  parseDoc,
  resolveLink,
  resolveTitle,
  taskFromDoc,
  TASK_STATUSES,
  type LinkKind,
  type ProjectRow,
  type SearchHit,
  type TaskRow,
  type TaskStatus,
  type VaultEvent,
} from '@forma/core';
import type { VaultService } from './vault.js';

// Bump when the derived schema changes — the index is disposable, so on a
// version mismatch we drop the tables and reindex from the files (source of truth).
const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  zone TEXT NOT NULL,
  title TEXT NOT NULL,
  frontmatter TEXT NOT NULL,
  mtime INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  path TEXT PRIMARY KEY,
  id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  project TEXT,
  priority TEXT,
  due TEXT,
  scheduled TEXT,
  tags TEXT NOT NULL,
  created TEXT,
  source TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  path TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  due TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(path UNINDEXED, title, body);
CREATE TABLE IF NOT EXISTS links (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS links_source ON links(source);
`;

export class IndexService extends EventEmitter {
  private db: DatabaseSync;
  private watcher: FSWatcher | null = null;

  constructor(private vault: VaultService) {
    super();
    const dbPath = path.join(vault.root, '.forma', 'index.db');
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
    this.db.exec(SCHEMA);
  }

  /** Drop derived tables when the schema version moved (index is rebuilt anyway). */
  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (row.user_version >= SCHEMA_VERSION) return;
    for (const table of ['documents', 'tasks', 'projects', 'docs_fts', 'links']) {
      this.db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  async reindexAll(): Promise<number> {
    for (const table of ['documents', 'tasks', 'projects', 'docs_fts', 'links']) {
      this.db.exec(`DELETE FROM ${table};`);
    }
    const files = await this.vault.listMarkdownFiles();
    for (const rel of files) {
      await this.indexFile(rel, { silent: true });
    }
    return files.length;
  }

  async indexFile(
    relPath: string,
    opts: { silent?: boolean; kind?: 'added' | 'changed' } = {},
  ): Promise<void> {
    if (!relPath.endsWith('.md')) return;
    let content: string;
    let mtimeMs: number;
    try {
      const abs = this.vault.resolve(relPath);
      [content, mtimeMs] = await Promise.all([
        fs.readFile(abs, 'utf8'),
        fs.stat(abs).then((s) => Math.round(s.mtimeMs)),
      ]);
    } catch {
      // файл исчез между событием и чтением
      this.removeFile(relPath, opts);
      return;
    }

    const { frontmatter, body } = parseDoc(content);
    const kind = detectKind(relPath, frontmatter);
    const zone = detectZone(relPath);
    const title = resolveTitle(relPath, frontmatter, body);

    this.deleteRows(relPath);
    this.db
      .prepare(
        'INSERT INTO documents (path, kind, zone, title, frontmatter, mtime) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(relPath, kind, zone, title, JSON.stringify(frontmatter), mtimeMs);
    this.db.prepare('INSERT INTO docs_fts (path, title, body) VALUES (?, ?, ?)').run(relPath, title, body);

    const insertLink = this.db.prepare('INSERT INTO links (source, target, kind) VALUES (?, ?, ?)');
    for (const link of extractLinks(body)) {
      insertLink.run(relPath, link.target, link.kind);
    }

    if (kind === 'task') {
      const t = taskFromDoc(relPath, frontmatter, body);
      this.db
        .prepare(
          `INSERT INTO tasks (path, id, title, status, project, priority, due, scheduled, tags, created, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          t.path, t.id, t.title, t.status, t.project, t.priority,
          t.due, t.scheduled, JSON.stringify(t.tags), t.created, t.source,
        );
    } else if (kind === 'project') {
      const slug = relPath.match(/^projects\/([^/]+)\//)?.[1] ?? relPath;
      this.db
        .prepare('INSERT INTO projects (path, slug, title, status, due) VALUES (?, ?, ?, ?, ?)')
        .run(
          relPath, slug, title,
          typeof frontmatter['status'] === 'string' ? (frontmatter['status'] as string) : null,
          typeof frontmatter['due'] === 'string' ? (frontmatter['due'] as string) : null,
        );
    }

    if (!opts.silent) this.broadcast({ type: opts.kind ?? 'changed', path: relPath });
  }

  removeFile(relPath: string, opts: { silent?: boolean } = {}): void {
    this.deleteRows(relPath);
    if (!opts.silent) this.broadcast({ type: 'deleted', path: relPath });
  }

  private deleteRows(relPath: string): void {
    for (const table of ['documents', 'tasks', 'projects', 'docs_fts']) {
      this.db.prepare(`DELETE FROM ${table} WHERE path = ?`).run(relPath);
    }
    this.db.prepare('DELETE FROM links WHERE source = ?').run(relPath);
  }

  private broadcast(event: VaultEvent): void {
    this.emit('vault', event);
  }

  /** Следить за vault: правки агента и внешних редакторов попадают в индекс. */
  startWatcher(): void {
    // Skip the same paths a full reindex skips (vault.listMarkdownFiles): any
    // dot-directory (.forma/.git/.claude/.obsidian…) and node_modules. Otherwise
    // the watcher would index e.g. .claude/*.md that reindexAll never sees,
    // leaving the index inconsistent across restarts.
    const ignored = (p: string) => {
      const rel = path.relative(this.vault.root, p);
      if (rel === '') return false;
      return rel.split(path.sep).some((seg) => seg.startsWith('.') || seg === 'node_modules');
    };
    this.watcher = chokidar.watch(this.vault.root, { ignored, ignoreInitial: true });
    const onUpsert = (abs: string, kind: 'added' | 'changed') => {
      const rel = this.vault.rel(abs);
      if (rel.endsWith('.md')) void this.indexFile(rel, { kind });
    };
    this.watcher.on('add', (abs: string) => onUpsert(abs, 'added'));
    this.watcher.on('change', (abs: string) => onUpsert(abs, 'changed'));
    this.watcher.on('unlink', (abs: string) => {
      const rel = this.vault.rel(abs);
      if (rel.endsWith('.md')) this.removeFile(rel);
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.db.close();
  }

  // --- Запросы для API ---

  listTasks(filter: { status?: string; project?: string } = {}): TaskRow[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status === 'active') {
      where.push(`status IN ('inbox', 'todo', 'in_progress', 'blocked')`);
    } else if (filter.status && TASK_STATUSES.includes(filter.status as TaskStatus)) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.project) {
      where.push('project = ?');
      params.push(filter.project);
    }
    const sql = `
      SELECT * FROM tasks
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY due IS NULL, due ASC, title ASC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags as string) }) as TaskRow);
  }

  listProjects(): ProjectRow[] {
    const projects = this.db.prepare('SELECT * FROM projects ORDER BY title').all() as Array<
      Record<string, unknown>
    >;
    const counts = this.db
      .prepare('SELECT project, status, COUNT(*) AS n FROM tasks WHERE project IS NOT NULL GROUP BY project, status')
      .all() as Array<{ project: string; status: TaskStatus; n: number }>;
    return projects.map((p) => {
      const taskCounts: Partial<Record<TaskStatus, number>> = {};
      for (const c of counts) {
        if (c.project === p.slug) taskCounts[c.status] = Number(c.n);
      }
      return { ...p, taskCounts } as ProjectRow;
    });
  }

  /**
   * All documents for the editor's `[[ ]]` autocomplete. `insert` is the
   * shortest unambiguous wiki target: the basename if it's unique in the
   * vault, otherwise the path without extension.
   */
  listDocs(): Array<{ path: string; title: string; insert: string }> {
    const rows = this.db.prepare('SELECT path, title FROM documents').all() as Array<{
      path: string;
      title: string;
    }>;
    const base = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '');
    const baseCount = new Map<string, number>();
    for (const r of rows) baseCount.set(base(r.path), (baseCount.get(base(r.path)) ?? 0) + 1);
    return rows
      .map((r) => ({
        path: r.path,
        title: r.title,
        insert: baseCount.get(base(r.path)) === 1 ? base(r.path) : r.path.replace(/\.md$/, ''),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Documents whose body links to `target` (resolved wiki + markdown links). */
  backlinks(target: string): Array<{ path: string; title: string }> {
    const links = this.db.prepare('SELECT source, target, kind FROM links').all() as Array<{
      source: string;
      target: string;
      kind: LinkKind;
    }>;
    const docs = this.db.prepare('SELECT path, title FROM documents').all() as Array<{
      path: string;
      title: string;
    }>;
    const paths = new Set(docs.map((d) => d.path));
    const byName = buildNameIndex(paths);
    const titleByPath = new Map(docs.map((d) => [d.path, d.title]));

    const sources = new Set<string>();
    for (const l of links) {
      if (l.source === target) continue;
      if (resolveLink(l.source, l.target, l.kind, paths, byName) === target) sources.add(l.source);
    }
    return [...sources]
      .map((p) => ({ path: p, title: titleByPath.get(p) ?? p }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** The whole link graph: documents as nodes, resolved links as directed edges. */
  linkGraph(): {
    nodes: Array<{ path: string; title: string; kind: string }>;
    edges: Array<{ source: string; target: string }>;
  } {
    const docs = this.db.prepare('SELECT path, title, kind FROM documents').all() as Array<{
      path: string;
      title: string;
      kind: string;
    }>;
    const links = this.db.prepare('SELECT source, target, kind FROM links').all() as Array<{
      source: string;
      target: string;
      kind: LinkKind;
    }>;
    const paths = new Set(docs.map((d) => d.path));
    const byName = buildNameIndex(paths);
    const seen = new Set<string>();
    const edges: Array<{ source: string; target: string }> = [];
    for (const l of links) {
      const target = resolveLink(l.source, l.target, l.kind, paths, byName);
      if (!target || target === l.source) continue;
      const key = `${l.source} ${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: l.source, target });
    }
    return { nodes: docs, edges };
  }

  search(query: string): SearchHit[] {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
    const rows = this.db
      .prepare(
        `SELECT f.path AS path, f.title AS title,
                snippet(docs_fts, 2, '<mark>', '</mark>', '…', 16) AS snippet,
                d.zone AS zone
         FROM docs_fts f JOIN documents d ON d.path = f.path
         WHERE docs_fts MATCH ? ORDER BY rank LIMIT 20`,
      )
      .all(match) as Array<Record<string, unknown>>;
    return rows as unknown as SearchHit[];
  }
}
