import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { SearchHit, VaultEvent } from '@forma/core';
import { api } from '../api';

const NAV = [
  { to: '/tasks', label: 'Задачи', icon: '☑' },
  { to: '/projects', label: 'Проекты', icon: '▤' },
  { to: '/docs', label: 'Документы', icon: '✎' },
] as const;

/** Live-обновления: изменения vault (агент, внешний редактор) инвалидируют кеш. */
function useVaultEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('vault', (e) => {
      const event = JSON.parse((e as MessageEvent).data) as VaultEvent;
      void queryClient.invalidateQueries({ queryKey: ['tree'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['doc', event.path] });
    });
    return () => source.close();
  }, [queryClient]);
}

function SearchBox() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const onChange = (value: string) => {
    setQuery(value);
    clearTimeout(timer.current);
    if (value.trim() === '') {
      setHits([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const results = await api.search(value);
      setHits(results);
      setOpen(true);
    }, 200);
  };

  const openDoc = (path: string) => {
    setOpen(false);
    setQuery('');
    void navigate({ to: '/docs', search: { path } });
  };

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => query && setOpen(true)}
        placeholder="Поиск…"
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
      />
      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-80 w-72 overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          {hits.map((hit) => (
            <button
              key={hit.path}
              onMouseDown={() => openDoc(hit.path)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-50"
            >
              <div className="font-medium">{hit.title}</div>
              <div
                className="truncate text-xs text-stone-500"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  useVaultEvents();
  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r border-stone-200 bg-white p-4">
        <div className="flex items-center gap-2 px-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-900 font-bold text-white">
            F
          </div>
          <span className="text-lg font-semibold tracking-tight">Forma</span>
        </div>
        <SearchBox />
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-lg px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              activeProps={{
                className: clsx('rounded-lg px-3 py-1.5 text-sm', 'bg-stone-100 font-medium text-stone-900'),
              }}
            >
              <span className="mr-2 opacity-60">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-1 text-xs text-stone-400">Forma · фаза 0</div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
