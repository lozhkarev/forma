import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  detectKind,
  parseDoc,
  serializeDoc,
  type DocFile,
  type Frontmatter,
  type TreeNode,
} from '@forma/core';
import { bootstrapVault } from './bootstrap.js';

export class VaultError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const HIDDEN = new Set(['.forma', '.git', 'node_modules', '.DS_Store']);

export class VaultService {
  constructor(readonly root: string) {}

  /** Абсолютный путь с защитой от выхода за пределы vault. */
  resolve(relPath: string): string {
    const normalized = path.normalize(relPath).replace(/^\/+/, '');
    const abs = path.resolve(this.root, normalized);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new VaultError(`путь вне vault: ${relPath}`, 400);
    }
    return abs;
  }

  rel(absPath: string): string {
    return path.relative(this.root, absPath).split(path.sep).join('/');
  }

  async init(): Promise<void> {
    await bootstrapVault(this);
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.stat(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async listTree(): Promise<TreeNode> {
    const walk = async (abs: string): Promise<TreeNode[]> => {
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const nodes: TreeNode[] = [];
      for (const entry of entries) {
        if (HIDDEN.has(entry.name) || entry.name.startsWith('.')) continue;
        const childAbs = path.join(abs, entry.name);
        if (entry.isDirectory()) {
          nodes.push({
            name: entry.name,
            path: this.rel(childAbs),
            type: 'dir',
            children: await walk(childAbs),
          });
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          nodes.push({ name: entry.name, path: this.rel(childAbs), type: 'file' });
        }
      }
      nodes.sort((a, b) =>
        a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'ru'),
      );
      return nodes;
    };
    return { name: path.basename(this.root), path: '', type: 'dir', children: await walk(this.root) };
  }

  async readDoc(relPath: string): Promise<DocFile> {
    const abs = this.resolve(relPath);
    let content: string;
    let stat;
    try {
      [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
    } catch {
      throw new VaultError(`документ не найден: ${relPath}`, 404);
    }
    const { frontmatter, body } = parseDoc(content);
    return {
      path: relPath,
      kind: detectKind(relPath, frontmatter),
      frontmatter,
      body,
      mtimeMs: Math.round(stat.mtimeMs),
    };
  }

  /**
   * Атомарная запись (temp + rename) с оптимистичной блокировкой:
   * если файл изменился после baseMtimeMs (пользователь во внешнем
   * редакторе или агент) — 409, клиент решает, что делать.
   */
  async writeDoc(
    relPath: string,
    frontmatter: Frontmatter,
    body: string,
    opts: { baseMtimeMs?: number; mustNotExist?: boolean } = {},
  ): Promise<DocFile> {
    if (!relPath.endsWith('.md')) throw new VaultError('поддерживаются только .md файлы', 400);
    const abs = this.resolve(relPath);

    let stat = null;
    try {
      stat = await fs.stat(abs);
    } catch {
      /* новый файл */
    }
    if (stat && opts.mustNotExist) throw new VaultError(`уже существует: ${relPath}`, 409);
    if (stat && opts.baseMtimeMs !== undefined && Math.round(stat.mtimeMs) !== opts.baseMtimeMs) {
      throw new VaultError(`файл изменился на диске: ${relPath}`, 409);
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${randomBytes(6).toString('hex')}.tmp`);
    await fs.writeFile(tmp, serializeDoc(frontmatter, body), 'utf8');
    await fs.rename(tmp, abs);
    return this.readDoc(relPath);
  }

  async deleteDoc(relPath: string): Promise<void> {
    const abs = this.resolve(relPath);
    try {
      await fs.unlink(abs);
    } catch {
      throw new VaultError(`документ не найден: ${relPath}`, 404);
    }
  }

  /** Все .md файлы vault (для переиндексации). */
  async listMarkdownFiles(): Promise<string[]> {
    const result: string[] = [];
    const walk = async (abs: string): Promise<void> => {
      const entries = await fs.readdir(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (HIDDEN.has(entry.name) || entry.name.startsWith('.')) continue;
        const childAbs = path.join(abs, entry.name);
        if (entry.isDirectory()) await walk(childAbs);
        else if (entry.isFile() && entry.name.endsWith('.md')) result.push(this.rel(childAbs));
      }
    };
    await walk(this.root);
    return result;
  }
}
