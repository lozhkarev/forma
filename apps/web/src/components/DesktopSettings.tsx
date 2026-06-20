import { useEffect, useState } from 'react';
import { API_BASE } from '../api';
import { CREDENTIAL_KEYS, desktop } from '../lib/desktop';

const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none';

/** Wait for the restarted server to come back, then reload so all data re-fetches. */
async function reloadAfterRestart(setBusy: (s: string) => void) {
  setBusy('Restarting server…');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(`${API_BASE}/api/docs`);
      if (res.ok) break;
    } catch {
      /* server still down */
    }
  }
  window.location.reload();
}

/** Desktop-only credentials, stored in the OS keychain and passed to the agent. */
export function DesktopSettings() {
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    for (const { key } of CREDENTIAL_KEYS) {
      void desktop.credentialPresent(key).then((p) => setPresent((m) => ({ ...m, [key]: p })));
    }
  }, []);

  const saveCredentials = async () => {
    setError(null);
    try {
      const entries = Object.entries(values).filter(([, v]) => v.trim() !== '');
      for (const [key, value] of entries) await desktop.storeCredential(key, value.trim());
      await desktop.restartServer();
      await reloadAfterRestart(setBusy);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearCredential = async (key: string) => {
    setError(null);
    try {
      await desktop.storeCredential(key, '');
      await desktop.restartServer();
      await reloadAfterRestart(setBusy);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const dirty = Object.values(values).some((v) => v.trim() !== '');

  return (
    <section className="mb-10">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Credentials</h2>

      {busy && (
        <div className="mb-3 rounded-lg bg-accent-wash px-3 py-2 text-sm text-accent-strong">
          {busy}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
        <p className="mb-3 text-xs text-faintest">
          Stored securely in the OS keychain and passed to the agent. Leave a field blank to keep it
          unchanged. Falls back to environment / <span className="font-mono">~/.claude</span> when
          unset.
        </p>
        <div className="grid gap-2.5">
          {CREDENTIAL_KEYS.map(({ key, label, secret }) => (
            <div key={key} className="flex items-center gap-2">
              <label className="w-36 shrink-0 text-xs text-muted">{label}</label>
              <input
                type={secret ? 'password' : 'text'}
                value={values[key] ?? ''}
                onChange={(e) => setValues((m) => ({ ...m, [key]: e.target.value }))}
                placeholder={present[key] ? '•••••• (stored)' : 'not set'}
                className={inputClass}
              />
              {present[key] && (
                <button
                  onClick={() => clearCredential(key)}
                  disabled={!!busy}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-faintest hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3">
          <button
            onClick={saveCredentials}
            disabled={!!busy || !dirty}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-strong disabled:bg-line-strong"
          >
            Save &amp; restart
          </button>
        </div>
      </div>
    </section>
  );
}
