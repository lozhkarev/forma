import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TreeNode } from '@forma/core';
import { api } from '../api';

function collectFiles(node: TreeNode, acc: Array<{ name: string; path: string }>): void {
  for (const child of node.children ?? []) {
    if (child.type === 'file') acc.push({ name: child.name, path: child.path });
    else collectFiles(child, acc);
  }
}

export function ReportsPage() {
  const tree = useQuery({ queryKey: ['tree'], queryFn: api.tree });
  const reportsNode = tree.data?.children?.find((n) => n.type === 'dir' && n.path === 'reports');
  const files: Array<{ name: string; path: string }> = [];
  if (reportsNode) collectFiles(reportsNode, files);
  files.sort((a, b) => b.name.localeCompare(a.name));

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Reports</h1>

      {files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-faintest">
          No reports yet. Enable the <span className="font-medium">weekly-report</span> agent or run
          it from <Link to="/agents" className="underline hover:text-muted">Agents</Link>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line shadow-sm">
          {files.map((f) => (
            <Link
              key={f.path}
              to="/docs"
              search={{ path: f.path }}
              className="block border-b border-line-soft bg-surface px-4 py-3 last:border-0 hover:bg-surface-2"
            >
              <div className="font-medium">{f.name.replace(/\.md$/, '')}</div>
              <div className="truncate font-mono text-xs text-faintest">{f.path}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
