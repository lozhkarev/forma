import { invoke } from '@tauri-apps/api/core';

/** True when running inside the Tauri desktop shell (vs. the browser dev app). */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Keychain credential keys (must match CREDENTIAL_KEYS in src-tauri/src/lib.rs). */
export const CREDENTIAL_KEYS = [
  { key: 'anthropic_base_url', label: 'Anthropic base URL', secret: false },
  { key: 'anthropic_auth_token', label: 'Auth token', secret: true },
  { key: 'anthropic_api_key', label: 'API key', secret: true },
] as const;

/**
 * Thin wrappers over the desktop shell's Tauri commands. Only call these when
 * `isDesktop` is true — `invoke` throws in the browser.
 */
export const desktop = {
  getVault: () => invoke<string>('get_vault'),
  pickVault: () => invoke<string | null>('pick_vault'),
  setVault: (path: string) => invoke<void>('set_vault', { path }),
  restartServer: () => invoke<void>('restart_server'),
  storeCredential: (key: string, value: string) =>
    invoke<void>('store_credential', { key, value }),
  credentialPresent: (key: string) => invoke<boolean>('credential_present', { key }),
};
