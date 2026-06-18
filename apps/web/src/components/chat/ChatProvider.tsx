import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface ContextSelection {
  /** Unique per capture, so the panel re-initialises on each new selection. */
  id: number;
  docPath: string;
  from: number;
  to: number;
  /** Human label, e.g. "12–18" or "12". */
  lines: string;
  /** Selected text, sent to the agent as context. */
  text: string;
}

interface ChatContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Chat expanded to fill the content area (sidebar stays visible). */
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  /** Document the next new chat should be about (consumed once by the panel). */
  pendingContextDoc: string | null;
  startWithDoc: (docPath: string) => void;
  clearPendingDoc: () => void;
  /** Text to seed the composer of a fresh chat (consumed once by the panel). */
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
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pendingContextDoc, setPendingContextDoc] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [contextSelection, setContextSelection] = useState<ContextSelection | null>(null);

  const value = useMemo<ChatContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((v) => !v),
      expanded,
      setExpanded,
      pendingContextDoc,
      startWithDoc: (docPath: string) => {
        setContextSelection(null);
        setPendingContextDoc(docPath);
        setIsOpen(true);
      },
      clearPendingDoc: () => setPendingContextDoc(null),
      pendingPrompt,
      startWithPrompt: (prompt: string) => {
        setPendingPrompt(prompt);
        setIsOpen(true);
      },
      clearPendingPrompt: () => setPendingPrompt(null),
      contextSelection,
      startWithSelection: (sel) => {
        setContextSelection({ ...sel, id: Date.now() });
        setIsOpen(true);
      },
      clearContextSelection: () => setContextSelection(null),
    }),
    [isOpen, expanded, pendingContextDoc, pendingPrompt, contextSelection],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
