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
  | 'area'
  | 'memory'
  | 'journal'
  | 'agent'
  | 'report'
  | 'chat'
  | 'note';

/**
 * Retrieval/ownership domain, derived from the top-level folder (see DATA-MODEL.md):
 * - knowledge: the agent-curated second brain (raw + wiki)
 * - work: the user's projects/areas/tasks
 * - memory: the agent's learned recipes/preferences
 * - ops: runtime artefacts (journal, chats, reports, agents)
 */
export type Zone = 'knowledge' | 'work' | 'memory' | 'ops';

export type Frontmatter = Record<string, unknown>;

/** What a custom (background) agent is allowed to do. Mirrors the agent
 *  package's PermissionProfile; duplicated here so core stays vendor-free. */
export type AgentPermission = 'read-only' | 'vault-write' | 'full';

export type AgentTriggerType = 'cron' | 'event' | 'manual';

/** A user-defined agent, parsed from `agents/<name>.md`. See ARCHITECTURE §6. */
export interface AgentDefinition {
  /** Stable id; from frontmatter `name` or the filename. */
  name: string;
  /** Vault-relative path of the definition file. */
  path: string;
  /** Disabled agents are listed but never auto-triggered. */
  enabled: boolean;
  trigger: {
    type: AgentTriggerType;
    /** Cron expression for `cron` triggers. */
    schedule: string | null;
    /** Path glob for `event` triggers (e.g. `inbox/*`). */
    glob: string | null;
  };
  permission: AgentPermission;
  /** Model id override; runtime default otherwise. */
  model: string | null;
  budget: { maxTurns: number | null; maxCostUsd: number | null };
  /** Hint for where the agent should write output (e.g. `reports/`). */
  output: string | null;
  /** The prompt — the body of the definition file. */
  prompt: string;
}

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
  zone: Zone;
}

export interface VaultEvent {
  type: 'added' | 'changed' | 'deleted';
  path: string;
}
