import { describe, expect, it } from 'vitest';
import { objectToYaml, parseDoc, serializeDoc, yamlToObject } from './frontmatter.js';

describe('parseDoc', () => {
  it('splits frontmatter and body, dropping the leading blank line', () => {
    const { frontmatter, body } = parseDoc('---\ntitle: Hello\n---\n\n# Heading\n\ntext\n');
    expect(frontmatter).toEqual({ title: 'Hello' });
    expect(body).toBe('# Heading\n\ntext\n');
  });

  it('returns empty frontmatter when none present', () => {
    const { frontmatter, body } = parseDoc('just body\n');
    expect(frontmatter).toEqual({});
    expect(body).toBe('just body\n');
  });

  it('normalizes unquoted YAML dates to YYYY-MM-DD strings', () => {
    const { frontmatter } = parseDoc('---\ndue: 2026-06-20\n---\n');
    expect(frontmatter.due).toBe('2026-06-20');
    expect(typeof frontmatter.due).toBe('string');
  });

  it('normalizes dates nested in arrays and objects', () => {
    const { frontmatter } = parseDoc(
      '---\ndates:\n  - 2026-01-02\nmeta:\n  start: 2026-03-04\n---\n',
    );
    expect(frontmatter.dates).toEqual(['2026-01-02']);
    expect(frontmatter.meta).toEqual({ start: '2026-03-04' });
  });
});

describe('serializeDoc', () => {
  it('round-trips frontmatter and body', () => {
    const src = '---\ntitle: Hello\nstatus: todo\n---\n\nbody text\n';
    const { frontmatter, body } = parseDoc(src);
    const out = serializeDoc(frontmatter, body);
    expect(parseDoc(out)).toEqual({ frontmatter, body });
  });

  it('omits the frontmatter fence when there are no properties', () => {
    expect(serializeDoc({}, 'plain body\n')).toBe('plain body\n');
  });

  it('ensures a trailing newline on the body', () => {
    expect(serializeDoc({}, 'no newline')).toBe('no newline\n');
    expect(serializeDoc({}, '')).toBe('');
  });

  it('keeps dates as strings across a serialize→parse round-trip (no Date drift)', () => {
    const out = serializeDoc({ due: '2026-06-20' }, 'x\n');
    const { frontmatter } = parseDoc(out);
    expect(frontmatter.due).toBe('2026-06-20');
    expect(typeof frontmatter.due).toBe('string');
  });
});

describe('yaml helpers', () => {
  it('yamlToObject parses a bare property block', () => {
    expect(yamlToObject('title: Hi\nstatus: done')).toEqual({ title: 'Hi', status: 'done' });
  });

  it('yamlToObject returns {} for empty input', () => {
    expect(yamlToObject('   ')).toEqual({});
  });

  it('objectToYaml returns "" for an empty object', () => {
    expect(objectToYaml({})).toBe('');
  });

  it('objectToYaml / yamlToObject round-trip', () => {
    const obj = { title: 'Hi', tags: ['a', 'b'], due: '2026-06-20' };
    expect(yamlToObject(objectToYaml(obj))).toEqual(obj);
  });
});
