import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import type { McpServerConfig } from '../lib/settings';

type Transport = 'stdio' | 'http';

interface FormState {
  name: string;
  transport: Transport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
};

function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function stringifyKV(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function buildConfig(f: FormState): McpServerConfig {
  if (f.transport === 'http') {
    const cfg: McpServerConfig = { type: 'http', url: f.url.trim() };
    const headers = parseKV(f.headers);
    if (Object.keys(headers).length) cfg.headers = headers;
    return cfg;
  }
  const cfg: McpServerConfig = { command: f.command.trim() };
  const args = f.args.split(/\s+/).filter(Boolean);
  if (args.length) cfg.args = args;
  const env = parseKV(f.env);
  if (Object.keys(env).length) cfg.env = env;
  return cfg;
}

function toForm(name: string, cfg: McpServerConfig): FormState {
  const isHttp = cfg.type === 'http' || cfg.type === 'sse' || (!!cfg.url && !cfg.command);
  return {
    name,
    transport: isHttp ? 'http' : 'stdio',
    command: cfg.command ?? '',
    args: (cfg.args ?? []).join(' '),
    env: stringifyKV(cfg.env ?? {}),
    url: cfg.url ?? '',
    headers: stringifyKV(cfg.headers ?? {}),
  };
}

function serverSummary(cfg: McpServerConfig): string {
  if (cfg.url) return cfg.url;
  if (cfg.command) return [cfg.command, ...(cfg.args ?? [])].join(' ');
  return '—';
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none';

function ServerForm({
  initial,
  isNew,
  onClose,
}: {
  initial: FormState;
  isNew: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: () => api.settings.putServer(form.name.trim(), buildConfig(form)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcp'] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save'),
  });

  const submit = () => {
    setError(null);
    if (!/^[A-Za-z0-9][\w.-]*$/.test(form.name.trim())) {
      setError('Name must be alphanumeric (a-z, 0-9, ., _, -).');
      return;
    }
    if (form.transport === 'stdio' && !form.command.trim()) {
      setError('Command is required for a stdio server.');
      return;
    }
    if (form.transport === 'http' && !form.url.trim()) {
      setError('URL is required for an HTTP server.');
      return;
    }
    save.mutate();
  };

  return (
    <div className="rounded-xl border border-stone-300 bg-stone-50 p-4">
      <div className="grid gap-3">
        <div className="flex gap-3">
          <input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            disabled={!isNew}
            placeholder="server-name"
            className={`${inputClass} flex-1 disabled:bg-stone-100 disabled:text-stone-500`}
          />
          <select
            value={form.transport}
            onChange={(e) => set({ transport: e.target.value as Transport })}
            className={inputClass.replace('w-full', 'w-32')}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </div>

        {form.transport === 'stdio' ? (
          <>
            <input
              value={form.command}
              onChange={(e) => set({ command: e.target.value })}
              placeholder="command (e.g. npx)"
              className={inputClass}
            />
            <input
              value={form.args}
              onChange={(e) => set({ args: e.target.value })}
              placeholder="args (space-separated, e.g. -y @scope/mcp-server)"
              className={inputClass}
            />
            <textarea
              value={form.env}
              onChange={(e) => set({ env: e.target.value })}
              placeholder={'env, one per line — use refs, not secrets:\nAPI_TOKEN=${MY_TOKEN}'}
              rows={2}
              className={`${inputClass} resize-y font-mono text-xs`}
            />
          </>
        ) : (
          <>
            <input
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://host/mcp"
              className={inputClass}
            />
            <textarea
              value={form.headers}
              onChange={(e) => set({ headers: e.target.value })}
              placeholder={'headers, one per line:\nAuthorization=Bearer ${MY_TOKEN}'}
              rows={2}
              className={`${inputClass} resize-y font-mono text-xs`}
            />
          </>
        )}

        {error && <div className="text-xs text-rose-600">{error}</div>}

        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={save.isPending}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700 disabled:bg-stone-300"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const mcp = useQuery({ queryKey: ['mcp'], queryFn: api.settings.mcp });
  const skills = useQuery({ queryKey: ['skills'], queryFn: api.settings.skills });
  // null = closed; '' = adding; otherwise the server name being edited.
  const [editing, setEditing] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (name: string) => api.settings.deleteServer(name),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['mcp'] }),
  });

  const servers = Object.entries(mcp.data?.mcpServers ?? {});

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mb-6 text-sm text-stone-400">
        Connect tools via MCP servers and review installed skills. Keep secrets in environment
        variables and reference them as <span className="font-mono">{'${VAR}'}</span>.
      </p>

      <section className="mb-10">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">MCP servers</h2>
          {editing === null && (
            <button
              onClick={() => setEditing('')}
              className="rounded-lg bg-stone-900 px-3 py-1 text-xs text-white hover:bg-stone-700"
            >
              + Add server
            </button>
          )}
        </div>

        {editing === '' && (
          <div className="mb-3">
            <ServerForm initial={EMPTY_FORM} isNew onClose={() => setEditing(null)} />
          </div>
        )}

        {mcp.isError && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {(mcp.error as Error).message}
          </div>
        )}

        {servers.length === 0 && editing !== '' && (
          <div className="rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-400">
            No MCP servers configured.
          </div>
        )}

        <div className="flex flex-col gap-2">
          {servers.map(([name, cfg]) =>
            editing === name ? (
              <ServerForm key={name} initial={toForm(name, cfg)} isNew={false} onClose={() => setEditing(null)} />
            ) : (
              <div
                key={name}
                className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{name}</div>
                  <div className="truncate font-mono text-xs text-stone-500">{serverSummary(cfg)}</div>
                </div>
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
                  {cfg.url ? cfg.type ?? 'http' : 'stdio'}
                </span>
                <button
                  onClick={() => setEditing(name)}
                  className="rounded-lg px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-100"
                >
                  Edit
                </button>
                <button
                  onClick={() => window.confirm(`Remove MCP server "${name}"?`) && remove.mutate(name)}
                  className="rounded-lg px-2.5 py-1 text-xs text-stone-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  Delete
                </button>
              </div>
            ),
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Skills</h2>
        {skills.data?.length === 0 && (
          <div className="rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-400">
            No skills in <span className="font-mono">.claude/skills</span>.
          </div>
        )}
        <div className="flex flex-col gap-2">
          {skills.data?.map((s) => (
            <div
              key={s.path}
              className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                {s.description && <div className="truncate text-xs text-stone-500">{s.description}</div>}
              </div>
              <Link
                to="/docs"
                search={{ path: s.path }}
                className="rounded-lg px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-100"
              >
                Edit
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
