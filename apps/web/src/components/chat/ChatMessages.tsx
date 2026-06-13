import clsx from 'clsx';
import { describeTool, type ChatItem } from '../../lib/chat';

interface Props {
  items: ChatItem[];
  resolvedPermissions: Set<string>;
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void;
  thinking: boolean;
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-stone-500">
      <span
        className={clsx(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          !item.done ? 'animate-pulse bg-amber-400' : item.isError ? 'bg-rose-400' : 'bg-emerald-400',
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
        <div className="text-xs text-stone-500">Responded.</div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onPermission(item.requestId, 'allow')}
            className="rounded-lg bg-stone-900 px-3 py-1 text-xs text-white hover:bg-stone-700"
          >
            Allow
          </button>
          <button
            onClick={() => onPermission(item.requestId, 'deny')}
            className="rounded-lg border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100"
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatMessages({ items, resolvedPermissions, onPermission, thinking }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.key} className="self-end max-w-[85%] rounded-2xl bg-stone-900 px-3.5 py-2 text-sm text-white">
                <div className="whitespace-pre-wrap break-words">{item.text}</div>
              </div>
            );
          case 'assistant':
            return (
              <div key={item.key} className="max-w-[92%] whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-800">
                {item.text}
              </div>
            );
          case 'tool':
            return <ToolRow key={item.key} item={item} />;
          case 'permission':
            return (
              <PermissionCard
                key={item.key}
                item={item}
                resolved={resolvedPermissions.has(item.requestId)}
                onPermission={onPermission}
              />
            );
          case 'result':
            return (
              <div key={item.key} className="flex items-center gap-2 text-[11px] text-stone-400">
                <span className="h-px flex-1 bg-stone-100" />
                {item.ok ? 'done' : 'stopped'} · {item.turns} turns
                {item.costUsd != null && ` · $${item.costUsd.toFixed(3)}`}
                <span className="h-px flex-1 bg-stone-100" />
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
        <div className="flex items-center gap-1 px-1 text-xs text-stone-400">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-300 [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-300 [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-300" />
        </div>
      )}
    </div>
  );
}
