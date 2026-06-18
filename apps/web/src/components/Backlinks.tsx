import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api';

/** "Linked references" — documents whose body links to this one. */
export function Backlinks({ path }: { path: string }) {
  const q = useQuery({ queryKey: ['backlinks', path], queryFn: () => api.backlinks(path) });
  const links = q.data ?? [];
  if (links.length === 0) return null;

  return (
    <div className="mx-auto mt-8 max-w-3xl border-t border-line pt-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faintest">
        Linked references <span className="text-ghost">{links.length}</span>
      </h3>
      <div className="flex flex-col gap-0.5">
        {links.map((l) => (
          <Link
            key={l.path}
            to="/docs"
            search={{ path: l.path }}
            className="flex items-baseline gap-2 truncate rounded-lg px-2 py-1 text-sm text-muted hover:bg-active"
          >
            <span className="truncate">{l.title}</span>
            <span className="truncate font-mono text-[10px] text-faintest">{l.path}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
