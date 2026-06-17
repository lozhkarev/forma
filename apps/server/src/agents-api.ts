import { Hono } from 'hono';
import type { AgentService } from './agents.js';
import type { Scheduler } from './scheduler.js';
import { VaultError } from './vault.js';

interface PatchBody {
  enabled?: boolean;
}

/** REST for custom agents: definitions and runs. Mounted at /api/agents. */
export function createAgentDefRoutes(agents: AgentService, scheduler: Scheduler): Hono {
  const app = new Hono();

  // List definitions enriched with live state (running) and next cron run.
  app.get('/', async (c) => {
    const defs = await agents.listDefinitions();
    const nextRuns = new Map(scheduler.list().map((j) => [j.name, j.nextRun]));
    return c.json(
      defs.map((def) => ({
        ...def,
        running: agents.isRunning(def.name),
        nextRun: nextRuns.get(def.name) ?? null,
      })),
    );
  });

  app.get('/:name', async (c) => {
    const name = c.req.param('name');
    const def = await agents.getDefinition(name);
    if (!def) throw new VaultError(`agent not found: ${name}`, 404);
    return c.json(def);
  });

  app.patch('/:name', async (c) => {
    const body = await c.req.json<PatchBody>().catch(() => ({}) as PatchBody);
    if (typeof body.enabled !== 'boolean') throw new VaultError('enabled (boolean) is required', 400);
    return c.json(await agents.setEnabled(c.req.param('name'), body.enabled));
  });

  app.get('/:name/runs', async (c) => c.json(await agents.listRuns(c.req.param('name'))));

  app.get('/:name/runs/:runId', async (c) => {
    const run = await agents.getRun(c.req.param('name'), c.req.param('runId'));
    if (!run) throw new VaultError('run not found', 404);
    return c.json(run);
  });

  app.post('/:name/run', async (c) => {
    const run = await agents.startRun(c.req.param('name'), 'manual');
    return c.json(run, 202);
  });

  // Webhook for external systems: POST the payload to fire the agent.
  app.post('/:name/hook', async (c) => {
    const body = await c.req.json().catch(() => null);
    const context = body != null ? `(Webhook payload:\n${JSON.stringify(body, null, 2)})` : undefined;
    const run = await agents.startRun(c.req.param('name'), 'event', context);
    return c.json(run, 202);
  });

  return app;
}
