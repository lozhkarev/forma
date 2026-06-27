import clsx from 'clsx';
import { describeTool, type ChatItem } from '../../lib/chat';
import { MarkdownView } from '../MarkdownView';

interface Props {
  items: ChatItem[];
  resolvedPermissions: Set<string>;
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void;
  thinking: boolean;
  /** A reply is still streaming — render the last assistant block as plain
   *  text (avoids re-parsing markdown on every token); markdown once settled. */
  streaming: boolean;
  /** Show the turns/cost detail on the result line (pref, off by default). */
  showResultMeta: boolean;
}

function AgentAvatar() {
  return (
    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-accent-soft">
      <span className="h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-faint">
      <span
        className={clsx(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          !item.done ? 'animate-pulse bg-amber-400' : item.isError ? 'bg-rose-400' : 'bg-accent',
        )}
      />
      <span className="truncate">{describeTool(item.name, item.input)}</span>
    </div>
  );
}

function PermissionCard({
  item,
  resolved,
  onPermission,
}: {
  item: Extract<ChatItem, { kind: 'permission' }>;
  resolved: boolean;
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void;
}) {
  const cmd = (item.input as { command?: string } | null)?.command;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <div className="mb-1 font-medium text-amber-900">
        Agent wants to use <span className="font-mono">{item.tool}</span>
      </div>
      {cmd && <div className="mb-2 truncate rounded bg-amber-100 px-2 py-1 font-mono text-xs">{cmd}</div>}
      {resolved ? (
        <div className="text-xs text-faint">Responded.</div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onPermission(item.requestId, 'allow')}
            className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-strong"
          >
            Allow
          </button>
          <button
            onClick={() => onPermission(item.requestId, 'deny')}
            className="rounded-lg border border-line-strong px-3 py-1 text-xs text-muted hover:bg-active"
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatMessages({
  items,
  resolvedPermissions,
  onPermission,
  thinking,
  streaming,
  showResultMeta,
}: Props) {
  const lastIdx = items.length - 1;
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, i) => {
        switch (item.kind) {
          case 'user':
            return (
              <div
                key={item.key}
                className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] bg-accent px-3.5 py-2 text-sm leading-relaxed text-white"
              >
                {item.text}
              </div>
            );
          case 'assistant': {
            const live = streaming && i === lastIdx;
            return (
              <div key={item.key} className="flex items-start gap-2.5">
                <AgentAvatar />
                {live ? (
                  <div className="flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-strong">
                    {item.text}
                  </div>
                ) : (
                  <MarkdownView
                    markdown={item.text}
                    className="prose prose-sm prose-stone max-w-none flex-1 text-ink-strong"
                  />
                )}
              </div>
            );
          }
          case 'tool':
            return <ToolRow key={item.key} item={item} />;
          case 'permission':
            return (
              <PermissionCard
                key={item.key}
                item={item}
                // Only the latest request is actionable; replayed history is settled.
                resolved={resolvedPermissions.has(item.requestId) || i !== lastIdx}
                onPermission={onPermission}
              />
            );
          case 'result':
            return (
              <div key={item.key} className="flex items-center gap-2 text-[11px] text-faintest">
                <span className="h-px flex-1 bg-line" />
                {item.ok ? 'done' : 'stopped'}
                {showResultMeta && (
                  <>
                    {' · '}
                    {item.turns} turns
                    {item.costUsd != null && ` · $${item.costUsd.toFixed(3)}`}
                  </>
                )}
                <span className="h-px flex-1 bg-line" />
              </div>
            );
          case 'error':
            return (
              <div key={item.key} className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {item.text}
              </div>
            );
        }
      })}
      {thinking && (
        <div className="flex items-center gap-2.5">
          <AgentAvatar />
          <div className="flex items-center gap-1 px-1 py-1.5 text-xs text-faintest">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ghost [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ghost [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ghost" />
          </div>
        </div>
      )}
    </div>
  );
}
