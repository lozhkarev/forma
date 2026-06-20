import { useEffect, useState } from 'react';
import { api } from '../api';
import { desktop, isDesktop } from '../lib/desktop';

const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-mono focus:border-accent-border focus:outline-none';

/**
 * Switch the active vault. Works in both the browser and the desktop app: the
 * server re-inits all services for the new root at runtime (no process restart).
 * The desktop additionally persists the choice for the next launch and offers a
 * native folder picker.
 */
export function VaultSection() {
  const [current, setCurrent] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.vault.get().then(({ path }) => {
      setCurrent(path);
      setInput(path);
    });
  }, []);

  const switchTo = async (target: string) => {
    const path = target.trim();
    if (!path || path === current || busy) return;
    setError(null);
    setBusy(true);
    try {
      // Persist for the next desktop launch (the running server switches below).
      if (isDesktop) await desktop.rememberVault(path);
      await api.vault.switch(path);
      // The server swapped its workspace with no downtime — reload so every view
      // re-fetches and the event stream reconnects against the new vault.
      window.location.reload();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const browse = async () => {
    setError(null);
    try {
      const picked = await desktop.pickVault();
      if (picked) {
        setInput(picked);
        await switchTo(picked);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="mb-10">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Vault</h2>
      {error && (
        <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}
      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
        <div className="mb-1 text-sm font-medium">Active vault</div>
        <p className="mb-3 text-xs text-faintest">
          The folder Forma reads and writes. Switching re-indexes against the new location.
        </p>
        {isDesktop ? (
          <div className="flex items-center gap-3">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-chip px-3 py-1.5 text-xs text-muted">
              {current || '—'}
            </code>
            <button
              onClick={browse}
              disabled={busy}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-strong disabled:bg-line-strong"
            >
              {busy ? 'Switching…' : 'Choose folder…'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="/absolute/path/to/vault"
              className={inputClass}
            />
            <button
              onClick={() => switchTo(input)}
              disabled={busy || !input.trim() || input.trim() === current}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-strong disabled:bg-line-strong"
            >
              {busy ? 'Switching…' : 'Switch'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
