import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useState } from 'react';
import type { TaskRow, TaskStatus } from '@forma/core';
import { TASK_STATUSES } from '@forma/core';
import { api } from '../api';
import { isOverdue, PRIORITY_DOTS, STATUS_COLORS, STATUS_LABELS } from '../lib/labels';

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
    await api.createDoc(`inbox/task-${stamp}.md`, {
      title: trimmed,
      status: 'inbox',
      created: today(),
    }, '');
    setTitle('');
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && void add()}
      placeholder="+ Quick task to inbox (Enter)"
      className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-stone-400 focus:outline-none"
    />
  );
}

function TaskItem({ task }: { task: TaskRow }) {
  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (status: TaskStatus) => api.patchTask(task.path, { status }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const closed = task.status === 'done' || task.status === 'cancelled';

  return (
    <div className="flex items-center gap-3 border-b border-stone-100 bg-white px-4 py-2.5 last:border-0">
      <select
        value={task.status}
        onChange={(e) => patch.mutate(e.target.value as TaskStatus)}
        className={clsx('rounded-md border-0 px-2 py-1 text-xs font-medium', STATUS_COLORS[task.status])}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {task.priority && (
        <span
          className={clsx('h-2 w-2 shrink-0 rounded-full', PRIORITY_DOTS[task.priority])}
          title={`priority: ${task.priority}`}
        />
      )}
      <Link
        to="/docs"
        search={{ path: task.path }}
        className={clsx('min-w-0 flex-1 truncate text-sm hover:underline', closed && 'text-stone-400 line-through')}
      >
        {task.title}
      </Link>
      {task.tags.map((tag) => (
        <span key={tag} className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
          #{tag}
        </span>
      ))}
      {task.project && (
        <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs text-violet-700">{task.project}</span>
      )}
      {task.due && (
        <span
          className={clsx(
            'rounded-md px-2 py-0.5 text-xs',
            isOverdue(task.due) && !closed ? 'bg-rose-100 font-medium text-rose-700' : 'bg-stone-100 text-stone-500',
          )}
        >
          {task.due}
        </span>
      )}
    </div>
  );
}

export function TasksPage() {
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [projectFilter, setProjectFilter] = useState<string>('');

  const tasks = useQuery({
    queryKey: ['tasks', statusFilter, projectFilter],
    queryFn: () =>
      api.tasks({ status: statusFilter || undefined, project: projectFilter || undefined }),
  });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  // группировка по статусу в порядке workflow
  const groups = TASK_STATUSES.map((status) => ({
    status,
    items: (tasks.data ?? []).filter((t) => t.status === status),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <div className="flex items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={clsx(
                'rounded-lg px-3 py-1 text-sm',
                statusFilter === f.key ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100',
              )}
            >
              {f.label}
            </button>
          ))}
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm"
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

      <div className="mb-5">
        <QuickAdd />
      </div>

      {tasks.data?.length === 0 && (
        <div className="py-16 text-center text-sm text-stone-400">No tasks</div>
      )}

      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.status}>
            <h2 className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
              {STATUS_LABELS[group.status]}
              <span className="text-stone-300">{group.items.length}</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-stone-200 shadow-sm">
              {group.items.map((task) => (
                <TaskItem key={task.path} task={task} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
