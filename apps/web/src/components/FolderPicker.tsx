import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/**
 * In-app folder browser backed by the server's filesystem endpoints. Used to
 * choose a vault consistently in the browser and the desktop app (a browser
 * can't return a real path from a native dialog).
 */
export function FolderPicker({ initialPath, onSelect, onClose }: Props) {
  const [cwd, setCwd] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState('');

  const load = async (path?: string) => {
    setError(null);
    try {
      const res = await api.fs.dirs(path);
      setCwd(res.path);
      setParent(res.parent);
      setDirs(res.dirs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createFolder = async () => {
    const name = creating.trim();
    if (!name) return;
    try {
      const { path } = await api.fs.mkdir(cwd, name);
      setCreating('');
      await load(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[34rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-4 py-3">
          <div className="text-sm font-semibold">Choose a folder</div>
          <code className="mt-0.5 block truncate text-xs text-muted">{cwd || '…'}</code>
        </div>

        {error && (
          <div className="bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {parent && (
            <button
              onClick={() => void load(parent)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted hover:bg-active"
            >
              <span className="text-faintest">↑</span> ..
            </button>
          )}
          {dirs.map((d) => (
            <button
              key={d.path}
              onClick={() => void load(d.path)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-active"
            >
              <span className="text-faintest">📁</span>
              <span className="truncate">{d.name}</span>
            </button>
          ))}
          {dirs.length === 0 && (
            <div className="px-2.5 py-6 text-center text-xs text-faintest">No subfolders here.</div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <input
            value={creating}
            onChange={(e) => setCreating(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createFolder()}
            placeholder="New folder name…"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-accent-border focus:outline-none"
          />
          <button
            onClick={() => void createFolder()}
            disabled={!creating.trim()}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-active disabled:opacity-40"
          >
            Create
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-active">
            Cancel
          </button>
          <button
            onClick={() => onSelect(cwd)}
            disabled={!cwd}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-strong disabled:bg-line-strong"
          >
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
