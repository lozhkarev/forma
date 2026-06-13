import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import {
  foldRecords,
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

export function ChatPanel() {
  const { isOpen, close, pendingContextDoc, clearPendingDoc } = useChat();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionProfile>('full');
  const [models, setModels] = useState<AgentModel[]>([]);
  const [model, setModel] = useState<string>('');
  const [contextDoc, setContextDoc] = useState<string | null>(null);
  const [records, setRecords] = useState<PersistedRecord[]>([]);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<SessionSummary[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load the available models once and pick the server default.
  useEffect(() => {
    void api.agent.listModels().then(({ models: list, default: def }) => {
      setModels(list);
      setModel((current) => current || def);
    });
  }, []);

  // A document handed in from the editor ("Discuss with agent") starts a fresh chat.
  useEffect(() => {
    if (!pendingContextDoc) return;
    setActiveId(null);
    setRecords([]);
    setResolved(new Set());
    setContextDoc(pendingContextDoc);
    clearPendingDoc();
  }, [pendingContextDoc, clearPendingDoc]);

  // Live stream for the active session (replays full transcript on connect).
  useEffect(() => {
    if (!activeId) return;
    setRecords([]);
    const source = new EventSource(`/api/agent/sessions/${encodeURIComponent(activeId)}/stream`);
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
    if (!id) {
      const session = await api.agent.createSession({
        permission,
        model: model || undefined,
        contextDocPath: contextDoc,
      });
      id = session.id;
      setActiveId(id);
    }
    await api.agent.sendMessage(id, text);
  };

  const onPermission = async (requestId: string, decision: 'allow' | 'deny') => {
    if (!activeId) return;
    setResolved((prev) => new Set(prev).add(requestId));
    await api.agent.resolvePermission(activeId, requestId, decision);
  };

  const interrupt = async () => {
    if (activeId) await api.agent.interrupt(activeId);
  };

  const newChat = () => {
    setActiveId(null);
    setRecords([]);
    setResolved(new Set());
    setContextDoc(null);
    setHistory(null);
  };

  const openHistory = async () => {
    if (history) {
      setHistory(null);
      return;
    }
    setHistory(await api.agent.listSessions());
  };

  const resume = async (summary: SessionSummary) => {
    await api.agent.resumeSession(summary.id);
    setPermission(summary.permission);
    setModel(summary.model);
    setContextDoc(summary.contextDocPath);
    setResolved(new Set());
    setHistory(null);
    setActiveId(summary.id);
  };

  if (!isOpen) return null;

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-stone-200 bg-stone-50">
      <header className="flex items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
        <span className="text-sm font-semibold">Agent</span>
        <span className="ml-auto" />
        <button onClick={openHistory} className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-stone-100" title="History">
          History
        </button>
        <button onClick={newChat} className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-stone-100" title="New chat">
          + New
        </button>
        <button onClick={close} className="rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100" title="Close">
          ✕
        </button>
      </header>

      {history && (
        <div className="max-h-64 overflow-auto border-b border-stone-200 bg-white">
          {history.length === 0 && <div className="px-3 py-3 text-xs text-stone-400">No past chats</div>}
          {history.map((s) => (
            <button
              key={s.id}
              onClick={() => resume(s)}
              className="block w-full border-b border-stone-100 px-3 py-2 text-left hover:bg-stone-50 last:border-0"
            >
              <div className="truncate text-sm">{s.title ?? 'Untitled chat'}</div>
              <div className="text-[11px] text-stone-400">
                {s.turns} turns · ${s.costUsd.toFixed(3)} · {s.lastActive.slice(0, 16).replace('T', ' ')}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto px-3 py-4">
        {items.length === 0 && !contextDoc && (
          <div className="mt-10 text-center text-sm text-stone-400">
            Ask the agent to plan your day, sort the inbox, or build a report.
          </div>
        )}
        <ChatMessages
          items={items}
          resolvedPermissions={resolved}
          onPermission={onPermission}
          thinking={thinking}
        />
        <div ref={bottomRef} />
      </div>

      <div className="space-y-2 border-t border-stone-200 bg-white p-3">
        {contextDoc && (
          <div className="flex items-center gap-1 text-xs text-stone-500">
            <span className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-violet-700">{contextDoc}</span>
            <button onClick={() => setContextDoc(null)} className="text-stone-400 hover:text-stone-600">
              ✕
            </button>
          </div>
        )}
        <ChatInput
          permission={permission}
          permissionLocked={Boolean(activeId)}
          onPermissionChange={setPermission}
          models={models}
          model={model}
          modelLocked={Boolean(activeId)}
          onModelChange={setModel}
          onSend={send}
          busy={busy}
          onInterrupt={interrupt}
        />
      </div>
    </aside>
  );
}
