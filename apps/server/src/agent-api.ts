import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentEffort, PermissionProfile } from '@forma/agent';
import { AGENT_MODEL } from './config.js';
import { modelsWithDefault } from './models.js';
import { VaultError } from './vault.js';
import type { AgentRuntime } from './runtime.js';

interface CreateBody {
  permission?: PermissionProfile;
  contextDocPath?: string | null;
  /** A selected fragment to give the agent as context on the first message. */
  contextSelection?: string;
  model?: string;
  effort?: AgentEffort;
  /** Reattach to an existing persisted chat instead of creating a new one. */
  resume?: string;
}

interface UpdateBody {
  model?: string;
  permission?: PermissionProfile;
  effort?: AgentEffort;
}

interface MessageBody {
  text: string;
  /** Extra context to prepend for this message only (agent-visible, not shown). */
  context?: string;
}

interface PermissionBody {
  decision: 'allow' | 'deny';
}

export function createAgentRoutes(runtime: AgentRuntime): Hono {
  const app = new Hono();

  app.get('/models', (c) => c.json(modelsWithDefault(AGENT_MODEL)));

  app.get('/sessions', async (c) => c.json(await runtime.listSessions()));

  app.post('/sessions', async (c) => {
    const body = await c.req.json<CreateBody>().catch(() => ({}) as CreateBody);
    if (body.resume) {
      const resumed = await runtime.resumeSession(body.resume);
      if (!resumed) throw new VaultError(`chat not found: ${body.resume}`, 404);
      return c.json(resumed.summary(), 200);
    }
    const session = await runtime.createSession({
      permission: body.permission,
      contextDocPath: body.contextDocPath,
      contextSelection: body.contextSelection,
      model: body.model,
      effort: body.effort,
    });
    return c.json(session.summary(), 201);
  });

  // Change model / permission / reasoning effort on a live session.
  app.patch('/sessions/:id', async (c) => {
    const session = runtime.get(c.req.param('id'));
    if (!session) throw new VaultError('session is not live; resume it first', 409);
    const body = await c.req.json<UpdateBody>().catch(() => ({}) as UpdateBody);
    if (body.permission) session.setPermission(body.permission);
    if (body.effort) await session.setEffort(body.effort);
    if (body.model) await session.setModel(body.model);
    return c.json(session.summary());
  });

  app.get('/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const transcript = await runtime.loadTranscript(id);
    if (transcript === null) throw new VaultError(`chat not found: ${id}`, 404);
    const summary = runtime.get(id)?.summary() ?? (await runtime.listSessions()).find((s) => s.id === id);
    return c.json({ summary, transcript });
  });

  app.post('/sessions/:id/messages', async (c) => {
    const session = runtime.get(c.req.param('id'));
    if (!session) throw new VaultError('session is not live; resume it first', 409);
    const { text, context } = await c.req.json<MessageBody>();
    if (!text || text.trim() === '') throw new VaultError('text is required', 400);
    await session.postMessage(text, context);
    return c.json({ ok: true }, 202);
  });

  app.post('/sessions/:id/permissions/:reqId', async (c) => {
    const session = runtime.get(c.req.param('id'));
    if (!session) throw new VaultError('session is not live', 409);
    const { decision } = await c.req.json<PermissionBody>();
    if (decision !== 'allow' && decision !== 'deny') throw new VaultError('decision must be allow|deny', 400);
    session.resolvePermission(c.req.param('reqId'), decision);
    return c.json({ ok: true });
  });

  app.post('/sessions/:id/interrupt', async (c) => {
    const session = runtime.get(c.req.param('id'));
    if (!session) throw new VaultError('session is not live', 409);
    await session.interrupt();
    return c.json({ ok: true });
  });

  app.post('/sessions/:id/summarize', async (c) => {
    const outcome = await runtime.summarizeSession(c.req.param('id'), true);
    return c.json({ ok: outcome?.ok ?? false, skipped: outcome === null });
  });

  app.get('/sessions/:id/stream', (c) => {
    const session = runtime.get(c.req.param('id'));
    if (!session) throw new VaultError('session is not live; resume it first', 409);
    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      for await (const record of session.events(ac.signal)) {
        await stream.writeSSE({ event: 'record', data: JSON.stringify(record) });
      }
    });
  });

  return app;
}
