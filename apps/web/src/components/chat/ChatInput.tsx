import { useLayoutEffect, useRef } from 'react';
import type { AgentEffort, AgentModel, PermissionProfile } from '../../lib/chat';
import { EFFORTS, permissionLabel } from '../../lib/chat';

interface Props {
  value: string;
  onChange: (text: string) => void;
  permission: PermissionProfile;
  onPermissionChange: (p: PermissionProfile) => void;
  models: AgentModel[];
  model: string;
  onModelChange: (id: string) => void;
  effort: AgentEffort;
  onEffortChange: (e: AgentEffort) => void;
  onSend: (text: string) => void;
  busy: boolean;
  onInterrupt: () => void;
}

const PROFILES: PermissionProfile[] = ['full', 'vault-write', 'read-only'];

const selectClass =
  'rounded-md px-1.5 py-1 text-xs font-medium hover:bg-active focus:outline-none';

/** Minimal "Do anything" composer; model / permission / reasoning are live-editable. */
export function ChatInput({
  value,
  onChange,
  permission,
  onPermissionChange,
  models,
  model,
  onModelChange,
  effort,
  onEffortChange,
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
      <div className="flex items-center gap-1 px-2.5 pb-2 pt-1 text-ghost">
        <select
          value={permission}
          onChange={(e) => onPermissionChange(e.target.value as PermissionProfile)}
          className={selectClass}
          title="Permission profile"
        >
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {permissionLabel(p)}
            </option>
          ))}
        </select>
        <div className="ml-auto" />
        <select
          value={effort}
          onChange={(e) => onEffortChange(e.target.value as AgentEffort)}
          className={selectClass}
          title="Reasoning effort"
        >
          {EFFORTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <select
          value={model}
          disabled={models.length === 0}
          onChange={(e) => onModelChange(e.target.value)}
          className={`${selectClass} disabled:opacity-60`}
          title="Model"
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
