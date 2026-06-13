/**
 * Loads credentials/config into process.env at startup so `npm run dev` works
 * without manual exports. Precedence (highest first):
 *   1. variables already in the environment (e.g. injected by Claude Code)
 *   2. repo-root `.env`
 *   3. Claude Code's `~/.claude/settings.json` `env` block (gateway fallback)
 *
 * Imported for its side effect — must run before config.ts reads process.env.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function setIfMissing(key: string, value: unknown): void {
  if (typeof value === 'string' && value !== '' && process.env[key] === undefined) {
    process.env[key] = value;
  }
}

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    setIfMissing(key, value);
  }
}

/** Reuse Claude Code's gateway/API credentials if nothing else provided them. */
function loadClaudeSettings(): void {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return;
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const env = (JSON.parse(readFileSync(settingsPath, 'utf8')).env ?? {}) as Record<string, unknown>;
    let used = false;
    for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
      if (typeof env[key] === 'string' && process.env[key] === undefined) {
        process.env[key] = env[key] as string;
        used = true;
      }
    }
    if (used) console.log('[forma] using Claude Code credentials from ~/.claude/settings.json');
  } catch {
    // no Claude Code settings — fine, user can use .env or real env vars
  }
}

loadDotEnv(path.join(REPO_ROOT, '.env'));
loadClaudeSettings();
