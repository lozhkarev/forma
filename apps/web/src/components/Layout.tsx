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
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K focuses search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onChange = (value: string) => {
    setQuery(value);
    setSelected(0);
    clearTimeout(timer.current);
    if (value.trim() === '') {
      setHits([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const results = await api.search(value);
      setHits(results);
      setSelected(0);
      setOpen(true);
    }, 200);
  };

  const openDoc = (path: string) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    void navigate({ to: '/docs', search: { path } });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (s + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (s - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selected];
      if (hit) openDoc(hit.path);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] text-muted">
        <span className="text-[15px] opacity-60">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => query && setOpen(true)}
          placeholder="Search"
          className="w-full bg-transparent font-medium placeholder:text-faintest focus:outline-none"
        />
        <kbd className="rounded border border-line-strong px-1 text-[10px] text-faintest">⌘K</kbd>
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-80 w-72 overflow-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
          {hits.map((hit, i) => (
            <button
              key={hit.path}
              onMouseDown={() => openDoc(hit.path)}
              onMouseEnter={() => setSelected(i)}
              className={clsx(
                'block w-full px-3 py-2 text-left text-sm',
                i === selected ? 'bg-active' : 'hover:bg-surface-2',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">
                  {hit.title}
                </span>
                <span className="shrink-0 rounded bg-chip px-1.5 py-0.5 text-[10px] text-faint">
                  {hit.zone}
                </span>
              </div>
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

function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const queryClient = useQueryClient();

  // Cmd/Ctrl+Shift+I — capture to inbox from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    await api.createDoc(
      `inbox/task-${stamp}.md`,
      { title: trimmed, status: 'inbox', created: new Date().toISOString().slice(0, 10) },
      '',
    );
    setTitle('');
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Capture to inbox (⌘⇧I)"
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium text-muted hover:bg-active/60"
      >
        <span className="text-[15px] leading-none text-accent">✚</span>
        Capture
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 pt-[18vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[32rem] max-w-[90vw] rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-pop)]"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder="Capture a task to inbox…"
              className="w-full rounded-lg px-2 py-1.5 text-[15px] placeholder:text-faintest focus:outline-none"
            />
            <div className="mt-1 px-2 text-[11px] text-faintest">Enter to add · Esc to cancel</div>
          </div>
        </div>
      )}
    </>
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
        <QuickCapture />
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
