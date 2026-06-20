import clsx from 'clsx';
import { useState } from 'react';
import type { TreeNode } from '@forma/core';

interface Ctx {
  selected?: string;
  onSelect: (path: string) => void;
  renaming: string | null;
  setRenaming: (path: string | null) => void;
  onMove: (from: string, to: string) => void;
  onDelete: (path: string) => void;
  onCreateIn: (dir: string) => void;
  openMenu: (e: React.MouseEvent, node: TreeNode) => void;
}

function RenameInput({
  initial,
  depth,
  onSubmit,
  onCancel,
}: {
  initial: string;
  depth: number;
  onSubmit: (to: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const to = value.trim();
          if (to && to !== initial) onSubmit(to);
          else onCancel();
        }
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={onCancel}
      className="my-0.5 w-[calc(100%-1rem)] rounded border border-accent-border bg-surface px-1.5 py-1 font-mono text-xs focus:outline-none"
      style={{ marginLeft: `${depth * 12 + 8}px` }}
    />
  );
}

function NodeRow({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: Ctx }) {
  const [open, setOpen] = useState(depth < 1);

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          onContextMenu={(e) => ctx.openMenu(e, node)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm text-muted hover:bg-active"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className={clsx('text-[10px] transition-transform', open && 'rotate-90')}>▶</span>
          <span className="font-medium">{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <NodeRow key={child.path} node={child} depth={depth + 1} ctx={ctx} />
          ))}
      </div>
    );
  }

  if (ctx.renaming === node.path) {
    return (
      <RenameInput
        initial={node.path}
        depth={depth}
        onSubmit={(to) => {
          ctx.setRenaming(null);
          ctx.onMove(node.path, to);
        }}
        onCancel={() => ctx.setRenaming(null)}
      />
    );
  }

  return (
    <button
      onClick={() => ctx.onSelect(node.path)}
      onContextMenu={(e) => ctx.openMenu(e, node)}
      className={clsx(
        'block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-active',
        ctx.selected === node.path ? 'bg-line-strong/70 font-medium text-ink' : 'text-muted',
      )}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
      title={node.path}
    >
      {node.name.replace(/\.md$/, '')}
    </button>
  );
}

type Props = {
  node: TreeNode;
  selected?: string;
  onSelect: (path: string) => void;
  onMove: (from: string, to: string) => void;
  onDelete: (path: string) => void;
  onCreateIn: (dir: string) => void;
};

const menuItem = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-active';

export function FileTree({ node, selected, onSelect, onMove, onDelete, onCreateIn }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);

  const ctx: Ctx = {
    selected,
    onSelect,
    renaming,
    setRenaming,
    onMove,
    onDelete,
    onCreateIn,
    openMenu: (e, n) => {
      e.preventDefault();
      setMenu({ node: n, x: e.clientX, y: e.clientY });
    },
  };

  return (
    <div className="py-1">
      {node.children?.map((child) => (
        <NodeRow key={child.path} node={child} depth={0} ctx={ctx} />
      ))}

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-40 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-pop)]"
            style={{ top: menu.y, left: menu.x }}
          >
            {menu.node.type === 'file' ? (
              <>
                <button
                  className={menuItem}
                  onClick={() => {
                    setRenaming(menu.node.path);
                    setMenu(null);
                  }}
                >
                  Rename / move…
                </button>
                <button
                  className={`${menuItem} text-rose-600`}
                  onClick={() => {
                    const p = menu.node.path;
                    setMenu(null);
                    onDelete(p);
                  }}
                >
                  Delete
                </button>
              </>
            ) : (
              <button
                className={menuItem}
                onClick={() => {
                  const dir = menu.node.path;
                  setMenu(null);
                  onCreateIn(dir);
                }}
              >
                New document here
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
