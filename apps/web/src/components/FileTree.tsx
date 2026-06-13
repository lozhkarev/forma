import clsx from 'clsx';
import { useState } from 'react';
import type { TreeNode } from '@forma/core';

interface Props {
  node: TreeNode;
  selected?: string;
  onSelect: (path: string) => void;
  depth?: number;
}

function NodeRow({ node, selected, onSelect, depth = 0 }: Props) {
  // верхние каталоги раскрыты по умолчанию
  const [open, setOpen] = useState(depth < 1);

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm text-stone-600 hover:bg-stone-100"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className={clsx('text-[10px] transition-transform', open && 'rotate-90')}>▶</span>
          <span className="font-medium">{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <NodeRow key={child.path} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
          ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={clsx(
        'block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-stone-100',
        selected === node.path ? 'bg-stone-200/70 font-medium text-stone-900' : 'text-stone-600',
      )}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
      title={node.path}
    >
      {node.name.replace(/\.md$/, '')}
    </button>
  );
}

export function FileTree({ node, selected, onSelect }: Omit<Props, 'depth'>) {
  return (
    <div className="py-1">
      {node.children?.map((child) => (
        <NodeRow key={child.path} node={child} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}
