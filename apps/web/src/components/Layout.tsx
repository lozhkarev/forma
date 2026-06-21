import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { SearchHit, VaultEvent } from '@forma/core';
import { api, API_BASE } from '../api';
import { ChatPanel } from './chat/ChatPanel';
import { ChatProvider, useChat } from './chat/ChatProvider';

const NAV = [
  { to: '/today', label: 'Today', icon: '⌂' },
  { to: '/tasks', label: 'Tasks', icon: '✅' },
  { to: '/week', label: 'Week', icon: '🗓' },
  { to: '/projects', label: 'Projects', icon: '📁' },
  { to: '/graph', label: 'Graph', icon: '🕸' },
  { to: '/agents', label: 'Agents', icon: '🤖' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/docs', label: 'Docs', icon: '📄' },
] as const;

const navItem =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium text-muted hover:bg-active/60';
const navItemActive = 'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] bg-active font-semibold text-ink-strong';

/** Live-обновления: изменения vault (агент, внешний редактор) инвалидируют кеш. */
function useVaultEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource(API_BASE + '/api/events');
    source.addEventListener('vault', (e) => {
      const event = JSON.parse((e as MessageEvent).data) as VaultEvent;
      void queryClient.invalidateQueries({ queryKey: ['tree'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['doc', event.path] });
      void queryClient.invalidateQueries({ queryKey: ['backlinks'] });
      if (event.path.startsWith('agents/')) {
        void queryClient.invalidateQueries({ queryKey: ['agents'] });
      }
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
      <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] text-muted">
        <span className="text-[15px] opacity-60">⌕</span>
        <input
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => query && setOpen(true)}
          placeholder="Search"
          className="w-full bg-transparent font-medium placeholder:text-faintest focus:outline-none"
        />
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-80 w-72 overflow-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
          {hits.map((hit) => (
            <button
              key={hit.path}
              onMouseDown={() => openDoc(hit.path)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <div className="font-medium text-ink-strong">{hit.title}</div>
              <div
                className="truncate text-xs text-faint"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FormaAIItem() {
  const chat = useChat();
  const on = chat.isOpen;
  return (
    <button
      onClick={chat.toggle}
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px]',
        on ? 'font-semibold text-accent' : 'font-medium text-muted hover:bg-active/60',
      )}
    >
      <span
        className={clsx(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]',
          on ? 'bg-accent' : 'bg-accent-soft',
        )}
      >
        <span className={clsx('h-1.5 w-1.5 rounded-full', on ? 'bg-white' : 'bg-accent')} />
      </span>
      Forma AI
    </button>
  );
}

function LayoutInner() {
  useVaultEvents();
  const chat = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  return (
    <div className="flex h-screen bg-surface">
      {sidebarOpen && (
      <aside className="flex w-64 shrink-0 flex-col gap-0.5 border-r border-line bg-sidebar px-2 py-2.5">
        {/* workspace switcher */}
        <div className="mb-1 flex items-center gap-1">
          <Link to="/today" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-active/50">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent shadow-[var(--shadow-accent)]">
              <span className="text-[14px] font-extrabold leading-none text-white">Φ</span>
            </span>
            <span className="flex-1 truncate text-[14px] font-semibold text-ink-strong">Forma</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
            className="rounded-md px-1.5 py-1 text-faintest hover:bg-active"
          >
            «
          </button>
        </div>

        <SearchBox />
        <FormaAIItem />

        <div className="h-2" />

        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={navItem}
              activeProps={{ className: navItemActive }}
            >
              <span className="text-[15px]">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <Link to="/settings" className={navItem} activeProps={{ className: navItemActive }}>
          <span className="text-[15px] opacity-70">⚙</span>
          Settings
        </Link>
      </aside>
      )}

      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          title="Show sidebar"
          className="fixed left-2 top-2 z-30 rounded-md border border-line bg-surface px-2 py-1 text-sm text-muted shadow-[var(--shadow-soft)] hover:bg-active"
        >
          ☰
        </button>
      )}

      <main
        className={clsx(
          'min-w-0 flex-1 overflow-auto bg-surface',
          chat.isOpen && chat.expanded && 'hidden',
        )}
      >
        <Outlet />
      </main>
      <ChatPanel />
    </div>
  );
}

export function Layout() {
  return (
    <ChatProvider>
      <LayoutInner />
    </ChatProvider>
  );
}
