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

export interface OpenChat {
  id: string;
  title: string;
}
/** Which chat the workbench shows: a session id, a fresh 'draft', or none. */
export type ActiveChat = string | 'draft' | null;

const OPEN_CHATS_KEY = 'forma:openChats';
function loadOpenChats(): OpenChat[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_CHATS_KEY) ?? '[]');
    return Array.isArray(v) ? (v as OpenChat[]) : [];
  } catch {
    return [];
  }
}

interface ChatContextValue {
  /** Open chat tabs (persisted), shown alongside file tabs in the workbench. */
  openChats: OpenChat[];
  /** The chat the workbench is currently showing (null → a document is shown). */
  activeChat: ActiveChat;
  /** Open (and activate) an existing chat tab; navigates to the workbench. */
  openChat: (id: string, title?: string) => void;
  /** Start a fresh draft chat in the workbench. */
  newChat: () => void;
  closeChat: (id: string) => void;
  /** A draft chat became a real session (first message). */
  onChatCreated: (id: string, title: string) => void;
  /** Deselect the chat so the workbench shows the active document. */
  clearActiveChat: () => void;
  /** Document the next/active chat should be about (consumed once by the view). */
  pendingContextDoc: string | null;
  startWithDoc: (docPath: string) => void;
  clearPendingDoc: () => void;
  /** Text to seed the composer of a fresh chat (consumed once by the view). */
  pendingPrompt: string | null;
  startWithPrompt: (prompt: string) => void;
  clearPendingPrompt: () => void;
  /** Persistent selection context: highlighted in the editor, shown as a chip. */
  contextSelection: ContextSelection | null;
  startWithSelection: (sel: Omit<ContextSelection, 'id'>) => void;
  clearContextSelection: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [openChats, setOpenChats] = useState<OpenChat[]>(loadOpenChats);
  const [activeChat, setActiveChat] = useState<ActiveChat>(null);
  const [pendingContextDoc, setPendingContextDoc] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [contextSelection, setContextSelection] = useState<ContextSelection | null>(null);

  useEffect(() => {
    localStorage.setItem(OPEN_CHATS_KEY, JSON.stringify(openChats));
  }, [openChats]);

  const value = useMemo<ChatContextValue>(() => {
    // Bring the workbench (Docs route) forward without dropping the open document.
    const goWorkbench = () => void navigate({ to: '/docs', search: (prev) => prev });
    const addOpenChat = (id: string, title: string) =>
      setOpenChats((o) =>
        o.some((c) => c.id === id)
          ? o.map((c) => (c.id === id && title ? { id, title } : c))
          : [...o, { id, title: title || 'Chat' }],
      );

    return {
      openChats,
      activeChat,
      openChat: (id, title = '') => {
        addOpenChat(id, title);
        setActiveChat(id);
        goWorkbench();
      },
      newChat: () => {
        setActiveChat('draft');
        goWorkbench();
      },
      closeChat: (id) =>
        setOpenChats((o) => {
          const idx = o.findIndex((c) => c.id === id);
          const next = o.filter((c) => c.id !== id);
          setActiveChat((cur) => (cur === id ? (next[idx] ?? next[idx - 1])?.id ?? null : cur));
          return next;
        }),
      onChatCreated: (id, title) => {
        addOpenChat(id, title);
        setActiveChat(id);
      },
      clearActiveChat: () => setActiveChat(null),
      pendingContextDoc,
      startWithDoc: (docPath) => {
        setContextSelection(null);
        setPendingContextDoc(docPath);
        setActiveChat((cur) => cur ?? 'draft');
        goWorkbench();
      },
      clearPendingDoc: () => setPendingContextDoc(null),
      pendingPrompt,
      startWithPrompt: (prompt) => {
        setPendingPrompt(prompt);
        setActiveChat('draft');
        goWorkbench();
      },
      clearPendingPrompt: () => setPendingPrompt(null),
      contextSelection,
      startWithSelection: (sel) => {
        setContextSelection({ ...sel, id: Date.now() });
        setActiveChat((cur) => cur ?? 'draft');
        goWorkbench();
      },
      clearContextSelection: () => setContextSelection(null),
    };
  }, [navigate, openChats, activeChat, pendingContextDoc, pendingPrompt, contextSelection]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
