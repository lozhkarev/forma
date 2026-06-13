export const TASK_STATUSES = [
  'inbox',
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTIVE_STATUSES: TaskStatus[] = ['inbox', 'todo', 'in_progress', 'blocked'];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type DocKind =
  | 'wiki'
  | 'raw'
  | 'task'
  | 'project'
  | 'journal'
  | 'agent'
  | 'report'
  | 'chat'
  | 'note';

export type Frontmatter = Record<string, unknown>;

/** Документ vault: распарсенный markdown-файл. */
export interface DocFile {
  path: string;
  kind: DocKind;
  frontmatter: Frontmatter;
  body: string;
  mtimeMs: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

/** Строка индекса задач (производная от файла). */
export interface TaskRow {
  path: string;
  id: string | null;
  title: string;
  status: TaskStatus;
  project: string | null;
  priority: TaskPriority | null;
  due: string | null;
  scheduled: string | null;
  tags: string[];
  created: string | null;
  source: string | null;
}

export interface ProjectRow {
  path: string;
  slug: string;
  title: string;
  status: string | null;
  due: string | null;
  /** Количество задач по статусам. */
  taskCounts: Partial<Record<TaskStatus, number>>;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export interface VaultEvent {
  type: 'changed' | 'deleted';
  path: string;
}
