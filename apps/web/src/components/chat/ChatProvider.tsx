import { useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface ContextSelection {
  /** Unique per capture, so the view re-initialises on each new selection. */
  id: number;
  docPath: string;
  from: number;
  to: number;
  /** Human label, e.g. "12–18" or "12". */
  lines: string;
  /** Selected text, sent to the agent as context. */
  text: string;
}

/** A workbench tab: an open document or an agent chat. */
export type WTab =
  | { id: string; kind: 'doc'; path: string }
  | { id: string; kind: 'chat'; sessionId: string | null; title: string };
/** A tab without its assigned id (distributive, unlike Omit over a union). */
type NewTab =
  | { kind: 'doc'; path: string }
  | { kind: 'chat'; sessionId: string | null; title: string };

/** An editor group: an ordered set of tabs with one active. Groups sit side by side. */
export interface WGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

interface Workbench {
  groups: WGroup[];
  activeGroupId: string;
  tabs: Record<string, WTab>;
  seq: number;
}

const STORE_KEY = 'forma:workbench';

function emptyWorkbench(): Workbench {
  return { groups: [{ id: 'g0', tabIds: [], activeTabId: null }], activeGroupId: 'g0', tabs: {}, seq: 1 };
}

function hydrate(): Workbench {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Workbench | null;
    if (s && Array.isArray(s.groups) && s.groups.length > 0 && s.tabs) return s;
  } catch {
    // fall through
  }
  return emptyWorkbench();
}

/** Drop never-sent draft chats before persisting (empty tabs aren't worth restoring). */
function serialize(wb: Workbench): Workbench {
  const drop = new Set(
    Object.values(wb.tabs)
      .filter((t) => t.kind === 'chat' && t.sessionId === null)
      .map((t) => t.id),
  );
  if (drop.size === 0) return wb;
  const tabs: Record<string, WTab> = {};
  for (const [id, t] of Object.entries(wb.tabs)) if (!drop.has(id)) tabs[id] = t;
  let groups = wb.groups.map((g) => ({
    ...g,
    tabIds: g.tabIds.filter((id) => !drop.has(id)),
    activeTabId: g.activeTabId && drop.has(g.activeTabId) ? null : g.activeTabId,
  }));
  groups = groups.map((g) => ({ ...g, activeTabId: g.activeTabId ?? g.tabIds[g.tabIds.length - 1] ?? null }));
  if (groups.length > 1) groups = groups.filter((g) => g.tabIds.length > 0);
  if (groups.length === 0) return emptyWorkbench();
  const activeGroupId = groups.some((g) => g.id === wb.activeGroupId) ? wb.activeGroupId : groups[0].id;
  return { ...wb, tabs, groups, activeGroupId };
}

// — pure helpers on the workbench snapshot —
const groupOf = (wb: Workbench, tabId: string) => wb.groups.find((g) => g.tabIds.includes(tabId));
const activeTab = (wb: Workbench): WTab | null => {
  const g = wb.groups.find((x) => x.id === wb.activeGroupId);
  return g?.activeTabId ? wb.tabs[g.activeTabId] ?? null : null;
};
function removeFromGroup(g: WGroup, tabId: string): WGroup {
  const idx = g.tabIds.indexOf(tabId);
  const tabIds = g.tabIds.filter((x) => x !== tabId);
  let activeTabId = g.activeTabId;
  if (activeTabId === tabId) activeTabId = tabIds[idx] ?? tabIds[idx - 1] ?? null;
  return { ...g, tabIds, activeTabId };
}
function activate(wb: Workbench, tabId: string): Workbench {
  const g = groupOf(wb, tabId);
  if (!g) return wb;
  return {
    ...wb,
    activeGroupId: g.id,
    groups: wb.groups.map((x) => (x.id === g.id ? { ...x, activeTabId: tabId } : x)),
  };
}
function addTab(wb: Workbench, tab: NewTab): Workbench {
  const id = `t${wb.seq}`;
  return {
    ...wb,
    seq: wb.seq + 1,
    tabs: { ...wb.tabs, [id]: { ...tab, id } as WTab },
    groups: wb.groups.map((g) =>
      g.id === wb.activeGroupId ? { ...g, tabIds: [...g.tabIds, id], activeTabId: id } : g,
    ),
  };
}
function pruneEmpty(groups: WGroup[]): WGroup[] {
  return groups.length > 1 ? groups.filter((g) => g.tabIds.length > 0) : groups;
}

interface ChatContextValue {
  // — workbench —
  groups: WGroup[];
  activeGroupId: string;
  tabs: Record<string, WTab>;
  /** The active tab in the active group is a chat. */
  activeIsChat: boolean;
  openDoc: (path: string) => void;
  openChat: (sessionId: string, title?: string) => void;
  newChat: () => void;
  closeTab: (tabId: string) => void;
  focusGroup: (groupId: string) => void;
  activateTab: (groupId: string, tabId: string) => void;
  moveTab: (tabId: string, toGroupId: string, toIndex?: number) => void;
  splitRight: (tabId: string) => void;
  /** Drag a tab onto empty space to open it in a fresh rightmost group. */
  dropToNewGroup: (tabId: string) => void;
  onChatCreated: (tabId: string, sessionId: string, title: string) => void;
  renameDoc: (oldPath: string, newPath: string) => void;
  closeDocTabs: (path: string) => void;
  // — chat seeds —
  pendingContextDoc: string | null;
  startWithDoc: (docPath: string) => void;
  clearPendingDoc: () => void;
  pendingPrompt: string | null;
  startWithPrompt: (prompt: string) => void;
  clearPendingPrompt: () => void;
  contextSelection: ContextSelection | null;
  startWithSelection: (sel: Omit<ContextSelection, 'id'>) => void;
  clearContextSelection: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [wb, setWb] = useState<Workbench>(hydrate);
  const [pendingContextDoc, setPendingContextDoc] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [contextSelection, setContextSelection] = useState<ContextSelection | null>(null);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(serialize(wb)));
  }, [wb]);

  const value = useMemo<ChatContextValue>(() => {
    const goWorkbench = () => void navigate({ to: '/docs', search: (prev) => prev });
    const addDraftChat = (cur: Workbench) => addTab(cur, { kind: 'chat', sessionId: null, title: 'New chat' });

    return {
      groups: wb.groups,
      activeGroupId: wb.activeGroupId,
      tabs: wb.tabs,
      activeIsChat: activeTab(wb)?.kind === 'chat',

      openDoc: (path) =>
        setWb((cur) => {
          const existing = Object.values(cur.tabs).find((t) => t.kind === 'doc' && t.path === path);
          return existing ? activate(cur, existing.id) : addTab(cur, { kind: 'doc', path });
        }),

      openChat: (sessionId, title = '') =>
        setWb((cur) => {
          const existing = Object.values(cur.tabs).find(
            (t) => t.kind === 'chat' && t.sessionId === sessionId,
          );
          return existing
            ? activate(cur, existing.id)
            : addTab(cur, { kind: 'chat', sessionId, title: title || 'Chat' });
        }),

      newChat: () => {
        setWb((cur) => addDraftChat(cur));
        goWorkbench();
      },

      closeTab: (tabId) =>
        setWb((cur) => {
          const g = groupOf(cur, tabId);
          if (!g) return cur;
          const { [tabId]: _drop, ...tabs } = cur.tabs;
          let groups = cur.groups.map((x) => (x.id === g.id ? removeFromGroup(x, tabId) : x));
          groups = pruneEmpty(groups);
          const activeGroupId = groups.some((x) => x.id === cur.activeGroupId)
            ? cur.activeGroupId
            : groups[groups.length - 1].id;
          return { ...cur, tabs, groups, activeGroupId };
        }),

      focusGroup: (groupId) =>
        setWb((cur) => (cur.activeGroupId === groupId ? cur : { ...cur, activeGroupId: groupId })),

      activateTab: (groupId, tabId) =>
        setWb((cur) => ({
          ...cur,
          activeGroupId: groupId,
          groups: cur.groups.map((g) => (g.id === groupId ? { ...g, activeTabId: tabId } : g)),
        })),

      moveTab: (tabId, toGroupId, toIndex) =>
        setWb((cur) => {
          const from = groupOf(cur, tabId);
          if (!from) return cur;
          let groups = cur.groups.map((g) => (g.id === from.id ? removeFromGroup(g, tabId) : g));
          groups = groups.map((g) => {
            if (g.id !== toGroupId) return g;
            const tabIds = [...g.tabIds];
            const i = toIndex == null || toIndex > tabIds.length ? tabIds.length : toIndex;
            tabIds.splice(i, 0, tabId);
            return { ...g, tabIds, activeTabId: tabId };
          });
          groups = groups.filter((g) => g.id === toGroupId || g.tabIds.length > 0 || groups.length === 1);
          return { ...cur, groups, activeGroupId: toGroupId };
        }),

      splitRight: (tabId) =>
        setWb((cur) => {
          const from = groupOf(cur, tabId);
          if (!from || from.tabIds.length < 2) return cur;
          const gid = `g${cur.seq}`;
          let groups = cur.groups.map((g) => (g.id === from.id ? removeFromGroup(g, tabId) : g));
          groups = [...groups, { id: gid, tabIds: [tabId], activeTabId: tabId }];
          return { ...cur, groups, activeGroupId: gid, seq: cur.seq + 1 };
        }),

      dropToNewGroup: (tabId) =>
        setWb((cur) => {
          const from = groupOf(cur, tabId);
          if (!from) return cur;
          // No-op if it's already alone in its group.
          if (from.tabIds.length < 2) return activate(cur, tabId);
          const gid = `g${cur.seq}`;
          let groups = cur.groups.map((g) => (g.id === from.id ? removeFromGroup(g, tabId) : g));
          groups = [...groups, { id: gid, tabIds: [tabId], activeTabId: tabId }];
          return { ...cur, groups, activeGroupId: gid, seq: cur.seq + 1 };
        }),

      onChatCreated: (tabId, sessionId, title) =>
        setWb((cur) =>
          cur.tabs[tabId]
            ? { ...cur, tabs: { ...cur.tabs, [tabId]: { ...cur.tabs[tabId], sessionId, title } as WTab } }
            : cur,
        ),

      renameDoc: (oldPath, newPath) =>
        setWb((cur) => {
          const tabs: Record<string, WTab> = {};
          for (const [id, t] of Object.entries(cur.tabs))
            tabs[id] = t.kind === 'doc' && t.path === oldPath ? { ...t, path: newPath } : t;
          return { ...cur, tabs };
        }),

      closeDocTabs: (path) =>
        setWb((cur) => {
          const ids = Object.values(cur.tabs)
            .filter((t) => t.kind === 'doc' && t.path === path)
            .map((t) => t.id);
          if (ids.length === 0) return cur;
          const tabs = { ...cur.tabs };
          for (const id of ids) delete tabs[id];
          let groups = cur.groups.map((g) => {
            let ng = g;
            for (const id of ids) if (ng.tabIds.includes(id)) ng = removeFromGroup(ng, id);
            return ng;
          });
          groups = pruneEmpty(groups);
          const activeGroupId = groups.some((g) => g.id === cur.activeGroupId)
            ? cur.activeGroupId
            : groups[groups.length - 1].id;
          return { ...cur, tabs, groups, activeGroupId };
        }),

      pendingContextDoc,
      startWithDoc: (docPath) => {
        setContextSelection(null);
        setPendingContextDoc(docPath);
        setWb((cur) => (activeTab(cur)?.kind === 'chat' ? cur : addDraftChat(cur)));
        goWorkbench();
      },
      clearPendingDoc: () => setPendingContextDoc(null),
      pendingPrompt,
      startWithPrompt: (prompt) => {
        setPendingPrompt(prompt);
        setWb((cur) => addDraftChat(cur));
        goWorkbench();
      },
      clearPendingPrompt: () => setPendingPrompt(null),
      contextSelection,
      startWithSelection: (sel) => {
        setContextSelection({ ...sel, id: Date.now() });
        setWb((cur) => (activeTab(cur)?.kind === 'chat' ? cur : addDraftChat(cur)));
        goWorkbench();
      },
      clearContextSelection: () => setContextSelection(null),
    };
  }, [navigate, wb, pendingContextDoc, pendingPrompt, contextSelection]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
