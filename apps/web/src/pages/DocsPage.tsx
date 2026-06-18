import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { Editor } from '../components/Editor';
import { FileTree } from '../components/FileTree';

const today = () => new Date().toISOString().slice(0, 10);

function NewDocForm({ onCreated }: { onCreated: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    let rel = path.trim();
    if (rel === '') return;
    if (!rel.endsWith('.md')) rel += '.md';
    // в местах для задач сразу создаём задачу
    const isTask = rel.startsWith('inbox/') || /^projects\/[^/]+\/tasks\//.test(rel);
    const frontmatter = isTask ? { status: 'todo', created: today() } : { created: today() };
    try {
      await api.createDoc(rel, frontmatter, '');
      setPath('');
      setOpen(false);
      setError(null);
      onCreated(rel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not create');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mx-2 mb-1 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-left text-sm text-muted hover:border-line-strong hover:text-body"
      >
        + New document
      </button>
    );
  }

  return (
    <div className="mx-2 mb-1 flex flex-col gap-1">
      <input
        autoFocus
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="wiki/new-page.md"
        className="rounded-lg border border-line-strong px-2 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none"
      />
      {error && <div className="text-xs text-rose-600">{error}</div>}
      <div className="text-[10px] text-faintest">Enter to create, Esc to cancel</div>
    </div>
  );
}

export function DocsPage() {
  const { path } = useSearch({ from: '/docs' });
  const navigate = useNavigate();
  const tree = useQuery({ queryKey: ['tree'], queryFn: api.tree });
  const doc = useQuery({
    queryKey: ['doc', path],
    queryFn: () => api.doc(path!),
    enabled: Boolean(path),
  });

  const select = (p: string) => void navigate({ to: '/docs', search: { path: p } });

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col overflow-auto border-r border-line bg-surface-2/50 py-2">
        <NewDocForm onCreated={select} />
        {tree.data && <FileTree node={tree.data} selected={path} onSelect={select} />}
      </div>
      <div className="min-w-0 flex-1">
        {!path && (
          <div className="flex h-full items-center justify-center text-sm text-faintest">
            Select a document on the left or create a new one
          </div>
        )}
        {path && doc.isError && (
          <div className="flex h-full items-center justify-center text-sm text-rose-500">
            Could not open {path}
          </div>
        )}
        {path && doc.data && (
          <Editor
            key={path}
            doc={doc.data}
            onDeleted={() => void navigate({ to: '/docs', search: {} })}
          />
        )}
      </div>
    </div>
  );
}
