import os from 'node:os';
import path from 'node:path';

export const VAULT_ROOT = path.resolve(
  process.env.FORMA_VAULT ?? path.join(os.homedir(), 'FormaVault'),
);

export const PORT = Number(process.env.FORMA_PORT ?? 8787);

/** Model for agent chat sessions. A concrete id is safer than relying on the
 *  SDK/gateway default. Override per deployment. */
export const AGENT_MODEL = process.env.FORMA_AGENT_MODEL ?? 'claude-sonnet-4-6';

/** Max number of sessions running a turn at the same time. */
export const MAX_CONCURRENT_TURNS = Number(process.env.FORMA_MAX_CONCURRENT ?? 2);

/** Per-turn safety budgets. */
export const DEFAULT_MAX_TURNS = Number(process.env.FORMA_MAX_TURNS ?? 40);
export const DEFAULT_MAX_COST_USD = Number(process.env.FORMA_MAX_COST_USD ?? 1.0);
