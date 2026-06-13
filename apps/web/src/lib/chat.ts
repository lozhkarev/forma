/**
 * Client-side mirror of the agent event/record shapes sent by the server.
 * Source of truth: packages/agent (AgentEvent) and apps/server/src/runtime.ts
 * (ChatRecord, PersistedRecord, SessionSummary). Mirrored here so the browser
 * bundle never imports the agent SDK.
 */

export type PermissionProfile = 'read-only' | 'vault-write' | 'full';

export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; isError: boolean; content: string }
  | { type: 'permission_request'; requestId: string; tool: string; input: unknown }
  | {
      type: 'result';
      sessionId: string | null;
      ok: boolean;
      costUsd: number | null;
      turns: number;
      durationMs: number;
      stopReason: string | null;
    }
  | { type: 'error'; message: string };

export type ChatRecord = { type: 'user'; text: string } | AgentEvent;

export interface PersistedRecord {
  t: string;
  record: ChatRecord;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  permission: PermissionProfile;
  model: string;
  providerSessionId: string | null;
  createdAt: string;
  lastActive: string;
  costUsd: number;
  turns: number;
  contextDocPath: string | null;
}

export interface AgentModel {
  id: string;
  label: string;
  description?: string;
}

/** A renderable chat item, assembled from the flat record stream. */
export type ChatItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string }
  | { kind: 'tool'; key: string; name: string; input: unknown; done: boolean; isError: boolean }
  | { kind: 'permission'; key: string; requestId: string; tool: string; input: unknown }
  | { kind: 'result'; key: string; ok: boolean; costUsd: number | null; turns: number }
  | { kind: 'error'; key: string; text: string };

/** Fold the flat record stream into renderable items (text deltas merged). */
export function foldRecords(records: PersistedRecord[]): ChatItem[] {
  const items: ChatItem[] = [];
  records.forEach(({ record }, i) => {
    switch (record.type) {
      case 'user':
        items.push({ kind: 'user', key: `u${i}`, text: record.text });
        break;
      case 'text_delta': {
        const prev = items[items.length - 1];
        if (prev && prev.kind === 'assistant') prev.text += record.text;
        else items.push({ kind: 'assistant', key: `a${i}`, text: record.text });
        break;
      }
      case 'tool_use':
        items.push({
          kind: 'tool',
          key: `t${record.id}`,
          name: record.name,
          input: record.input,
          done: false,
          isError: false,
        });
        break;
      case 'tool_result': {
        for (let j = items.length - 1; j >= 0; j--) {
          const it = items[j];
          if (it.kind === 'tool' && it.key === `t${record.id}`) {
            it.done = true;
            it.isError = record.isError;
            break;
          }
        }
        break;
      }
      case 'permission_request':
        items.push({
          kind: 'permission',
          key: `p${record.requestId}`,
          requestId: record.requestId,
          tool: record.tool,
          input: record.input,
        });
        break;
      case 'result':
        items.push({ kind: 'result', key: `r${i}`, ok: record.ok, costUsd: record.costUsd, turns: record.turns });
        break;
      case 'error':
        items.push({ kind: 'error', key: `e${i}`, text: record.message });
        break;
      case 'session':
        break;
    }
  });
  return items;
}

/** One-line human description of a tool call for the collapsed tool row. */
export function describeTool(name: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  const file = typeof obj.file_path === 'string' ? relPath(obj.file_path) : null;
  switch (name) {
    case 'Write':
      return `Writing ${file ?? 'a file'}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${file ?? 'a file'}`;
    case 'Read':
      return `Reading ${file ?? 'a file'}`;
    case 'Glob':
      return `Searching files ${typeof obj.pattern === 'string' ? `(${obj.pattern})` : ''}`.trim();
    case 'Grep':
      return `Searching for ${typeof obj.pattern === 'string' ? `“${obj.pattern}”` : 'text'}`;
    case 'Bash':
      return typeof obj.command === 'string' ? `Running: ${truncate(obj.command, 60)}` : 'Running a command';
    case 'TodoWrite':
      return 'Updating its task list';
    default:
      return name;
  }
}

const PERMISSION_LABELS: Record<PermissionProfile, string> = {
  'read-only': 'Read-only',
  'vault-write': 'Vault write',
  full: 'Full access',
};

export function permissionLabel(p: PermissionProfile): string {
  return PERMISSION_LABELS[p];
}

function relPath(p: string): string {
  // Show the vault-relative tail, not the absolute temp path.
  const parts = p.split('/');
  return parts.slice(-2).join('/');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
