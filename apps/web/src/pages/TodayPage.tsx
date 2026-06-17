import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TaskRow } from '@forma/core';
import { api } from '../api';
import { useChat } from '../components/chat/ChatProvider';
import { MarkdownView } from '../components/MarkdownView';
import { TaskItem } from '../components/TaskItem';

const todayStr = () => new Date().toISOString().slice(0, 10);

const PLAN_DAY_PROMPT =
  'Plan my day: review the tasks scheduled for today and anything overdue, ' +
  'pick a realistic set to focus on, and write today’s journal.';

/** Tasks worth seeing today: scheduled for today, or due today/overdue and still open. */
function isForToday(task: TaskRow, today: string): boolean {
  return task.scheduled === today || (task.due !== null && task.due <= today);
}

function effectiveDate(task: TaskRow): string {
  return task.due ?? task.scheduled ?? '9999-99-99';
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

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-stone-400">{dateLabel}</p>
        </div>
        <button
          onClick={() => chat.startWithPrompt(PLAN_DAY_PROMPT)}
          className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700"
        >
          <span className="opacity-70">✦</span>
          Plan my day
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          Scheduled &amp; due
          <span className="text-stone-300">{todays.length}</span>
        </h2>
        {todays.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-400">
            Nothing scheduled for today. Ask the agent to plan your day.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-stone-200 shadow-sm">
            {todays.map((task) => (
              <TaskItem key={task.path} task={task} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-stone-400">
          <span>Journal</span>
          {journal.data && (
            <Link
              to="/docs"
              search={{ path: journalPath }}
              className="font-normal normal-case text-stone-400 hover:text-stone-600"
            >
              Open
            </Link>
          )}
        </h2>
        {journal.data ? (
          <div className="rounded-xl border border-stone-200 bg-white px-6 py-4 shadow-sm">
            <MarkdownView markdown={journal.data.body} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-400">
            No journal for today yet.{' '}
            <button
              onClick={() => chat.startWithPrompt(PLAN_DAY_PROMPT)}
              className="text-stone-600 underline hover:text-stone-900"
            >
              Plan your day
            </button>{' '}
            to create one.
          </div>
        )}
      </section>
    </div>
  );
}
