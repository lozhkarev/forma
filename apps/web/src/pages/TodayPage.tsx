import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { TaskRow } from '@forma/core';
import { api } from '../api';
import { useChat } from '../components/chat/ChatProvider';
import { MarkdownView } from '../components/MarkdownView';
import { TaskItem } from '../components/TaskItem';

const todayStr = () => new Date().toISOString().slice(0, 10);

const PLAN_DAY_PROMPT =
  'Plan my day: review the tasks scheduled for today and anything overdue, ' +
  'pick a realistic set to focus on, and write today’s journal.';

function isForToday(task: TaskRow, today: string): boolean {
  return task.scheduled === today || (task.due !== null && task.due <= today);
}

function effectiveDate(task: TaskRow): string {
  return task.due ?? task.scheduled ?? '9999-99-99';
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[.05em] text-faint">
      {children}
    </div>
  );
}

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function TodayPage() {
  const today = todayStr();
  const chat = useChat();
  const journalPath = `journal/${today}.md`;

  const tasks = useQuery({
    queryKey: ['tasks', 'today'],
    queryFn: () => api.tasks({ status: 'active' }),
  });
  const journal = useQuery({
    queryKey: ['doc', journalPath],
    queryFn: () => api.doc(journalPath),
    retry: false,
  });

  const todays = (tasks.data ?? [])
    .filter((t) => isForToday(t, today))
    .sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)));

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="min-h-full bg-surface-2">
      <div className="mx-auto max-w-3xl px-7 pb-12 pt-12">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-1.5 text-[14px] font-medium text-faint">{dateLabel}</div>
            <h1 className="text-[32px] font-bold leading-none tracking-[-.02em] text-ink">
              {greetingFor(now.getHours())} 👋
            </h1>
          </div>
          <button
            onClick={() => chat.startWithPrompt(PLAN_DAY_PROMPT)}
            className="mt-1 flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] hover:bg-accent-strong"
          >
            <span className="text-white/80">✦</span>
            Plan my day
          </button>
        </div>

        <section className="mb-8">
          <SectionLabel>
            Today · tasks <span className="text-ghost">{todays.length}</span>
          </SectionLabel>
          {todays.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-faintest">
              Nothing scheduled for today. Ask the agent to plan your day.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line shadow-[var(--shadow-soft)]">
              {todays.map((task) => (
                <TaskItem key={task.path} task={task} />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionLabel>
            <span>Journal</span>
            {journal.data && (
              <Link
                to="/docs"
                search={{ path: journalPath }}
                className="font-normal normal-case tracking-normal text-faintest hover:text-muted"
              >
                Open
              </Link>
            )}
          </SectionLabel>
          {journal.data ? (
            <div className="rounded-xl border border-line bg-surface px-6 py-4 shadow-[var(--shadow-soft)]">
              <MarkdownView markdown={journal.data.body} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-faintest">
              No journal for today yet.{' '}
              <button
                onClick={() => chat.startWithPrompt(PLAN_DAY_PROMPT)}
                className="font-medium text-accent underline hover:text-accent-strong"
              >
                Plan your day
              </button>{' '}
              to create one.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
