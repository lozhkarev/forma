export type LinkKind = 'wiki' | 'md';

export interface DocLink {
  /** Raw target as written: a wiki name (`forma`) or a path (`./x.md`, `/a/b.md`). */
  target: string;
  kind: LinkKind;
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/**
 * Extract links from a markdown body: Obsidian-style `[[wiki]]` (alias after
 * `|` dropped) and inline markdown links `[text](path)`. External URLs,
 * mailto, pure anchors and images are skipped. Deduped per document.
 */
export function extractLinks(body: string): DocLink[] {
  const out: DocLink[] = [];
  const seen = new Set<string>();
  const add = (target: string, kind: LinkKind) => {
    const key = `${kind}|${target}`;
    if (target && !seen.has(key)) {
      seen.add(key);
      out.push({ target, kind });
    }
  };

  for (const m of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    add(m[1].split('|')[0].split('#')[0].trim(), 'wiki');
  }

  for (const m of body.matchAll(/(!?)\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (m[1] === '!') continue; // image
    const url = m[2].trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) continue;
    add(url, 'md');
  }

  return out;
}

/** Index of base-name → path for resolving wiki links (wiki/ wins ties). */
export function buildNameIndex(paths: Iterable<string>): Map<string, string> {
  const byName = new Map<string, string>();
  for (const p of paths) {
    const base = (p.split('/').pop() ?? p).replace(/\.md$/, '');
    if (!byName.has(base) || p.startsWith('wiki/')) byName.set(base, p);
  }
  return byName;
}

/**
 * Resolve a link's raw target to a vault path, or null if it points nowhere
 * (broken links are allowed — they're knowledge not yet written).
 */
export function resolveLink(
  source: string,
  target: string,
  kind: LinkKind,
  paths: Set<string>,
  byName: Map<string, string>,
): string | null {
  let t = target.split('#')[0].trim();
  if (t === '') return null;

  if (kind === 'wiki') {
    t = t.split('|')[0].trim();
    const withMd = t.endsWith('.md') ? t : `${t}.md`;
    if (paths.has(withMd)) return withMd;
    if (paths.has(t)) return t;
    return byName.get(t.replace(/\.md$/, '')) ?? null;
  }

  // markdown path link
  t = t.startsWith('/')
    ? normalizePath(t.slice(1))
    : normalizePath(`${dirname(source) ? `${dirname(source)}/` : ''}${t}`);
  if (paths.has(t)) return t;
  if (!t.endsWith('.md') && paths.has(`${t}.md`)) return `${t}.md`;
  return null;
}
