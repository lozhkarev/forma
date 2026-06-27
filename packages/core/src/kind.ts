import type {
  DocKind,
  Frontmatter,
  TaskPriority,
  TaskRow,
  TaskStatus,
  Zone,
} from './types.js';
import { TASK_PRIORITIES, TASK_STATUSES } from './types.js';

const KIND_VALUES: DocKind[] = [
  'wiki',
  'raw',
  'task',
  'project',
  'area',
  'memory',
  'journal',
  'agent',
  'report',
  'chat',
  'note',
];

const taskOrNote = (frontmatter: Frontmatter): DocKind =>
  typeof frontmatter['status'] === 'string' ? 'task' : 'note';

/** Kind for a path under `work/projects|areas|archive` (also reused for archive). */
function workItemKind(relPath: string, frontmatter: Frontmatter): DocKind {
  if (relPath.endsWith('/project.md')) return 'project';
  if (relPath.endsWith('/area.md')) return 'area';
  if (relPath.includes('/tasks/')) return 'task';
  return taskOrNote(frontmatter);
}

/**
 * Тип документа: явный `type:` во frontmatter главнее, дальше — конвенции
 * расположения в vault (зональная раскладка, см. DATA-MODEL.md). Поддерживается
 * и старая плоская раскладка (`wiki/ raw/ projects/ inbox/`) до завершения
 * миграции.
 */
export function detectKind(relPath: string, frontmatter: Frontmatter): DocKind {
  const explicit = frontmatter['type'];
  if (typeof explicit === 'string' && KIND_VALUES.includes(explicit as DocKind)) {
    return explicit as DocKind;
  }

  const [top, sub] = relPath.split('/');

  if (top === 'knowledge') {
    if (sub === 'wiki') return 'wiki';
    if (sub === 'inbox' || sub === 'raw') return 'raw';
    return 'note';
  }
  if (top === 'work') {
    if (sub === 'projects' || sub === 'areas' || sub === 'archive') {
      return workItemKind(relPath, frontmatter);
    }
    if (sub === 'inbox') return taskOrNote(frontmatter);
    return 'note';
  }
  if (top === 'memory') return 'memory';
  if (top === 'journal') return 'journal';
  if (top === 'agents') return 'agent';
  if (top === 'reports') return 'report';
  if (top === 'chats') return 'chat';

  // --- legacy flat layout (kept until the vault migration runs) ---
  if (top === 'wiki') return 'wiki';
  if (top === 'raw') return 'raw';
  if (top === 'inbox') return taskOrNote(frontmatter);
  if (top === 'projects') {
    if (relPath.endsWith('/project.md')) return 'project';
    if (relPath.includes('/tasks/')) return 'task';
    return 'note';
  }
  return 'note';
}

/** Retrieval/ownership zone, from the top-level folder (legacy folders mapped too). */
export function detectZone(relPath: string): Zone {
  const top = relPath.split('/')[0];
  if (top === 'knowledge' || top === 'wiki' || top === 'raw') return 'knowledge';
  if (top === 'work' || top === 'projects' || top === 'inbox') return 'work';
  if (top === 'memory') return 'memory';
  return 'ops';
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

  // project: явное поле или каталог [work/]projects/<slug>/... (или archive)
  let project = asString(frontmatter['project']);
  if (!project) {
    const m = relPath.match(/^(?:work\/)?(?:archive\/)?projects\/([^/]+)\//);
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
