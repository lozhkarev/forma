import type {
  DocFile,
  Frontmatter,
  ProjectRow,
  SearchHit,
  TaskRow,
  TreeNode,
} from '@forma/core';
import type { PermissionProfile, PersistedRecord, SessionSummary } from './lib/chat';

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tree: () => request<TreeNode>('/api/tree'),

  doc: (path: string) => request<DocFile>(`/api/doc?path=${encodeURIComponent(path)}`),

  createDoc: (path: string, frontmatter: Frontmatter, body: string) =>
    request<DocFile>('/api/doc', {
      method: 'POST',
      body: JSON.stringify({ path, frontmatter, body }),
    }),

  saveDoc: (path: string, frontmatter: Frontmatter, body: string, baseMtimeMs?: number) =>
    request<DocFile>('/api/doc', {
      method: 'PUT',
      body: JSON.stringify({ path, frontmatter, body, baseMtimeMs }),
    }),

  deleteDoc: (path: string) =>
    request<{ ok: boolean }>(`/api/doc?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),

  tasks: (filter: { status?: string; project?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.project) params.set('project', filter.project);
    return request<TaskRow[]>(`/api/tasks?${params}`);
  },

  patchTask: (path: string, patch: Record<string, unknown>) =>
    request<DocFile>('/api/task', {
      method: 'PATCH',
      body: JSON.stringify({ path, patch }),
    }),

  projects: () => request<ProjectRow[]>('/api/projects'),

  search: (q: string) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),

  agent: {
    listSessions: () => request<SessionSummary[]>('/api/agent/sessions'),

    createSession: (opts: { permission?: PermissionProfile; contextDocPath?: string | null }) =>
      request<SessionSummary>('/api/agent/sessions', {
        method: 'POST',
        body: JSON.stringify(opts),
      }),

    resumeSession: (id: string) =>
      request<SessionSummary>('/api/agent/sessions', {
        method: 'POST',
        body: JSON.stringify({ resume: id }),
      }),

    getSession: (id: string) =>
      request<{ summary: SessionSummary; transcript: PersistedRecord[] }>(
        `/api/agent/sessions/${encodeURIComponent(id)}`,
      ),

    sendMessage: (id: string, text: string) =>
      request<{ ok: boolean }>(`/api/agent/sessions/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),

    resolvePermission: (id: string, requestId: string, decision: 'allow' | 'deny') =>
      request<{ ok: boolean }>(
        `/api/agent/sessions/${encodeURIComponent(id)}/permissions/${encodeURIComponent(requestId)}`,
        { method: 'POST', body: JSON.stringify({ decision }) },
      ),

    interrupt: (id: string) =>
      request<{ ok: boolean }>(`/api/agent/sessions/${encodeURIComponent(id)}/interrupt`, {
        method: 'POST',
      }),
  },
};
