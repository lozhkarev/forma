import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { PermissionProfile } from '@forma/agent';
import { VaultError } from './vault.js';
import type { AgentRuntime } from './runtime.js';

interface CreateBody {
  permission?: PermissionProfile;
  contextDocPath?: string | null;
  model?: string;
  /** Reattach to an existing persisted chat instead of creating a new one. */
  resume?: string;
}

interface MessageBody {
  text: string;
}

interface PermissionBody {
  decision: 'allow' | 'deny';
}

export function createAgentRoutes(runtime: AgentRuntime): Hono {
  const app = new Hono();

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
      model: body.model,
    });
    return c.json(session.summary(), 201);
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
    const { text } = await c.req.json<MessageBody>();
    if (!text || text.trim() === '') throw new VaultError('text is required', 400);
    await session.postMessage(text);
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
