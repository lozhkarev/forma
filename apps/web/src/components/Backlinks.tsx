import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api';

/** "Linked references" — documents whose body links to this one. */
export function Backlinks({ path }: { path: string }) {
  const q = useQuery({ queryKey: ['backlinks', path], queryFn: () => api.backlinks(path) });
  const links = q.data ?? [];
  if (links.length === 0) return null;

  return (
    <div className="mx-auto mt-8 max-w-3xl border-t border-stone-200 pt-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
        Linked references <span className="text-stone-300">{links.length}</span>
      </h3>
      <div className="flex flex-col gap-0.5">
        {links.map((l) => (
          <Link
            key={l.path}
            to="/docs"
            search={{ path: l.path }}
            className="flex items-baseline gap-2 truncate rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100"
          >
            <span className="truncate">{l.title}</span>
            <span className="truncate font-mono text-[10px] text-stone-400">{l.path}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
