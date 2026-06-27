import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { api, isConflict } from '../api';
import { Editor } from '../components/Editor';
import { FileTree } from '../components/FileTree';

const today = () => new Date().toISOString().slice(0, 10);
const OPEN_DOCS_KEY = 'forma:openDocs';
const baseName = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '');

function loadOpenDocs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_DOCS_KEY) ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** One open document: keeps its own editor mounted (hidden when not active) so
 *  unsaved edits and scroll survive tab switches. */
function DocTab({
  path,
  active,
  onDeleted,
  onDirty,
}: {
  path: string;
  active: boolean;
  onDeleted: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const doc = useQuery({ queryKey: ['doc', path], queryFn: () => api.doc(path) });
  return (
    <div className={active ? 'h-full' : 'hidden'}>
      {doc.isError && (
        <div className="flex h-full items-center justify-center text-sm text-rose-500">
          Could not open {path}
        </div>
      )}
      {doc.data && (
        <Editor key={path} doc={doc.data} onDeleted={onDeleted} onDirtyChange={onDirty} />
      )}
    </div>
  );
}

function NewDocForm({
  initialPath = '',
  autoOpen = false,
  onCreated,
}: {
  initialPath?: string;
  autoOpen?: boolean;
  onCreated: (path: string) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    let rel = path.trim();
    if (rel === '' || rel.endsWith('/')) return;
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
  const queryClient = useQueryClient();
  const tree = useQuery({ queryKey: ['tree'], queryFn: api.tree });
  // null = the "+ New document" button; a string = create form seeded with a dir.
  const [seed, setSeed] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>(loadOpenDocs);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const select = (p: string) => void navigate({ to: '/docs', search: { path: p } });
  const refreshTree = () => void queryClient.invalidateQueries({ queryKey: ['tree'] });

  useEffect(() => {
    localStorage.setItem(OPEN_DOCS_KEY, JSON.stringify(openPaths));
  }, [openPaths]);

  // The active document is always an open tab.
  useEffect(() => {
    if (path && !openPaths.includes(path)) setOpenPaths((o) => [...o, path]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Reopen the last tab on load when the URL has no document.
  useEffect(() => {
    if (!path && openPaths.length > 0) select(openPaths[openPaths.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDirtyFor = (p: string, d: boolean) =>
    setDirty((m) => (m[p] === d ? m : { ...m, [p]: d }));

  const closeTab = (p: string) => {
    setOpenPaths((o) => {
      const idx = o.indexOf(p);
      const next = o.filter((x) => x !== p);
      if (p === path) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        void navigate({ to: '/docs', search: fallback ? { path: fallback } : {} });
      }
      return next;
    });
    setDirty((m) => {
      const { [p]: _drop, ...rest } = m;
      return rest;
    });
  };

  const move = async (from: string, to: string) => {
    let dest = to.trim();
    if (!dest.endsWith('.md')) dest += '.md';
    if (dest === from) return;
    try {
      await api.moveDoc(from, dest);
      refreshTree();
      setOpenPaths((o) => o.map((x) => (x === from ? dest : x)));
      if (path === from) select(dest);
    } catch (e) {
      window.alert(
        isConflict(e) ? `A document already exists at ${dest}` : `Could not move: ${(e as Error).message}`,
      );
    }
  };

  const remove = async (target: string) => {
    if (!window.confirm(`Delete ${target}?`)) return;
    await api.deleteDoc(target);
    refreshTree();
    closeTab(target);
  };

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col overflow-auto border-r border-line bg-surface-2/50 py-2">
        <NewDocForm
          key={seed ?? 'new'}
          initialPath={seed ? `${seed}/` : ''}
          autoOpen={seed !== null}
          onCreated={(p) => {
            setSeed(null);
            refreshTree();
            select(p);
          }}
        />
        {tree.data && (
          <FileTree
            node={tree.data}
            selected={path}
            onSelect={select}
            onMove={move}
            onDelete={remove}
            onCreateIn={setSeed}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {openPaths.length > 0 && (
          <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface-2/40">
            {openPaths.map((p) => (
              <div
                key={p}
                onClick={() => select(p)}
                onAuxClick={(e) => e.button === 1 && closeTab(p)}
                className={clsx(
                  'group flex cursor-pointer items-center gap-1.5 border-r border-line px-3 py-1.5 text-xs',
                  p === path ? 'bg-surface text-ink-strong' : 'text-muted hover:bg-active/50',
                )}
                title={p}
              >
                <span className="max-w-[12rem] truncate">{baseName(p)}</span>
                {dirty[p] ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(p);
                  }}
                  className="ml-0.5 shrink-0 rounded px-0.5 text-faintest opacity-0 hover:bg-line-strong hover:text-body group-hover:opacity-100"
                  title="Close"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {!path && (
            <div className="flex h-full items-center justify-center text-sm text-faintest">
              Select a document on the left or create a new one
            </div>
          )}
          {openPaths.map((p) => (
            <DocTab
              key={p}
              path={p}
              active={p === path}
              onDeleted={() => {
                refreshTree();
                closeTab(p);
              }}
              onDirty={(d) => setDirtyFor(p, d)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
