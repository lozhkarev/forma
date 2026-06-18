import { useLayoutEffect, useRef } from 'react';
import type { AgentModel, PermissionProfile } from '../../lib/chat';
import { permissionLabel } from '../../lib/chat';

interface Props {
  value: string;
  onChange: (text: string) => void;
  permission: PermissionProfile;
  permissionLocked: boolean;
  onPermissionChange: (p: PermissionProfile) => void;
  models: AgentModel[];
  model: string;
  modelLocked: boolean;
  onModelChange: (id: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  onInterrupt: () => void;
}

const PROFILES: PermissionProfile[] = ['full', 'vault-write', 'read-only'];

/** Minimal "Do anything" composer, styled after the reference. */
export function ChatInput({
  value,
  onChange,
  permission,
  permissionLocked,
  onPermissionChange,
  models,
  model,
  modelLocked,
  onModelChange,
  onSend,
  busy,
  onInterrupt,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed === '' || busy) return;
    onSend(trimmed);
    onChange('');
  };

  return (
    <div className="rounded-[18px] border border-line-strong bg-surface shadow-[var(--shadow-composer)] focus-within:border-accent-border">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask Forma AI…"
        className="block max-h-52 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm text-body placeholder:text-faintest focus:outline-none"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2 pt-1 text-ghost">
        <select
          value={permission}
          disabled={permissionLocked}
          onChange={(e) => onPermissionChange(e.target.value as PermissionProfile)}
          className="rounded-md px-1.5 py-1 text-xs font-medium hover:bg-active disabled:opacity-60"
          title={permissionLocked ? 'Permission is fixed for an active chat' : 'Permission profile for this chat'}
        >
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {permissionLabel(p)}
            </option>
          ))}
        </select>
        <div className="ml-auto" />
        <select
          value={model}
          disabled={modelLocked || models.length === 0}
          onChange={(e) => onModelChange(e.target.value)}
          className="rounded-md px-1.5 py-1 text-xs font-medium hover:bg-active disabled:opacity-60"
          title={modelLocked ? 'Model is fixed for an active chat' : 'Model for this chat'}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {busy ? (
          <button
            onClick={onInterrupt}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-chip text-muted hover:bg-active"
            title="Stop"
          >
            ◼
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={value.trim() === ''}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-[var(--shadow-accent)] transition hover:bg-accent-strong disabled:bg-line-strong disabled:text-ghost disabled:shadow-none"
            title="Send"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
