import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { useRef, useState } from 'react';
import { TASK_STATUSES, type TaskRow, type TaskStatus } from '@forma/core';
import { api } from '../api';
import { TaskItem } from '../components/TaskItem';
import { STATUS_LABELS } from '../lib/labels';

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'done', label: 'Done' },
  { key: '', label: 'All' },
] as const;

const today = () => new Date().toISOString().slice(0, 10);

function QuickAdd() {
  const [title, setTitle] = useState('');
  const queryClient = useQueryClient();

  const add = async () => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    await api.createDoc(
      `inbox/task-${stamp}.md`,
      { title: trimmed, status: 'inbox', created: today() },
      '',
    );
    setTitle('');
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && void add()}
      placeholder="+ Quick task to inbox (Enter)"
      className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm shadow-[var(--shadow-soft)] placeholder:text-faintest focus:border-accent-border focus:outline-none"
    />
  );
}

type Row = { type: 'header'; status: TaskStatus; count: number } | { type: 'task'; task: TaskRow };

export function TasksPage() {
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [projectFilter, setProjectFilter] = useState<string>('');

  const tasks = useQuery({
    queryKey: ['tasks', statusFilter, projectFilter],
    queryFn: () =>
      api.tasks({ status: statusFilter || undefined, project: projectFilter || undefined }),
  });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  // Flatten groups into one list so it can be virtualized (handles huge backlogs).
  const rows: Row[] = [];
  for (const status of TASK_STATUSES) {
    const items = (tasks.data ?? []).filter((t) => t.status === status);
    if (items.length === 0) continue;
    rows.push({ type: 'header', status, count: items.length });
    for (const task of items) rows.push({ type: 'task', task });
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].type === 'header' ? 34 : 46),
    overscan: 10,
    getItemKey: (i) => {
      const row = rows[i];
      return row.type === 'task' ? row.task.path : `h:${row.status}`;
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-4xl shrink-0 px-8 pt-7">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Tasks</h1>
          <div className="flex items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={clsx(
                  'rounded-lg px-3 py-1 text-sm',
                  statusFilter === f.key
                    ? 'bg-ink-strong font-medium text-white'
                    : 'text-muted hover:bg-active',
                )}
              >
                {f.label}
              </button>
            ))}
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-muted"
            >
              <option value="">All projects</option>
              {projects.data?.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-3">
          <QuickAdd />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-faintest">No tasks</div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-8 pb-8">
          <div className="relative mx-auto max-w-4xl" style={{ height: virt.getTotalSize() }}>
            {virt.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virt.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {row.type === 'header' ? (
                    <h2 className="flex items-center gap-2 pb-1.5 pt-3 text-[13px] font-semibold uppercase tracking-[.05em] text-faint">
                      {STATUS_LABELS[row.status]}
                      <span className="text-ghost">{row.count}</span>
                    </h2>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-line shadow-[var(--shadow-soft)]">
                      <TaskItem task={row.task} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
