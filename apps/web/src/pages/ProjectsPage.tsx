import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import type { ProjectRow } from '@forma/core';
import { api } from '../api';
import { isOverdue } from '../lib/labels';

function progress(p: ProjectRow): { done: number; total: number } {
  const counts = p.taskCounts;
  const total = Object.entries(counts)
    .filter(([status]) => status !== 'cancelled')
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  return { done: counts.done ?? 0, total };
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const navigate = useNavigate();
  const { done, total } = progress(project);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const active =
    (project.taskCounts.todo ?? 0) +
    (project.taskCounts.in_progress ?? 0) +
    (project.taskCounts.blocked ?? 0) +
    (project.taskCounts.inbox ?? 0);

  return (
    <Link
      to="/board"
      search={{ project: project.slug }}
      className="block rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)] transition hover:border-line-strong hover:shadow"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="truncate font-semibold text-ink-strong">{project.title}</h3>
        {project.status && (
          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {project.status}
          </span>
        )}
      </div>
      <div className="mb-3 text-xs text-faint">
        {active > 0 ? `${active} active tasks` : 'no active tasks'}
        {project.due && (
          <span className={clsx('ml-2', isOverdue(project.due) && 'font-medium text-rose-600')}>
            due {project.due}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ghost">
        <button
          onClick={(e) => {
            e.preventDefault();
            void navigate({ to: '/docs', search: { path: project.path } });
          }}
          className="rounded px-1.5 py-0.5 text-faint hover:bg-active hover:text-body"
        >
          project.md ↗
        </button>
        <span>
          {done}/{total}
        </span>
      </div>
    </Link>
  );
}

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  return (
    <div className="mx-auto max-w-4xl px-8 py-7">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Projects</h1>
        <span className="text-xs text-faintest">
          a project is projects/&lt;slug&gt;/project.md in the vault
        </span>
      </div>
      {projects.data?.length === 0 && (
        <div className="py-16 text-center text-sm text-faintest">No projects yet</div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {projects.data?.map((p) => (
          <ProjectCard key={p.path} project={p} />
        ))}
      </div>
    </div>
  );
}
