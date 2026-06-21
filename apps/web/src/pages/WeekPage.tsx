import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import type { TaskRow } from '@forma/core';
import { api } from '../api';
import { useChat } from '../components/chat/ChatProvider';
import { PRIORITY_DOTS } from '../lib/labels';

const PLAN_WEEK_PROMPT =
  'Plan my week: review tasks scheduled or due this week and anything overdue, ' +
  'balance them across the days, and update their scheduled dates.';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function weekDays(): Date[] {
  const now = new Date();
  const monOffset = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - monOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function DayCard({ task }: { task: TaskRow }) {
  const closed = task.status === 'done' || task.status === 'cancelled';
  return (
    <Link
      to="/docs"
      search={{ path: task.path }}
      className="block rounded-lg border border-line bg-surface px-2.5 py-2 shadow-[var(--shadow-soft)] hover:border-line-strong"
    >
      <div
        className={clsx(
          'flex items-start gap-1.5 text-[13px] leading-snug',
          closed ? 'text-done line-through' : 'text-body',
        )}
      >
        {task.priority && (
          <span
            className={clsx('mt-1 h-2 w-2 shrink-0 rounded-full', PRIORITY_DOTS[task.priority])}
            title={`priority: ${task.priority}`}
          />
        )}
        <span className="min-w-0 flex-1">{task.title}</span>
      </div>
    </Link>
  );
}

export function WeekPage() {
  const chat = useChat();
  const tasks = useQuery({ queryKey: ['tasks', 'active'], queryFn: () => api.tasks({ status: 'active' }) });

  const days = weekDays();
  const keys = days.map(ymd);
  const inWeek = new Set(keys);
  const today = ymd(new Date());

  const byDay = new Map<string, TaskRow[]>();
  for (const key of keys) byDay.set(key, []);
  for (const t of tasks.data ?? []) {
    const key =
      t.scheduled && inWeek.has(t.scheduled)
        ? t.scheduled
        : t.due && inWeek.has(t.due)
          ? t.due
          : null;
    if (key) byDay.get(key)!.push(t);
  }

  const range = `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-6 pt-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Week</h1>
        <span className="text-sm text-faint">{range}</span>
        <button
          onClick={() => chat.startWithPrompt(PLAN_WEEK_PROMPT)}
          className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] hover:bg-accent-strong"
        >
          <span className="text-white/80">✦</span>
          Plan my week
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-6 py-4">
        {days.map((d) => {
          const key = ymd(d);
          const items = byDay.get(key) ?? [];
          const isToday = key === today;
          return (
            <div
              key={key}
              className={clsx(
                'flex min-w-[150px] flex-1 flex-col rounded-xl border',
                isToday ? 'border-accent-border bg-accent-wash' : 'border-line bg-surface-2/40',
              )}
            >
              <div className="flex items-baseline justify-between px-3 py-2">
                <span
                  className={clsx(
                    'text-[12px] font-semibold uppercase tracking-[.05em]',
                    isToday ? 'text-accent-strong' : 'text-faint',
                  )}
                >
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className={clsx('text-xs', isToday ? 'font-bold text-accent-strong' : 'text-ghost')}>
                  {d.getDate()}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.map((t) => (
                  <DayCard key={t.path} task={t} />
                ))}
                {items.length === 0 && (
                  <div className="px-1 py-3 text-center text-[11px] text-ghost">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
