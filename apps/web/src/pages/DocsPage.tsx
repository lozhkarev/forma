import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, isConflict } from '../api';
import { FileTree } from '../components/FileTree';
import { WorkbenchGroup } from '../components/workbench/WorkbenchGroup';
import { useChat } from '../components/chat/ChatProvider';

const today = () => new Date().toISOString().slice(0, 10);
const TAB_MIME = 'text/forma-tab';

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
  const wb = useChat();
  // null = the "+ New document" button; a string = create form seeded with a dir.
  const [seed, setSeed] = useState<string | null>(null);
  const [splitHot, setSplitHot] = useState(false);

  const refreshTree = () => void queryClient.invalidateQueries({ queryKey: ['tree'] });

  // The document highlighted in the tree = the active group's active doc tab.
  const activeGroup = wb.groups.find((g) => g.id === wb.activeGroupId);
  const activeTab = activeGroup?.activeTabId ? wb.tabs[activeGroup.activeTabId] : null;
  const selectedPath = activeTab?.kind === 'doc' ? activeTab.path : undefined;

  const select = (p: string) => {
    wb.openDoc(p);
    void navigate({ to: '/docs', search: { path: p } });
  };

  // Deep links / search box (?path=…) open the document in the workbench.
  useEffect(() => {
    if (path) wb.openDoc(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const move = async (from: string, to: string) => {
    let dest = to.trim();
    if (!dest.endsWith('.md')) dest += '.md';
    if (dest === from) return;
    try {
      await api.moveDoc(from, dest);
      refreshTree();
      wb.renameDoc(from, dest);
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
    wb.closeDocTabs(target);
  };

  const hasAnyTab = wb.groups.some((g) => g.tabIds.length > 0);

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
            selected={selectedPath}
            onSelect={select}
            onMove={move}
            onDelete={remove}
            onCreateIn={setSeed}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1">
        {!hasAnyTab ? (
          <div className="flex flex-1 items-center justify-center text-sm text-faintest">
            Select a document on the left, or start a chat with the agent
          </div>
        ) : (
          <>
            {wb.groups.map((g) => (
              <WorkbenchGroup key={g.id} group={g} isActiveGroup={g.id === wb.activeGroupId} />
            ))}
            {/* Drop a tab here to open it in a new split group. */}
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(TAB_MIME)) {
                  e.preventDefault();
                  setSplitHot(true);
                }
              }}
              onDragLeave={() => setSplitHot(false)}
              onDrop={(e) => {
                setSplitHot(false);
                const id = e.dataTransfer.getData(TAB_MIME);
                if (id) wb.dropToNewGroup(id);
              }}
              className={splitHot ? 'w-16 shrink-0 bg-accent-soft' : 'w-2 shrink-0'}
            />
          </>
        )}
      </div>
    </div>
  );
}
