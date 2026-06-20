import type {
  DocFile,
  Frontmatter,
  ProjectRow,
  SearchHit,
  TaskRow,
  TreeNode,
} from '@forma/core';
import type { AgentRun, AgentSummary, RunDetail } from './lib/agents';
import type { AgentModel, PermissionProfile, PersistedRecord, SessionSummary } from './lib/chat';
import type { McpConfig, McpServerConfig, SkillInfo } from './lib/settings';

/**
 * API origin. Empty in the browser dev build (relative `/api/...` go through
 * Vite's proxy). The Tauri desktop build serves the frontend from a custom
 * protocol, so it sets VITE_API_BASE to the sidecar server's absolute origin.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

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
  const res = await fetch(API_BASE + url, {
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

  vault: {
    get: () => request<{ path: string }>('/api/vault'),
    switch: (path: string) =>
      request<{ path: string }>('/api/vault/switch', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
  },

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

  backlinks: (path: string) =>
    request<Array<{ path: string; title: string }>>(
      `/api/backlinks?path=${encodeURIComponent(path)}`,
    ),

  docs: () => request<Array<{ path: string; title: string; insert: string }>>('/api/docs'),

  agent: {
    listModels: () => request<{ models: AgentModel[]; default: string }>('/api/agent/models'),

    listSessions: () => request<SessionSummary[]>('/api/agent/sessions'),

    createSession: (opts: {
      permission?: PermissionProfile;
      model?: string;
      effort?: string;
      contextDocPath?: string | null;
      contextSelection?: string;
    }) =>
      request<SessionSummary>('/api/agent/sessions', {
        method: 'POST',
        body: JSON.stringify(opts),
      }),

    updateSession: (id: string, patch: { model?: string; permission?: PermissionProfile; effort?: string }) =>
      request<SessionSummary>(`/api/agent/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
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

    sendMessage: (id: string, text: string, context?: string) =>
      request<{ ok: boolean }>(`/api/agent/sessions/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text, context }),
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

  // Custom (background) agents: definitions and runs.
  agentDefs: {
    list: () => request<AgentSummary[]>('/api/agents'),

    run: (name: string) =>
      request<AgentRun>(`/api/agents/${encodeURIComponent(name)}/run`, { method: 'POST' }),

    runs: (name: string) => request<AgentRun[]>(`/api/agents/${encodeURIComponent(name)}/runs`),

    getRun: (name: string, runId: string) =>
      request<RunDetail>(
        `/api/agents/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}`,
      ),

    setEnabled: (name: string, enabled: boolean) =>
      request<AgentSummary>(`/api/agents/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
  },

  // Workspace settings: MCP servers and skills.
  settings: {
    mcp: () => request<McpConfig>('/api/settings/mcp'),

    putServer: (name: string, config: McpServerConfig) =>
      request<McpConfig>(`/api/settings/mcp/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(config),
      }),

    deleteServer: (name: string) =>
      request<McpConfig>(`/api/settings/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' }),

    skills: () => request<SkillInfo[]>('/api/settings/skills'),
  },
};
