import os from 'node:os';
import path from 'node:path';

export const VAULT_ROOT = path.resolve(
  process.env.FORMA_VAULT ?? path.join(os.homedir(), 'FormaVault'),
);

export const PORT = Number(process.env.FORMA_PORT ?? 8787);
