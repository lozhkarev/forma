import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface ChatContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Document the next new chat should be about (consumed once by the panel). */
  pendingContextDoc: string | null;
  startWithDoc: (docPath: string) => void;
  clearPendingDoc: () => void;
  /** Text to seed the composer of a fresh chat (consumed once by the panel). */
  pendingPrompt: string | null;
  startWithPrompt: (prompt: string) => void;
  clearPendingPrompt: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingContextDoc, setPendingContextDoc] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const value = useMemo<ChatContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((v) => !v),
      pendingContextDoc,
      startWithDoc: (docPath: string) => {
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
    }),
    [isOpen, pendingContextDoc, pendingPrompt],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
