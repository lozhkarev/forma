import { Hono } from 'hono';
import type { GitService } from './git.js';
import type { Prefs, SettingsService } from './settings.js';
import { VaultError } from './vault.js';

/** REST for workspace settings: MCP servers, skills, prefs. Mounted at /api/settings. */
export function createSettingsRoutes(settings: SettingsService, git: GitService): Hono {
  const app = new Hono();

  app.get('/prefs', async (c) => c.json(await settings.readPrefs()));

  app.patch('/prefs', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<Prefs>;
    const prefs = await settings.writePrefs(body);
    // Apply the git toggle live (no restart needed).
    if (typeof body.gitAutocommit === 'boolean') await git.setEnabled(body.gitAutocommit);
    return c.json(prefs);
  });

  app.get('/mcp', async (c) => c.json(await settings.readMcp()));

  app.put('/mcp/:name', async (c) => {
    const config = await c.req.json().catch(() => null);
    if (!config || typeof config !== 'object') {
      throw new VaultError('server config (object) is required', 400);
    }
    return c.json(await settings.putServer(c.req.param('name'), config));
  });

  app.delete('/mcp/:name', async (c) => c.json(await settings.deleteServer(c.req.param('name'))));

  app.get('/skills', async (c) => c.json(await settings.listSkills()));

  return app;
}
