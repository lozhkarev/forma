import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  detectKind,
  parseDoc,
  resolveTitle,
  taskFromDoc,
  TASK_STATUSES,
  type ProjectRow,
  type SearchHit,
  type TaskRow,
  type TaskStatus,
  type VaultEvent,
} from '@forma/core';
import type { VaultService } from './vault.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
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
`;

export class IndexService extends EventEmitter {
  private db: DatabaseSync;
  private watcher: FSWatcher | null = null;

  constructor(private vault: VaultService) {
    super();
    const dbPath = path.join(vault.root, '.forma', 'index.db');
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  async reindexAll(): Promise<number> {
    for (const table of ['documents', 'tasks', 'projects', 'docs_fts']) {
      this.db.exec(`DELETE FROM ${table};`);
    }
    const files = await this.vault.listMarkdownFiles();
    for (const rel of files) {
      await this.indexFile(rel, { silent: true });
    }
    return files.length;
  }

  async indexFile(relPath: string, opts: { silent?: boolean } = {}): Promise<void> {
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
    const title = resolveTitle(relPath, frontmatter, body);

    this.deleteRows(relPath);
    this.db
      .prepare('INSERT INTO documents (path, kind, title, frontmatter, mtime) VALUES (?, ?, ?, ?, ?)')
      .run(relPath, kind, title, JSON.stringify(frontmatter), mtimeMs);
    this.db.prepare('INSERT INTO docs_fts (path, title, body) VALUES (?, ?, ?)').run(relPath, title, body);

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

    if (!opts.silent) this.broadcast({ type: 'changed', path: relPath });
  }

  removeFile(relPath: string, opts: { silent?: boolean } = {}): void {
    this.deleteRows(relPath);
    if (!opts.silent) this.broadcast({ type: 'deleted', path: relPath });
  }

  private deleteRows(relPath: string): void {
    for (const table of ['documents', 'tasks', 'projects', 'docs_fts']) {
      this.db.prepare(`DELETE FROM ${table} WHERE path = ?`).run(relPath);
    }
  }

  private broadcast(event: VaultEvent): void {
    this.emit('vault', event);
  }

  /** Следить за vault: правки агента и внешних редакторов попадают в индекс. */
  startWatcher(): void {
    const ignored = (p: string) => {
      const rel = path.relative(this.vault.root, p);
      return rel.split(path.sep).some((seg) => seg === '.forma' || seg === '.git' || seg === 'node_modules');
    };
    this.watcher = chokidar.watch(this.vault.root, { ignored, ignoreInitial: true });
    const onUpsert = (abs: string) => {
      const rel = this.vault.rel(abs);
      if (rel.endsWith('.md')) void this.indexFile(rel);
    };
    this.watcher.on('add', onUpsert);
    this.watcher.on('change', onUpsert);
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

  search(query: string): SearchHit[] {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
    const rows = this.db
      .prepare(
        `SELECT path, title, snippet(docs_fts, 2, '<mark>', '</mark>', '…', 16) AS snippet
         FROM docs_fts WHERE docs_fts MATCH ? ORDER BY rank LIMIT 20`,
      )
      .all(match) as Array<Record<string, unknown>>;
    return rows as unknown as SearchHit[];
  }
}
