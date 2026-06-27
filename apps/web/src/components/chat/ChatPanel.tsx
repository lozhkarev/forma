import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../../api';
import { type AgentModel, type SessionSummary } from '../../lib/chat';
import { ChatView } from './ChatView';
import { useChat } from './ChatProvider';

const OPEN_CHATS_KEY = 'forma:openChats';
type OpenChat = { id: string; title: string };
function loadOpenChats(): OpenChat[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_CHATS_KEY) ?? '[]');
    return Array.isArray(v) ? (v as OpenChat[]) : [];
  } catch {
    return [];
  }
}

export function ChatPanel() {
  const { isOpen, close, expanded, setExpanded, pendingPrompt, clearPendingPrompt } = useChat();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [openChats, setOpenChats] = useState<OpenChat[]>(loadOpenChats);
  const [history, setHistory] = useState<SessionSummary[] | null>(null);
  const [panelWidth, setPanelWidth] = useState(392);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.settings.prefs });
  const showResultMeta = prefs.data?.chatResultMeta ?? false;

  useEffect(() => {
    localStorage.setItem(OPEN_CHATS_KEY, JSON.stringify(openChats));
  }, [openChats]);

  useEffect(() => {
    void api.agent.listModels().then(({ models: list, default: def }) => {
      setModels(list);
      setDefaultModel(def);
    });
  }, []);

  // A ready-made prompt ("Plan my day") opens a fresh draft; the draft ChatView
  // picks up the prompt text itself.
  useEffect(() => {
    if (pendingPrompt) setActiveId(null);
  }, [pendingPrompt]);

  const addOpenChat = (id: string, title: string) =>
    setOpenChats((o) =>
      o.some((c) => c.id === id)
        ? o.map((c) => (c.id === id && title ? { id, title } : c))
        : [...o, { id, title: title || 'Chat' }],
    );

  const openChat = (id: string, title = '') => {
    addOpenChat(id, title);
    setActiveId(id);
    setHistory(null);
  };

  const newChat = () => {
    clearPendingPrompt();
    setActiveId(null);
  };

  const closeChat = (id: string) => {
    const idx = openChats.findIndex((c) => c.id === id);
    const next = openChats.filter((c) => c.id !== id);
    setOpenChats(next);
    if (id === activeId) {
      const fallback = next[idx] ?? next[idx - 1];
      setActiveId(fallback ? fallback.id : null);
    }
  };

  const openHistory = async () => {
    setHistory(history ? null : await api.agent.listSessions());
  };

  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) =>
      setPanelWidth(Math.min(760, Math.max(320, startW + (startX - ev.clientX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!isOpen) return null;

  return (
    <aside
      className={clsx(
        'relative flex flex-col border-l border-line bg-panel',
        expanded ? 'min-w-0 flex-1' : 'shrink-0',
      )}
      style={expanded ? undefined : { width: panelWidth }}
    >
      {!expanded && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent-border"
        />
      )}
      <header className="flex items-center gap-2.5 border-b border-line-soft bg-panel px-3.5 py-2.5">
        <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent">
          <span className="h-[7px] w-[7px] rounded-full bg-white" />
        </span>
        <span className="text-sm font-semibold text-ink-strong">Forma AI</span>
        <span className="ml-auto" />
        <button onClick={openHistory} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-active" title="History">
          History
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded-lg px-2 py-1 text-sm text-faintest hover:bg-active"
          title={expanded ? 'Collapse to panel' : 'Expand to full screen'}
        >
          {expanded ? '⤡' : '⤢'}
        </button>
        <button
          onClick={() => {
            setExpanded(false);
            close();
          }}
          className="rounded-lg px-2 py-1 text-faintest hover:bg-active"
          title="Close"
        >
          ✕
        </button>
      </header>

      <div className="flex items-stretch overflow-x-auto border-b border-line-soft bg-surface-2/40">
        {openChats.map((c) => (
          <div
            key={c.id}
            onClick={() => openChat(c.id, c.title)}
            onAuxClick={(e) => e.button === 1 && closeChat(c.id)}
            className={clsx(
              'group flex max-w-[12rem] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line-soft px-3 py-1.5 text-xs',
              c.id === activeId ? 'bg-panel text-ink-strong' : 'text-muted hover:bg-active/50',
            )}
            title={c.title}
          >
            <span className="truncate">{c.title || 'Chat'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeChat(c.id);
              }}
              className="ml-0.5 shrink-0 rounded px-0.5 text-faintest opacity-0 hover:bg-line-strong hover:text-body group-hover:opacity-100"
              title="Close"
            >
              ×
            </button>
          </div>
        ))}
        {activeId === null && (
          <div className="flex shrink-0 items-center border-r border-line-soft bg-panel px-3 py-1.5 text-xs text-ink-strong">
            New chat
          </div>
        )}
        <button
          onClick={newChat}
          className="shrink-0 px-2.5 py-1.5 text-sm text-faintest hover:bg-active"
          title="New chat"
        >
          ＋
        </button>
      </div>

      {history && (
        <div className="max-h-64 overflow-auto border-b border-line bg-surface">
          {history.length === 0 && <div className="px-3 py-3 text-xs text-faintest">No past chats</div>}
          {history.map((s) => (
            <button
              key={s.id}
              onClick={() => openChat(s.id, s.title ?? 'Chat')}
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

      <div className="flex min-h-0 flex-1 flex-col">
        {openChats.map((c) => (
          <ChatView
            key={c.id}
            initialSessionId={c.id}
            active={activeId === c.id}
            models={models}
            defaultModel={defaultModel}
            showResultMeta={showResultMeta}
            expanded={expanded}
            onCreated={openChat}
          />
        ))}
        {activeId === null && (
          <ChatView
            key="draft"
            initialSessionId={null}
            active
            models={models}
            defaultModel={defaultModel}
            showResultMeta={showResultMeta}
            expanded={expanded}
            onCreated={openChat}
          />
        )}
      </div>
    </aside>
  );
}
