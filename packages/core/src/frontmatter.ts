import matter from 'gray-matter';
import type { Frontmatter } from './types.js';

/**
 * js-yaml парсит неэкранированные даты (`due: 2026-06-20`) в Date.
 * Приложение всюду работает со строками `YYYY-MM-DD`, поэтому нормализуем
 * значения сразу после парсинга — иначе даты «поплывут» при сериализации.
 */
function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeValue(v)]),
    );
  }
  return value;
}

export function parseDoc(content: string): { frontmatter: Frontmatter; body: string } {
  const parsed = matter(content);
  return {
    frontmatter: normalizeValue(parsed.data) as Frontmatter,
    body: parsed.content.replace(/^\n/, ''),
  };
}

export function serializeDoc(frontmatter: Frontmatter, body: string): string {
  const fm = normalizeValue(frontmatter) as Frontmatter;
  const text = body.endsWith('\n') || body === '' ? body : body + '\n';
  if (Object.keys(fm).length === 0) return text;
  return matter.stringify(text, fm);
}

/** YAML-хелперы для редактирования свойств документа в UI. */
export function yamlToObject(yaml: string): Frontmatter {
  const trimmed = yaml.trim();
  if (trimmed === '') return {};
  const parsed = matter(`---\n${trimmed}\n---\n`);
  return normalizeValue(parsed.data) as Frontmatter;
}

export function objectToYaml(obj: Frontmatter): string {
  if (Object.keys(obj).length === 0) return '';
  const text = matter.stringify('', normalizeValue(obj) as Frontmatter);
  return text.replace(/^---\n/, '').replace(/\n---\n?$/, '\n').trimEnd() + '\n';
}
