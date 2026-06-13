import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
  const { done, total } = progress(project);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const active =
    (project.taskCounts.todo ?? 0) +
    (project.taskCounts.in_progress ?? 0) +
    (project.taskCounts.blocked ?? 0) +
    (project.taskCounts.inbox ?? 0);

  return (
    <Link
      to="/docs"
      search={{ path: project.path }}
      className="block rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="truncate font-semibold">{project.title}</h3>
        {project.status && (
          <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
            {project.status}
          </span>
        )}
      </div>
      <div className="mb-3 text-xs text-stone-500">
        {active > 0 ? `${active} active tasks` : 'no active tasks'}
        {project.due && (
          <span className={clsx('ml-2', isOverdue(project.due) && 'font-medium text-rose-600')}>
            due {project.due}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-right text-[10px] text-stone-400">
        {done}/{total}
      </div>
    </Link>
  );
}

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <span className="text-xs text-stone-400">
          a project is projects/&lt;slug&gt;/project.md in the vault
        </span>
      </div>
      {projects.data?.length === 0 && (
        <div className="py-16 text-center text-sm text-stone-400">No projects yet</div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {projects.data?.map((p) => (
          <ProjectCard key={p.path} project={p} />
        ))}
      </div>
    </div>
  );
}
