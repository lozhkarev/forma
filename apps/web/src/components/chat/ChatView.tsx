import { useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE } from '../../api';
import {
  foldRecords,
  type AgentEffort,
  type AgentModel,
  type PermissionProfile,
  type PersistedRecord,
} from '../../lib/chat';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { useChat } from './ChatProvider';

function lastIndexOf(records: PersistedRecord[], match: (r: PersistedRecord) => boolean): number {
  for (let i = records.length - 1; i >= 0; i--) if (match(records[i])) return i;
  return -1;
}

interface Props {
  /** Existing session to attach to, or null for a fresh draft. */
  initialSessionId: string | null;
  /** Shown (the active tab in its group); hidden tabs stay mounted. */
  visible: boolean;
  /** Focused (active tab of the active group): consumes global seeds. */
  active: boolean;
  models: AgentModel[];
  defaultModel: string;
  showResultMeta: boolean;
  expanded: boolean;
  /** Fires when a draft becomes a real session (first message). */
  onCreated: (id: string, title: string) => void;
}

/** One agent conversation: owns its session, transcript stream and composer. */
export function ChatView({
  initialSessionId,
  visible,
  active,
  models,
  defaultModel,
  showResultMeta,
  expanded,
  onCreated,
}: Props) {
  const {
    pendingContextDoc,
    clearPendingDoc,
    pendingPrompt,
    clearPendingPrompt,
    contextSelection,
    clearContextSelection,
  } = useChat();

  const [id, setId] = useState<string | null>(initialSessionId);
  const [draft, setDraft] = useState('');
  const [permission, setPermission] = useState<PermissionProfile>('full');
  const [model, setModel] = useState<string>(defaultModel);
  const [effort, setEffort] = useState<AgentEffort>('high');
  const [contextDoc, setContextDoc] = useState<string | null>(null);
  const [contextLines, setContextLines] = useState<string | null>(null);
  const [contextSelText, setContextSelText] = useState<string | null>(null);
  const [contextPending, setContextPending] = useState(false);
  const [records, setRecords] = useState<PersistedRecord[]>([]);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (model === '' && defaultModel) setModel(defaultModel);
  }, [defaultModel, model]);

  // Reattach an existing session on mount and restore its settings.
  useEffect(() => {
    if (!initialSessionId) return;
    void api.agent.resumeSession(initialSessionId).then((s) => {
      setPermission(s.permission);
      setModel(s.model);
      setEffort(s.effort);
      setContextDoc(s.contextDocPath);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live transcript stream for the current session (replays on connect).
  useEffect(() => {
    if (!id) return;
    setRecords([]);
    const source = new EventSource(`${API_BASE}/api/agent/sessions/${encodeURIComponent(id)}/stream`);
    source.addEventListener('record', (e) => {
      const record = JSON.parse((e as MessageEvent).data) as PersistedRecord;
      setRecords((prev) => [...prev, record]);
    });
    return () => source.close();
  }, [id]);

  // Global seeds (only the active draft consumes them).
  useEffect(() => {
    if (!active || !pendingContextDoc) return;
    setContextDoc(pendingContextDoc);
    setContextLines(null);
    setContextSelText(null);
    setContextPending(Boolean(id));
    clearPendingDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pendingContextDoc]);

  useEffect(() => {
    if (!active || !pendingPrompt) return;
    setDraft(pendingPrompt);
    clearPendingPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pendingPrompt]);

  useEffect(() => {
    if (!active || !contextSelection) return;
    setContextDoc(contextSelection.docPath);
    setContextLines(contextSelection.lines);
    setContextSelText(contextSelection.text);
    setContextPending(Boolean(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, contextSelection?.id]);

  const items = useMemo(() => foldRecords(records), [records]);
  const busy = useMemo(() => {
    const lastUser = lastIndexOf(records, (r) => r.record.type === 'user');
    const lastDone = lastIndexOf(records, (r) => r.record.type === 'result' || r.record.type === 'error');
    return lastUser > lastDone;
  }, [records]);
  const thinking = busy && records[records.length - 1]?.record.type !== 'text_delta';

  useEffect(() => {
    if (visible) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [records.length, thinking, visible]);

  const send = async (text: string) => {
    let sid = id;
    let context: string | undefined;
    if (!sid) {
      const session = await api.agent.createSession({
        permission,
        model: model || undefined,
        effort,
        contextDocPath: contextDoc,
        contextSelection: contextSelText ?? undefined,
      });
      sid = session.id;
      setId(sid);
      onCreated(sid, text.trim().slice(0, 40));
    } else if (contextPending) {
      const parts: string[] = [];
      if (contextDoc) parts.push(`We are discussing the vault file \`${contextDoc}\`.`);
      if (contextSelText) parts.push(`Relevant selection:\n${contextSelText}`);
      context = parts.length > 0 ? parts.join('\n\n') : undefined;
    }
    await api.agent.sendMessage(sid, text, context);
    setContextPending(false);
  };

  const onPermission = async (requestId: string, decision: 'allow' | 'deny') => {
    if (!id) return;
    setResolved((prev) => new Set(prev).add(requestId));
    await api.agent.resolvePermission(id, requestId, decision);
  };
  const interrupt = async () => {
    if (id) await api.agent.interrupt(id);
  };
  const changePermission = (p: PermissionProfile) => {
    setPermission(p);
    if (id) void api.agent.updateSession(id, { permission: p });
  };
  const changeModel = (m: string) => {
    setModel(m);
    if (id) void api.agent.updateSession(id, { model: m });
  };
  const changeEffort = (e: AgentEffort) => {
    setEffort(e);
    if (id) void api.agent.updateSession(id, { effort: e });
  };

  return (
    <div className={visible ? 'flex h-full flex-col' : 'hidden'}>
      <div className="flex-1 overflow-auto">
        <div className={expanded ? 'mx-auto w-full max-w-3xl px-6 py-4' : 'px-3 py-4'}>
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
        <div className={expanded ? 'mx-auto w-full max-w-3xl space-y-2 p-3' : 'space-y-2 p-3'}>
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
    </div>
  );
}
