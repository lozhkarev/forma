import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { useState } from 'react';
import { TASK_STATUSES, type TaskRow, type TaskStatus } from '@forma/core';
import { api } from '../api';
import { isOverdue, PRIORITY_DOTS, STATUS_LABELS } from '../lib/labels';

function BoardCard({ task }: { task: TaskRow }) {
  const closed = task.status === 'done' || task.status === 'cancelled';
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.path);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-[var(--shadow-soft)] active:cursor-grabbing"
    >
      <Link
        to="/docs"
        search={{ path: task.path }}
        draggable={false}
        className={clsx(
          'block text-[13.5px] leading-snug hover:underline',
          closed ? 'text-done line-through' : 'text-body',
        )}
      >
        {task.title}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {task.priority && (
          <span
            className={clsx('h-2 w-2 rounded-full', PRIORITY_DOTS[task.priority])}
            title={`priority: ${task.priority}`}
          />
        )}
        {task.tags.map((tag) => (
          <span key={tag} className="rounded bg-chip px-1.5 py-0.5 text-[10px] text-faint">
            #{tag}
          </span>
        ))}
        {task.due && (
          <span
            className={clsx(
              'rounded-full px-1.5 py-0.5 text-[10px]',
              isOverdue(task.due) && !closed
                ? 'bg-rose-100 font-medium text-rose-700'
                : 'bg-chip text-faint',
            )}
          >
            {task.due}
          </span>
        )}
      </div>
    </div>
  );
}

export function BoardPage() {
  const { project } = useSearch({ from: '/board' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = ['boardTasks', project ?? ''] as const;

  const tasks = useQuery({
    queryKey: key,
    queryFn: () => api.tasks({ project: project || undefined }),
  });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const move = useMutation({
    mutationFn: ({ path, status }: { path: string; status: TaskStatus }) =>
      api.patchTask(path, { status }),
    onMutate: async ({ path, status }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<TaskRow[]>(key);
      queryClient.setQueryData<TaskRow[]>(key, (old) =>
        (old ?? []).map((t) => (t.path === path ? { ...t, status } : t)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(key, ctx.prev),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <div className="flex h-full flex-col px-6 py-5">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Board</h1>
        <select
          value={project ?? ''}
          onChange={(e) =>
            void navigate({ to: '/board', search: e.target.value ? { project: e.target.value } : {} })
          }
          className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-muted"
        >
          <option value="">All projects</option>
          {projects.data?.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.title}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-faintest">drag a card to change its status</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {TASK_STATUSES.map((status) => {
          const items = (tasks.data ?? []).filter((t) => t.status === status);
          return (
            <div
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOver !== status) setDragOver(status);
              }}
              onDragLeave={() => setDragOver((d) => (d === status ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const path = e.dataTransfer.getData('text/plain');
                const current = tasks.data?.find((t) => t.path === path);
                if (path && current && current.status !== status) move.mutate({ path, status });
              }}
              className={clsx(
                'flex w-72 shrink-0 flex-col rounded-xl border transition-colors',
                dragOver === status ? 'border-accent-border bg-accent-wash' : 'border-line bg-surface-2/40',
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2 text-[12px] font-semibold uppercase tracking-[.05em] text-faint">
                {STATUS_LABELS[status]}
                <span className="text-ghost">{items.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.map((task) => (
                  <BoardCard key={task.path} task={task} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
