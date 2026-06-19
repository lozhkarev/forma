import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultError, VaultService } from './vault.js';

let root: string;
let vault: VaultService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forma-vault-'));
  vault = new VaultService(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Capture the status of a thrown VaultError. */
async function statusOf(fn: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await fn();
  } catch (err) {
    return err instanceof VaultError ? err.status : -1;
  }
  return undefined; // did not throw
}

describe('resolve (path traversal)', () => {
  it('rejects paths escaping the vault with 400', () => {
    expect(() => vault.resolve('../evil')).toThrow(VaultError);
    expect(() => vault.resolve('a/../../evil.md')).toThrow(VaultError);
    try {
      vault.resolve('../evil');
    } catch (err) {
      expect((err as VaultError).status).toBe(400);
    }
  });

  it('strips a leading slash and keeps the path inside the vault', () => {
    expect(vault.resolve('/notes/a.md')).toBe(path.join(root, 'notes/a.md'));
  });

  it('resolves a normal relative path', () => {
    expect(vault.resolve('notes/a.md')).toBe(path.join(root, 'notes/a.md'));
  });
});

describe('writeDoc / readDoc round-trip', () => {
  it('writes a doc (creating nested dirs) and reads it back', async () => {
    const written = await vault.writeDoc('projects/foo/tasks/t.md', { status: 'todo' }, '# Task\n');
    expect(written.path).toBe('projects/foo/tasks/t.md');
    expect(written.kind).toBe('task');
    expect(written.frontmatter).toEqual({ status: 'todo' });
    expect(written.body).toBe('# Task\n');

    const read = await vault.readDoc('projects/foo/tasks/t.md');
    expect(read.frontmatter).toEqual({ status: 'todo' });
    expect(read.body).toBe('# Task\n');
    expect(read.mtimeMs).toBe(written.mtimeMs);
  });

  it('rejects non-.md paths with 400', async () => {
    expect(await statusOf(() => vault.writeDoc('notes/a.txt', {}, 'x'))).toBe(400);
  });

  it('readDoc throws 404 for a missing file', async () => {
    expect(await statusOf(() => vault.readDoc('missing.md'))).toBe(404);
  });
});

describe('optimistic locking', () => {
  it('writes when baseMtimeMs matches the current file', async () => {
    const a = await vault.writeDoc('a.md', {}, 'one\n');
    const b = await vault.writeDoc('a.md', {}, 'two\n', { baseMtimeMs: a.mtimeMs });
    expect(b.body).toBe('two\n');
  });

  it('rejects a stale baseMtimeMs with 409', async () => {
    await vault.writeDoc('a.md', {}, 'one\n');
    expect(await statusOf(() => vault.writeDoc('a.md', {}, 'two\n', { baseMtimeMs: 1 }))).toBe(409);
  });

  it('does not check mtime for a brand-new file', async () => {
    const created = await vault.writeDoc('new.md', {}, 'hi\n', { baseMtimeMs: 12345 });
    expect(created.body).toBe('hi\n');
  });
});

describe('mustNotExist', () => {
  it('allows creating a new file', async () => {
    const created = await vault.writeDoc('once.md', {}, 'x\n', { mustNotExist: true });
    expect(created.path).toBe('once.md');
  });

  it('rejects overwriting an existing file with 409', async () => {
    await vault.writeDoc('once.md', {}, 'x\n');
    expect(await statusOf(() => vault.writeDoc('once.md', {}, 'y\n', { mustNotExist: true }))).toBe(
      409,
    );
  });
});

describe('deleteDoc', () => {
  it('deletes an existing file', async () => {
    await vault.writeDoc('gone.md', {}, 'x\n');
    await vault.deleteDoc('gone.md');
    expect(await vault.exists('gone.md')).toBe(false);
  });

  it('throws 404 deleting a missing file', async () => {
    expect(await statusOf(() => vault.deleteDoc('nope.md'))).toBe(404);
  });
});

describe('listing', () => {
  beforeEach(async () => {
    await vault.writeDoc('wiki/b.md', {}, 'b\n');
    await vault.writeDoc('wiki/a.md', {}, 'a\n');
    await vault.writeDoc('notes/n.md', {}, 'n\n');
    await fs.writeFile(path.join(root, 'wiki/skip.txt'), 'not markdown');
    await fs.mkdir(path.join(root, '.forma'), { recursive: true });
    await fs.writeFile(path.join(root, '.forma/index.db'), 'db');
  });

  it('listMarkdownFiles returns only .md files, ignoring hidden dirs and non-md', async () => {
    const files = (await vault.listMarkdownFiles()).sort();
    expect(files).toEqual(['notes/n.md', 'wiki/a.md', 'wiki/b.md']);
  });

  it('listTree nests dirs, sorts entries and excludes hidden/non-md', async () => {
    const tree = await vault.listTree();
    expect(tree.type).toBe('dir');
    const top = (tree.children ?? []).map((c) => c.name);
    expect(top).toEqual(['notes', 'wiki']); // dirs sorted, .forma hidden
    const wiki = tree.children?.find((c) => c.name === 'wiki');
    expect((wiki?.children ?? []).map((c) => c.name)).toEqual(['a.md', 'b.md']);
  });
});
