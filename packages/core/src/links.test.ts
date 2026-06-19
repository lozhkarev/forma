import { describe, expect, it } from 'vitest';
import { buildNameIndex, extractLinks, resolveLink } from './links.js';

describe('extractLinks', () => {
  it('extracts wiki links, dropping alias and anchor', () => {
    expect(extractLinks('see [[forma]] and [[notes/api|the API]] and [[x#sec]]')).toEqual([
      { target: 'forma', kind: 'wiki' },
      { target: 'notes/api', kind: 'wiki' },
      { target: 'x', kind: 'wiki' },
    ]);
  });

  it('extracts relative markdown links', () => {
    expect(extractLinks('[text](./a.md) [b](/c/d.md)')).toEqual([
      { target: './a.md', kind: 'md' },
      { target: '/c/d.md', kind: 'md' },
    ]);
  });

  it('skips images, external urls, mailto, protocol-relative and pure anchors', () => {
    const body = '![img](./p.png) [s](https://x.com) [m](mailto:a@b.c) [p](//cdn/x) [a](#top)';
    expect(extractLinks(body)).toEqual([]);
  });

  it('dedupes repeated targets per document', () => {
    expect(extractLinks('[[a]] [[a]] [x](./a.md) [y](./a.md)')).toEqual([
      { target: 'a', kind: 'wiki' },
      { target: './a.md', kind: 'md' },
    ]);
  });
});

describe('buildNameIndex', () => {
  it('maps base name to path', () => {
    const idx = buildNameIndex(['notes/a.md', 'b.md']);
    expect(idx.get('a')).toBe('notes/a.md');
    expect(idx.get('b')).toBe('b.md');
  });

  it('lets a wiki/ path win ties on the same base name', () => {
    expect(buildNameIndex(['notes/a.md', 'wiki/a.md']).get('a')).toBe('wiki/a.md');
    expect(buildNameIndex(['wiki/a.md', 'notes/a.md']).get('a')).toBe('wiki/a.md');
  });
});

describe('resolveLink', () => {
  const paths = new Set(['wiki/forma.md', 'notes/api.md', 'a/b/c.md', 'a/d.md']);
  const byName = buildNameIndex(paths);

  it('resolves a wiki link by exact path (adding .md)', () => {
    expect(resolveLink('x.md', 'notes/api', 'wiki', paths, byName)).toBe('notes/api.md');
  });

  it('resolves a wiki link by base name', () => {
    expect(resolveLink('x.md', 'forma', 'wiki', paths, byName)).toBe('wiki/forma.md');
  });

  it('resolves a relative markdown link against the source dir', () => {
    expect(resolveLink('a/b/c.md', '../d.md', 'md', paths, byName)).toBe('a/d.md');
  });

  it('resolves an absolute markdown link from the vault root', () => {
    expect(resolveLink('x.md', '/a/b/c.md', 'md', paths, byName)).toBe('a/b/c.md');
  });

  it('appends .md to an extensionless markdown link', () => {
    expect(resolveLink('a/b/c.md', '../d', 'md', paths, byName)).toBe('a/d.md');
  });

  it('returns null for a broken link and an empty target', () => {
    expect(resolveLink('x.md', 'nope', 'wiki', paths, byName)).toBeNull();
    expect(resolveLink('x.md', './missing.md', 'md', paths, byName)).toBeNull();
    expect(resolveLink('x.md', '   ', 'wiki', paths, byName)).toBeNull();
  });
});
