import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { api } from '../../api';
import type { SessionSummary } from '../../lib/chat';
import { Editor } from '../Editor';
import { ChatView } from '../chat/ChatView';
import { useChat, type WGroup } from '../chat/ChatProvider';

/** The tab being dragged, read on drop (dataTransfer payload is the source of truth). */
const TAB_MIME = 'text/forma-tab';
const baseName = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '');

/** One open document: its editor stays mounted (hidden when not active) so unsaved
 *  edits and scroll survive tab switches. */
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
      {doc.data && <Editor key={path} doc={doc.data} onDeleted={onDeleted} onDirtyChange={onDirty} />}
    </div>
  );
}

function ChatRow({ s, onOpen }: { s: SessionSummary; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="block w-full border-b border-line-soft px-3 py-2 text-left last:border-0 hover:bg-surface-2"
    >
      <div className="truncate text-sm text-ink-strong">{s.title ?? 'Untitled chat'}</div>
      <div className="text-[11px] text-faintest">
        {s.turns} turns · ${s.costUsd.toFixed(3)} · {s.lastActive.slice(0, 16).replace('T', ' ')}
      </div>
    </button>
  );
}

export function WorkbenchGroup({ group, isActiveGroup }: { group: WGroup; isActiveGroup: boolean }) {
  const wb = useChat();
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);

  const modelsQ = useQuery({ queryKey: ['agentModels'], queryFn: api.agent.listModels });
  const models = modelsQ.data?.models ?? [];
  const defaultModel = modelsQ.data?.default ?? '';
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.settings.prefs });
  const showResultMeta = prefs.data?.chatResultMeta ?? false;
  const sessionsQ = useQuery({ queryKey: ['agentSessions'], queryFn: api.agent.listSessions });
  const sessions = sessionsQ.data ?? [];
  const folders = [...new Set(sessions.map((s) => s.folder).filter((f): f is string => !!f))].sort();

  const setDirtyFor = (id: string, d: boolean) =>
    setDirty((m) => (m[id] === d ? m : { ...m, [id]: d }));

  const tabIdFrom = (e: React.DragEvent) => e.dataTransfer.getData(TAB_MIME);
  const onTabDragStart = (e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData(TAB_MIME, tabId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const allowDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault();
  };
  const dropOnGroup = (e: React.DragEvent) => {
    const id = tabIdFrom(e);
    if (id) wb.moveTab(id, group.id);
  };
  const dropOnTab = (e: React.DragEvent, index: number) => {
    e.stopPropagation();
    const id = tabIdFrom(e);
    if (id) wb.moveTab(id, group.id, index);
  };

  const toggleHistory = () => {
    if (!historyOpen) void sessionsQ.refetch();
    setHistoryOpen((o) => !o);
  };
  const openFromHistory = (s: SessionSummary) => {
    wb.focusGroup(group.id);
    wb.openChat(s.id, s.title ?? 'Chat');
    setHistoryOpen(false);
  };

  // Group past chats by folder for the History dropdown; unfiled chats last.
  const byFolder = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const key = s.folder ?? '';
    const list = byFolder.get(key) ?? [];
    list.push(s);
    byFolder.set(key, list);
  }
  const folderSections = [...folders.map((f) => [f, byFolder.get(f) ?? []] as const)];
  const unfiled = byFolder.get('') ?? [];

  return (
    <div
      onMouseDownCapture={() => !isActiveGroup && wb.focusGroup(group.id)}
      className={clsx(
        'flex min-w-0 flex-1 flex-col border-r border-line last:border-r-0',
        isActiveGroup ? 'bg-surface' : 'bg-surface',
      )}
    >
      <div
        onDragOver={allowDrop}
        onDrop={dropOnGroup}
        className={clsx(
          'relative flex shrink-0 items-stretch border-b',
          isActiveGroup ? 'border-line bg-surface-2/40' : 'border-line-soft bg-surface-2/20',
        )}
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {group.tabIds.map((id, index) => {
            const t = wb.tabs[id];
            if (!t) return null;
            const active = group.activeTabId === id;
            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => onTabDragStart(e, id)}
                onDragOver={allowDrop}
                onDrop={(e) => dropOnTab(e, index)}
                onClick={() => wb.activateTab(group.id, id)}
                onAuxClick={(e) => e.button === 1 && wb.closeTab(id)}
                className={clsx(
                  'group flex cursor-pointer items-center gap-1.5 border-r border-line px-3 py-1.5 text-xs',
                  active ? 'bg-surface text-ink-strong' : 'text-muted hover:bg-active/50',
                )}
                title={t.kind === 'doc' ? t.path : t.title}
              >
                {t.kind === 'chat' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />}
                <span className="max-w-[12rem] truncate">
                  {t.kind === 'doc' ? baseName(t.path) : t.title || 'Chat'}
                </span>
                {t.kind === 'doc' && dirty[id] ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    wb.closeTab(id);
                  }}
                  className="ml-0.5 shrink-0 rounded px-0.5 text-faintest opacity-0 hover:bg-line-strong hover:text-body group-hover:opacity-100"
                  title="Close"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-stretch border-l border-line">
          <button
            onClick={() => {
              wb.focusGroup(group.id);
              wb.newChat();
            }}
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
          {group.activeTabId && group.tabIds.length > 1 && (
            <button
              onClick={() => wb.splitRight(group.activeTabId!)}
              className="px-2 text-sm text-faintest hover:bg-active"
              title="Split right"
            >
              ⊟
            </button>
          )}
        </div>

        {historyOpen && (
          <div className="absolute right-0 top-full z-20 max-h-96 w-72 overflow-auto rounded-b-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
            {sessions.length === 0 && <div className="px-3 py-3 text-xs text-faintest">No past chats</div>}
            {folderSections.map(([name, list]) => (
              <div key={name}>
                <div className="sticky top-0 flex items-center gap-1 bg-surface-2/80 px-3 py-1 text-[11px] font-medium text-faint backdrop-blur">
                  <span className="opacity-70">📁</span>
                  {name}
                </div>
                {list.map((s) => (
                  <ChatRow key={s.id} s={s} onOpen={() => openFromHistory(s)} />
                ))}
              </div>
            ))}
            {unfiled.length > 0 && folders.length > 0 && (
              <div className="px-3 py-1 text-[11px] font-medium text-faintest">Unfiled</div>
            )}
            {unfiled.map((s) => (
              <ChatRow key={s.id} s={s} onOpen={() => openFromHistory(s)} />
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1" onDragOver={allowDrop} onDrop={dropOnGroup}>
        {!group.activeTabId && (
          <div className="flex h-full items-center justify-center text-sm text-faintest">
            Open a document or start a chat
          </div>
        )}
        {group.tabIds.map((id) => {
          const t = wb.tabs[id];
          if (!t) return null;
          const visible = group.activeTabId === id;
          if (t.kind === 'doc') {
            return (
              <DocTab
                key={id}
                path={t.path}
                active={visible}
                onDeleted={() => {
                  wb.closeTab(id);
                  void queryClient.invalidateQueries({ queryKey: ['tree'] });
                }}
                onDirty={(d) => setDirtyFor(id, d)}
              />
            );
          }
          return (
            <ChatView
              key={id}
              initialSessionId={t.sessionId}
              visible={visible}
              active={visible && isActiveGroup}
              models={models}
              defaultModel={defaultModel}
              showResultMeta={showResultMeta}
              expanded
              folders={folders}
              onCreated={(sid, title) => wb.onChatCreated(id, sid, title)}
            />
          );
        })}
      </div>
    </div>
  );
}
