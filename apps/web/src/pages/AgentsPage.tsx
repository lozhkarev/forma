import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { useState } from 'react';
import { api } from '../api';
import type { AgentRun, AgentSummary, RunStatus } from '../lib/agents';
import { describeTool, foldRecords, permissionLabel } from '../lib/chat';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function triggerLabel(agent: AgentSummary): string {
  const { type, schedule, glob } = agent.trigger;
  if (type === 'cron') return `Cron · ${schedule ?? '?'}`;
  if (type === 'event') return `On ${glob ?? '?'}`;
  return 'Manual';
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
      {children}
    </span>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={checked ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-emerald-500' : 'bg-stone-300',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  );
}

const STATUS_DOT: Record<RunStatus, string> = {
  running: 'animate-pulse bg-amber-400',
  success: 'bg-emerald-400',
  error: 'bg-rose-400',
};

function StatusDot({ status }: { status: RunStatus }) {
  return <span className={clsx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />;
}

function RunTranscript({ name, runId }: { name: string; runId: string }) {
  const detail = useQuery({
    queryKey: ['agent-run', name, runId],
    queryFn: () => api.agentDefs.getRun(name, runId),
  });
  if (!detail.data) {
    return <div className="px-4 pb-3 text-xs text-stone-400">Loading transcript…</div>;
  }
  const items = foldRecords(detail.data.events);
  if (items.length === 0) {
    return <div className="px-4 pb-3 text-xs text-stone-400">No transcript recorded.</div>;
  }
  return (
    <div className="space-y-1.5 bg-stone-50 px-4 py-3">
      {items.map((it) => {
        switch (it.kind) {
          case 'assistant':
            return (
              <div key={it.key} className="whitespace-pre-wrap break-words text-xs text-stone-700">
                {it.text}
              </div>
            );
          case 'tool':
            return (
              <div key={it.key} className="flex items-center gap-1.5 text-[11px] text-stone-500">
                <span
                  className={clsx(
                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    it.isError ? 'bg-rose-400' : 'bg-emerald-400',
                  )}
                />
                <span className="truncate">{describeTool(it.name, it.input)}</span>
              </div>
            );
          case 'error':
            return (
              <div key={it.key} className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-600">
                {it.text}
              </div>
            );
          case 'result':
            return (
              <div key={it.key} className="text-[10px] text-stone-400">
                — {it.ok ? 'done' : 'stopped'} · {it.turns} turns
                {it.costUsd != null && ` · $${it.costUsd.toFixed(3)}`}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function RunRow({ name, run }: { name: string; run: AgentRun }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-stone-50 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs hover:bg-stone-50"
      >
        <StatusDot status={run.status} />
        <span className="text-stone-500">{formatDateTime(run.startedAt)}</span>
        <Badge>{run.trigger}</Badge>
        <span className="ml-auto text-stone-400">
          {run.turns} turns · ${run.costUsd.toFixed(3)}
        </span>
      </button>
      {run.error && <div className="px-4 pb-2 pl-8 text-xs text-rose-600">{run.error}</div>}
      {open && <RunTranscript name={name} runId={run.runId} />}
    </div>
  );
}

function RunsPanel({ name }: { name: string }) {
  const runs = useQuery({
    queryKey: ['agent-runs', name],
    queryFn: () => api.agentDefs.runs(name),
    refetchInterval: 3000,
  });
  if (!runs.data) return <div className="border-t border-stone-100 px-4 py-3 text-xs text-stone-400">Loading…</div>;
  if (runs.data.length === 0) {
    return <div className="border-t border-stone-100 px-4 py-3 text-xs text-stone-400">No runs yet.</div>;
  }
  return (
    <div className="border-t border-stone-100">
      {runs.data.map((r) => (
        <RunRow key={r.runId} name={name} run={r} />
      ))}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentSummary }) {
  const queryClient = useQueryClient();
  const [showRuns, setShowRuns] = useState(false);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['agents'] });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.agentDefs.setEnabled(agent.name, enabled),
    onSettled: invalidate,
  });
  const run = useMutation({
    mutationFn: () => api.agentDefs.run(agent.name),
    onSettled: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['agent-runs', agent.name] });
      setShowRuns(true);
    },
  });

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <Toggle checked={agent.enabled} onChange={(v) => toggle.mutate(v)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{agent.name}</span>
            {agent.running && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                running
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
            <Badge>{triggerLabel(agent)}</Badge>
            <Badge>{permissionLabel(agent.permission)}</Badge>
            {agent.nextRun && <span className="text-stone-400">next: {formatDateTime(agent.nextRun)}</span>}
          </div>
        </div>
        <button
          onClick={() => setShowRuns((v) => !v)}
          className="rounded-lg px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-100"
        >
          Runs
        </button>
        <Link
          to="/docs"
          search={{ path: agent.path }}
          className="rounded-lg px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-100"
        >
          Edit
        </Link>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending || agent.running}
          className="rounded-lg bg-stone-900 px-3 py-1 text-xs text-white hover:bg-stone-700 disabled:bg-stone-300"
        >
          Run now
        </button>
      </div>
      {showRuns && <RunsPanel name={agent.name} />}
    </div>
  );
}

export function AgentsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: api.agentDefs.list,
    refetchInterval: 4000,
  });

  const createAgent = async () => {
    const input = window.prompt('New agent name (kebab-case):')?.trim();
    if (!input) return;
    const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) return;
    const path = `agents/${slug}.md`;
    await api.createDoc(
      path,
      { name: slug, trigger: { type: 'manual' }, permissions: 'vault-write', enabled: false },
      'Опиши, что должен сделать агент. Тело файла — это его промпт.\n',
    );
    void queryClient.invalidateQueries({ queryKey: ['agents'] });
    void navigate({ to: '/docs', search: { path } });
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <button
          onClick={createAgent}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
        >
          + New agent
        </button>
      </div>

      {agents.data?.length === 0 && (
        <div className="py-16 text-center text-sm text-stone-400">
          No agents yet. Create one to automate a routine — a daily summary, inbox triage, a weekly
          report.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {agents.data?.map((a) => (
          <AgentCard key={a.name} agent={a} />
        ))}
      </div>
    </div>
  );
}
