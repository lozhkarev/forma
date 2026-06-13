import { useLayoutEffect, useRef, useState } from 'react';
import type { PermissionProfile } from '../../lib/chat';
import { permissionLabel } from '../../lib/chat';

interface Props {
  permission: PermissionProfile;
  permissionLocked: boolean;
  onPermissionChange: (p: PermissionProfile) => void;
  onSend: (text: string) => void;
  busy: boolean;
  onInterrupt: () => void;
}

const PROFILES: PermissionProfile[] = ['full', 'vault-write', 'read-only'];

/** Minimal "Do anything" composer, styled after the reference. */
export function ChatInput({
  permission,
  permissionLocked,
  onPermissionChange,
  onSend,
  busy,
  onInterrupt,
}: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === '' || busy) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-sm focus-within:border-stone-300">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Do anything"
        className="block max-h-52 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm placeholder:text-stone-400 focus:outline-none"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2 pt-1 text-stone-500">
        <select
          value={permission}
          disabled={permissionLocked}
          onChange={(e) => onPermissionChange(e.target.value as PermissionProfile)}
          className="rounded-md px-1.5 py-1 text-xs hover:bg-stone-100 disabled:opacity-60"
          title={permissionLocked ? 'Permission is fixed for an active chat' : 'Permission profile for this chat'}
        >
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {permissionLabel(p)}
            </option>
          ))}
        </select>
        <div className="ml-auto" />
        {busy ? (
          <button
            onClick={onInterrupt}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200 text-stone-600 hover:bg-stone-300"
            title="Stop"
          >
            ◼
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={text.trim() === ''}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-white transition disabled:bg-stone-200 disabled:text-stone-400"
            title="Send"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
