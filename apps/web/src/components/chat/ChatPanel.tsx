import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { api, API_BASE } from '../../api';
import {
  foldRecords,
  type AgentEffort,
  type AgentModel,
  type PermissionProfile,
  type PersistedRecord,
  type SessionSummary,
} from '../../lib/chat';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { useChat } from './ChatProvider';

function lastIndexOf(records: PersistedRecord[], match: (r: PersistedRecord) => boolean): number {
  for (let i = records.length - 1; i >= 0; i--) if (match(records[i])) return i;
  return -1;
}

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
  const {
    isOpen,
    close,
    expanded,
    setExpanded,
    pendingContextDoc,
    clearPendingDoc,
    pendingPrompt,
    clearPendingPrompt,
    contextSelection,
    clearContextSelection,
  } = useChat();

  const [draft, setDraft] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionProfile>('full');
  const [models, setModels] = useState<AgentModel[]>([]);
  const [model, setModel] = useState<string>('');
  const [effort, setEffort] = useState<AgentEffort>('high');
  const [contextDoc, setContextDoc] = useState<string | null>(null);
  const [contextLines, setContextLines] = useState<string | null>(null);
  const [contextSelText, setContextSelText] = useState<string | null>(null);
  // Context added to an already-open chat, to be delivered with the next message.
  const [contextPending, setContextPending] = useState(false);
  const [records, setRecords] = useState<PersistedRecord[]>([]);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<SessionSummary[] | null>(null);
  const [openChats, setOpenChats] = useState<OpenChat[]>(loadOpenChats);
  const [panelWidth, setPanelWidth] = useState(392);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.settings.prefs });
  const showResultMeta = prefs.data?.chatResultMeta ?? false;

  useEffect(() => {
    localStorage.setItem(OPEN_CHATS_KEY, JSON.stringify(openChats));
  }, [openChats]);

  const addOpenChat = (id: string, title: string) =>
    setOpenChats((o) =>
      o.some((c) => c.id === id)
        ? o.map((c) => (c.id === id && title ? { id, title } : c))
        : [...o, { id, title: title || 'Chat' }],
    );

  // Load the available models once and pick the server default.
  useEffect(() => {
    void api.agent.listModels().then(({ models: list, default: def }) => {
      setModels(list);
      setModel((current) => current || def);
    });
  }, []);

  // A document handed in from the editor ("Discuss"): attach to the open chat,
  // or start a fresh one if none is active.
  useEffect(() => {
    if (!pendingContextDoc) return;
    if (!activeId) {
      setRecords([]);
      setResolved(new Set());
    }
    setContextDoc(pendingContextDoc);
    setContextLines(null);
    setContextSelText(null);
    setContextPending(Boolean(activeId));
    clearPendingDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContextDoc, clearPendingDoc]);

  // A ready-made prompt (e.g. "Plan my day") seeds the composer of a fresh chat.
  useEffect(() => {
    if (!pendingPrompt) return;
    setActiveId(null);
    setRecords([]);
    setResolved(new Set());
    setContextDoc(null);
    setContextLines(null);
    setContextSelText(null);
    setDraft(pendingPrompt);
    clearPendingPrompt();
  }, [pendingPrompt, clearPendingPrompt]);

  // A selection from the editor: attach to the open chat (continue the
  // conversation) or start a fresh one. The fragment is highlighted in the
  // editor and shown as a "lines X–Y" chip.
  useEffect(() => {
    if (!contextSelection) return;
    if (!activeId) {
      setRecords([]);
      setResolved(new Set());
    }
    setContextDoc(contextSelection.docPath);
    setContextLines(contextSelection.lines);
    setContextSelText(contextSelection.text);
    setContextPending(Boolean(activeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextSelection?.id]);

  // Live stream for the active session (replays full transcript on connect).
  useEffect(() => {
    if (!activeId) return;
    setRecords([]);
    const source = new EventSource(
      `${API_BASE}/api/agent/sessions/${encodeURIComponent(activeId)}/stream`,
    );
    source.addEventListener('record', (e) => {
      const record = JSON.parse((e as MessageEvent).data) as PersistedRecord;
      setRecords((prev) => [...prev, record]);
    });
    return () => source.close();
  }, [activeId]);

  const items = useMemo(() => foldRecords(records), [records]);

  const busy = useMemo(() => {
    const lastUser = lastIndexOf(records, (r) => r.record.type === 'user');
    const lastDone = lastIndexOf(records, (r) => r.record.type === 'result' || r.record.type === 'error');
    return lastUser > lastDone;
  }, [records]);

  const thinking = busy && records[records.length - 1]?.record.type !== 'text_delta';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [records.length, thinking]);

  const send = async (text: string) => {
    let id = activeId;
    let context: string | undefined;
    if (!id) {
      const session = await api.agent.createSession({
        permission,
        model: model || undefined,
        effort,
        contextDocPath: contextDoc,
        contextSelection: contextSelText ?? undefined,
      });
      id = session.id;
      setActiveId(id);
      addOpenChat(id, text.trim().slice(0, 40));
    } else if (contextPending) {
      // Deliver newly-added context to the ongoing conversation, once.
      const parts: string[] = [];
      if (contextDoc) parts.push(`We are discussing the vault file \`${contextDoc}\`.`);
      if (contextSelText) parts.push(`Relevant selection:\n${contextSelText}`);
      context = parts.length > 0 ? parts.join('\n\n') : undefined;
    }
    await api.agent.sendMessage(id, text, context);
    setContextPending(false);
  };

  const onPermission = async (requestId: string, decision: 'allow' | 'deny') => {
    if (!activeId) return;
    setResolved((prev) => new Set(prev).add(requestId));
    await api.agent.resolvePermission(activeId, requestId, decision);
  };

  const interrupt = async () => {
    if (activeId) await api.agent.interrupt(activeId);
  };

  // Model / permission / reasoning are editable any time; apply live if a chat
  // is already running, otherwise they take effect when it's created.
  const changePermission = (p: PermissionProfile) => {
    setPermission(p);
    if (activeId) void api.agent.updateSession(activeId, { permission: p });
  };
  const changeModel = (m: string) => {
    setModel(m);
    if (activeId) void api.agent.updateSession(activeId, { model: m });
  };
  const changeEffort = (e: AgentEffort) => {
    setEffort(e);
    if (activeId) void api.agent.updateSession(activeId, { effort: e });
  };

  const clearContext = () => {
    setContextDoc(null);
    setContextLines(null);
    setContextSelText(null);
    setContextPending(false);
    clearContextSelection();
  };

  const newChat = () => {
    setActiveId(null);
    setRecords([]);
    setResolved(new Set());
    clearContext();
    setHistory(null);
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

  const openHistory = async () => {
    if (history) {
      setHistory(null);
      return;
    }
    setHistory(await api.agent.listSessions());
  };

  // Open a chat as the active tab: reattach the session and restore its settings.
  const openChat = async (id: string) => {
    const s = await api.agent.resumeSession(id);
    setPermission(s.permission);
    setModel(s.model);
    setEffort(s.effort);
    setContextDoc(s.contextDocPath);
    setContextLines(null);
    setContextSelText(null);
    setContextPending(false);
    clearContextSelection();
    setResolved(new Set());
    setHistory(null);
    addOpenChat(s.id, s.title ?? 'Chat');
    setActiveId(id);
  };

  const closeChat = (id: string) => {
    const idx = openChats.findIndex((c) => c.id === id);
    const next = openChats.filter((c) => c.id !== id);
    setOpenChats(next);
    if (id === activeId) {
      const fallback = next[idx] ?? next[idx - 1];
      if (fallback) void openChat(fallback.id);
      else newChat();
    }
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
        <button onClick={newChat} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-active" title="New chat">
          + New
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

      {(openChats.length > 0 || activeId === null) && (
        <div className="flex items-stretch overflow-x-auto border-b border-line-soft bg-surface-2/40">
          {openChats.map((c) => (
            <div
              key={c.id}
              onClick={() => void openChat(c.id)}
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
      )}

      {history && (
        <div className="max-h-64 overflow-auto border-b border-line bg-surface">
          {history.length === 0 && <div className="px-3 py-3 text-xs text-faintest">No past chats</div>}
          {history.map((s) => (
            <button
              key={s.id}
              onClick={() => void openChat(s.id)}
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

      <div className="flex-1 overflow-auto">
        <div className={clsx('px-3 py-4', expanded && 'mx-auto w-full max-w-3xl px-6')}>
          {items.length === 0 && !contextDoc && (
            <div className="mt-10 text-center text-sm text-faintest">
              Ask the agent to plan your day, sort the inbox, or build a report.
            </div>
          )}
          <ChatMessages
            items={items}
            resolvedPermissions={resolved}
            onPermission={onPermission}
            thinking={thinking}
            streaming={busy}
            showResultMeta={showResultMeta}
          />
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="bg-panel">
        <div className={clsx('space-y-2 p-3', expanded && 'mx-auto w-full max-w-3xl')}>
        {(contextDoc || contextLines) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {contextDoc && (
              <span className="flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-accent">
                {contextDoc}
                <button
                  onClick={() => setContextDoc(null)}
                  className="text-accent/60 hover:text-accent"
                  title="Remove file context"
                >
                  ✕
                </button>
              </span>
            )}
            {contextLines && (
              <span className="flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-accent">
                lines {contextLines}
                <button
                  onClick={() => {
                    setContextLines(null);
                    setContextSelText(null);
                    clearContextSelection();
                  }}
                  className="text-accent/60 hover:text-accent"
                  title="Remove selection"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        )}
        <ChatInput
          value={draft}
          onChange={setDraft}
          permission={permission}
          onPermissionChange={changePermission}
          models={models}
          model={model}
          onModelChange={changeModel}
          effort={effort}
          onEffortChange={changeEffort}
          onSend={send}
          busy={busy}
          onInterrupt={interrupt}
        />
        </div>
      </div>
    </aside>
  );
}
