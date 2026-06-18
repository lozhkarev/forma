import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import type { TaskRow, TaskStatus } from '@forma/core';
import { TASK_STATUSES } from '@forma/core';
import { api } from '../api';
import { isOverdue, PRIORITY_DOTS, STATUS_COLORS, STATUS_LABELS } from '../lib/labels';

/** One task row: status dropdown, priority dot, title link, tags, project, due. */
export function TaskItem({ task }: { task: TaskRow }) {
  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (status: TaskStatus) => api.patchTask(task.path, { status }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const closed = task.status === 'done' || task.status === 'cancelled';

  return (
    <div className="flex items-center gap-3 border-b border-line-soft bg-surface px-4 py-2.5 last:border-0">
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
        className={clsx(
          'min-w-0 flex-1 truncate text-[14.5px] hover:underline',
          closed ? 'text-done line-through' : 'text-body',
        )}
      >
        {task.title}
      </Link>
      {task.tags.map((tag) => (
        <span key={tag} className="rounded bg-chip px-1.5 py-0.5 text-[10px] text-faint">
          #{tag}
        </span>
      ))}
      {task.project && (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          {task.project}
        </span>
      )}
      {task.due && (
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-xs',
            isOverdue(task.due) && !closed ? 'bg-rose-100 font-medium text-rose-700' : 'bg-chip text-faint',
          )}
        >
          {task.due}
        </span>
      )}
    </div>
  );
}
