import type {
  DocKind,
  Frontmatter,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from './types.js';
import { TASK_PRIORITIES, TASK_STATUSES } from './types.js';

const KIND_VALUES: DocKind[] = [
  'wiki',
  'raw',
  'task',
  'project',
  'journal',
  'agent',
  'report',
  'chat',
  'note',
];

/**
 * Тип документа: явный `type:` во frontmatter главнее,
 * дальше — конвенции расположения в vault.
 */
export function detectKind(relPath: string, frontmatter: Frontmatter): DocKind {
  const explicit = frontmatter['type'];
  if (typeof explicit === 'string' && KIND_VALUES.includes(explicit as DocKind)) {
    return explicit as DocKind;
  }

  const top = relPath.split('/')[0];
  if (top === 'wiki') return 'wiki';
  if (top === 'raw') return 'raw';
  if (top === 'journal') return 'journal';
  if (top === 'agents') return 'agent';
  if (top === 'reports') return 'report';
  if (top === 'chats') return 'chat';
  if (top === 'inbox') return typeof frontmatter['status'] === 'string' ? 'task' : 'note';
  if (top === 'projects') {
    if (relPath.endsWith('/project.md')) return 'project';
    if (relPath.includes('/tasks/')) return 'task';
    return 'note';
  }
  return 'note';
}

export function resolveTitle(relPath: string, frontmatter: Frontmatter, body: string): string {
  const fmTitle = frontmatter['title'];
  if (typeof fmTitle === 'string' && fmTitle.trim() !== '') return fmTitle.trim();
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const base = relPath.split('/').pop() ?? relPath;
  return base.replace(/\.md$/, '');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Извлечь строку индекса задачи из файла-задачи. */
export function taskFromDoc(relPath: string, frontmatter: Frontmatter, body: string): TaskRow {
  const rawStatus = frontmatter['status'];
  const status: TaskStatus = TASK_STATUSES.includes(rawStatus as TaskStatus)
    ? (rawStatus as TaskStatus)
    : 'inbox';

  const rawPriority = frontmatter['priority'];
  const priority: TaskPriority | null = TASK_PRIORITIES.includes(rawPriority as TaskPriority)
    ? (rawPriority as TaskPriority)
    : null;

  // project: явное поле или каталог projects/<slug>/...
  let project = asString(frontmatter['project']);
  if (!project) {
    const m = relPath.match(/^projects\/([^/]+)\//);
    if (m) project = m[1];
  }

  const rawTags = frontmatter['tags'];
  const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === 'string') : [];

  return {
    path: relPath,
    id: asString(frontmatter['id']),
    title: resolveTitle(relPath, frontmatter, body),
    status,
    project,
    priority,
    due: asString(frontmatter['due']),
    scheduled: asString(frontmatter['scheduled']),
    tags,
    created: asString(frontmatter['created']),
    source: asString(frontmatter['source']),
  };
}
