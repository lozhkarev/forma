import { Hono } from 'hono';
import type { SettingsService } from './settings.js';
import { VaultError } from './vault.js';

/** REST for workspace settings: MCP servers and skills. Mounted at /api/settings. */
export function createSettingsRoutes(settings: SettingsService): Hono {
  const app = new Hono();

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
