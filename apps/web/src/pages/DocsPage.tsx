import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { api, isConflict } from '../api';
import { Editor } from '../components/Editor';
import { FileTree } from '../components/FileTree';
import { ChatView } from '../components/chat/ChatView';
import { useChat } from '../components/chat/ChatProvider';
import type { AgentModel, SessionSummary } from '../lib/chat';

const today = () => new Date().toISOString().slice(0, 10);
const OPEN_DOCS_KEY = 'forma:openDocs';
const baseName = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '');

function loadOpenDocs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_DOCS_KEY) ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** One open document: keeps its own editor mounted (hidden when not active) so
 *  unsaved edits and scroll survive tab switches. */
function DocTab({
  path,
  active,
  onDeleted,
  onDirty,
}: {
  path: string;
  active: boolean;
  onDeleted: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const doc = useQuery({ queryKey: ['doc', path], queryFn: () => api.doc(path) });
  return (
    <div className={active ? 'h-full' : 'hidden'}>
      {doc.isError && (
        <div className="flex h-full items-center justify-center text-sm text-rose-500">
          Could not open {path}
        </div>
      )}
      {doc.data && (
        <Editor key={path} doc={doc.data} onDeleted={onDeleted} onDirtyChange={onDirty} />
      )}
    </div>
  );
}

function NewDocForm({
  initialPath = '',
  autoOpen = false,
  onCreated,
}: {
  initialPath?: string;
  autoOpen?: boolean;
  onCreated: (path: string) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    let rel = path.trim();
    if (rel === '' || rel.endsWith('/')) return;
    if (!rel.endsWith('.md')) rel += '.md';
    // в местах для задач сразу создаём задачу
    const isTask = rel.startsWith('inbox/') || /^projects\/[^/]+\/tasks\//.test(rel);
    const frontmatter = isTask ? { status: 'todo', created: today() } : { created: today() };
    try {
      await api.createDoc(rel, frontmatter, '');
      setPath('');
      setOpen(false);
      setError(null);
      onCreated(rel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not create');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mx-2 mb-1 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-left text-sm text-muted hover:border-line-strong hover:text-body"
      >
        + New document
      </button>
    );
  }

  return (
    <div className="mx-2 mb-1 flex flex-col gap-1">
      <input
        autoFocus
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="wiki/new-page.md"
        className="rounded-lg border border-line-strong px-2 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none"
      />
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div className="text-[10px] text-faintest">Enter to create, Esc to cancel</div>
    </div>
  );
}

export function DocsPage() {
  const { path } = useSearch({ from: '/docs' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tree = useQuery({ queryKey: ['tree'], queryFn: api.tree });
  const chat = useChat();
  // null = the "+ New document" button; a string = create form seeded with a dir.
  const [seed, setSeed] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>(loadOpenDocs);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<SessionSummary[] | null>(null);

  // Chat plumbing (shared with the workbench tab strip).
  const [models, setModels] = useState<AgentModel[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.settings.prefs });
  const showResultMeta = prefs.data?.chatResultMeta ?? false;
  useEffect(() => {
    void api.agent.listModels().then(({ models: list, default: def }) => {
      setModels(list);
      setDefaultModel(def);
    });
  }, []);

  const chatActive = chat.activeChat !== null;
  const select = (p: string) => {
    chat.clearActiveChat();
    void navigate({ to: '/docs', search: { path: p } });
  };
  const refreshTree = () => void queryClient.invalidateQueries({ queryKey: ['tree'] });

  useEffect(() => {
    localStorage.setItem(OPEN_DOCS_KEY, JSON.stringify(openPaths));
  }, [openPaths]);

  // The active document is always an open tab.
  useEffect(() => {
    if (path && !openPaths.includes(path)) setOpenPaths((o) => [...o, path]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Reopen the last tab on load when the URL has no document and no chat is shown.
  useEffect(() => {
    if (!path && !chatActive && openPaths.length > 0) select(openPaths[openPaths.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDirtyFor = (p: string, d: boolean) =>
    setDirty((m) => (m[p] === d ? m : { ...m, [p]: d }));

  const closeTab = (p: string) => {
    setOpenPaths((o) => {
      const idx = o.indexOf(p);
      const next = o.filter((x) => x !== p);
      if (p === path) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        void navigate({ to: '/docs', search: fallback ? { path: fallback } : {} });
      }
      return next;
    });
    setDirty((m) => {
      const { [p]: _drop, ...rest } = m;
      return rest;
    });
  };

  const move = async (from: string, to: string) => {
    let dest = to.trim();
    if (!dest.endsWith('.md')) dest += '.md';
    if (dest === from) return;
    try {
      await api.moveDoc(from, dest);
      refreshTree();
      setOpenPaths((o) => o.map((x) => (x === from ? dest : x)));
      if (path === from) select(dest);
    } catch (e) {
      window.alert(
        isConflict(e) ? `A document already exists at ${dest}` : `Could not move: ${(e as Error).message}`,
      );
    }
  };

  const remove = async (target: string) => {
    if (!window.confirm(`Delete ${target}?`)) return;
    await api.deleteDoc(target);
    refreshTree();
    closeTab(target);
  };

  const toggleHistory = async () => {
    setHistory(history ? null : await api.agent.listSessions());
  };

  const hasTabs = openPaths.length > 0 || chat.openChats.length > 0 || chat.activeChat === 'draft';

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col overflow-auto border-r border-line bg-surface-2/50 py-2">
        <NewDocForm
          key={seed ?? 'new'}
          initialPath={seed ? `${seed}/` : ''}
          autoOpen={seed !== null}
          onCreated={(p) => {
            setSeed(null);
            refreshTree();
            select(p);
          }}
        />
        {tree.data && (
          <FileTree
            node={tree.data}
            selected={chatActive ? undefined : path}
            onSelect={select}
            onMove={move}
            onDelete={remove}
            onCreateIn={setSeed}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {hasTabs && (
          <div className="relative flex shrink-0 items-stretch border-b border-line bg-surface-2/40">
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
              {openPaths.map((p) => {
                const tabActive = !chatActive && p === path;
                return (
                  <div
                    key={p}
                    onClick={() => select(p)}
                    onAuxClick={(e) => e.button === 1 && closeTab(p)}
                    className={clsx(
                      'group flex cursor-pointer items-center gap-1.5 border-r border-line px-3 py-1.5 text-xs',
                      tabActive ? 'bg-surface text-ink-strong' : 'text-muted hover:bg-active/50',
                    )}
                    title={p}
                  >
                    <span className="max-w-[12rem] truncate">{baseName(p)}</span>
                    {dirty[p] ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(p);
                      }}
                      className="ml-0.5 shrink-0 rounded px-0.5 text-faintest opacity-0 hover:bg-line-strong hover:text-body group-hover:opacity-100"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {chat.openChats.map((c) => {
                const tabActive = chat.activeChat === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => chat.openChat(c.id, c.title)}
                    onAuxClick={(e) => e.button === 1 && chat.closeChat(c.id)}
                    className={clsx(
                      'group flex cursor-pointer items-center gap-1.5 border-r border-line px-3 py-1.5 text-xs',
                      tabActive ? 'bg-surface text-ink-strong' : 'text-muted hover:bg-active/50',
                    )}
                    title={c.title}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                    <span className="max-w-[12rem] truncate">{c.title || 'Chat'}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        chat.closeChat(c.id);
                      }}
                      className="ml-0.5 shrink-0 rounded px-0.5 text-faintest opacity-0 hover:bg-line-strong hover:text-body group-hover:opacity-100"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {chat.activeChat === 'draft' && (
                <div className="flex items-center gap-1.5 border-r border-line bg-surface px-3 py-1.5 text-xs text-ink-strong">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                  New chat
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-stretch border-l border-line">
              <button
                onClick={chat.newChat}
                className="px-2.5 text-sm text-faintest hover:bg-active"
                title="New chat"
              >
                ＋
              </button>
              <button
                onClick={toggleHistory}
                className="px-2.5 text-xs text-muted hover:bg-active"
                title="Past chats"
              >
                History
              </button>
            </div>

            {history && (
              <div className="absolute right-0 top-full z-20 max-h-80 w-72 overflow-auto rounded-b-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
                {history.length === 0 && (
                  <div className="px-3 py-3 text-xs text-faintest">No past chats</div>
                )}
                {history.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      chat.openChat(s.id, s.title ?? 'Chat');
                      setHistory(null);
                    }}
                    className="block w-full border-b border-line-soft px-3 py-2 text-left last:border-0 hover:bg-surface-2"
                  >
                    <div className="truncate text-sm text-ink-strong">{s.title ?? 'Untitled chat'}</div>
                    <div className="text-[11px] text-faintest">
                      {s.turns} turns · ${s.costUsd.toFixed(3)} · {s.lastActive.slice(0, 16).replace('T', ' ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {!path && !chatActive && (
            <div className="flex h-full items-center justify-center text-sm text-faintest">
              Select a document on the left, or start a chat with the agent
            </div>
          )}
          {openPaths.map((p) => (
            <DocTab
              key={p}
              path={p}
              active={!chatActive && p === path}
              onDeleted={() => {
                refreshTree();
                closeTab(p);
              }}
              onDirty={(d) => setDirtyFor(p, d)}
            />
          ))}
          {chat.openChats.map((c) => (
            <ChatView
              key={c.id}
              initialSessionId={c.id}
              active={chat.activeChat === c.id}
              models={models}
              defaultModel={defaultModel}
              showResultMeta={showResultMeta}
              expanded
              onCreated={chat.onChatCreated}
            />
          ))}
          {chat.activeChat === 'draft' && (
            <ChatView
              key="draft"
              initialSessionId={null}
              active
              models={models}
              defaultModel={defaultModel}
              showResultMeta={showResultMeta}
              expanded
              onCreated={chat.onChatCreated}
            />
          )}
        </div>
      </div>
    </div>
  );
}
