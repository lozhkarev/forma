import './env.js'; // must run before config.js reads process.env
import fs from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { AgentService } from './agents.js';
import { createApi, type VaultController } from './api.js';
import {
  AGENT_MODEL,
  DEFAULT_MAX_COST_USD,
  DEFAULT_MAX_TURNS,
  MAX_CONCURRENT_TURNS,
  PORT,
  VAULT_ROOT,
} from './config.js';
import type { VaultEvent } from '@forma/core';
import { EventTrigger } from './event-trigger.js';
import { IndexService } from './indexer.js';
import { AgentRuntime } from './runtime.js';
import { Scheduler } from './scheduler.js';
import { SettingsService } from './settings.js';
import { VaultService } from './vault.js';
import type { Hono } from 'hono';

/** All per-vault services + the HTTP app bound to them. Rebuilt on vault switch. */
interface Workspace {
  root: string;
  indexer: IndexService;
  runtime: AgentRuntime;
  scheduler: Scheduler;
  eventTrigger: EventTrigger;
  app: Hono;
}

async function buildWorkspace(root: string, controller: VaultController): Promise<Workspace> {
  const vault = new VaultService(root);
  await vault.init();

  const indexer = new IndexService(vault);
  const indexed = await indexer.reindexAll();
  console.log(`[forma] индекс: ${indexed} документов (${root})`);
  indexer.startWatcher();

  const runtime = new AgentRuntime(root, {
    model: AGENT_MODEL,
    maxConcurrentTurns: MAX_CONCURRENT_TURNS,
    maxTurns: DEFAULT_MAX_TURNS,
    maxCostUsd: DEFAULT_MAX_COST_USD,
  });

  const agents = new AgentService(vault, runtime);

  const scheduler = new Scheduler(agents);
  await scheduler.start();

  const eventTrigger = new EventTrigger(agents);
  await eventTrigger.start();

  indexer.on('vault', (event: VaultEvent) => {
    eventTrigger.onVaultEvent(event);
    // Re-arm triggers when agent definitions change (UI edits, external editor).
    if (event.path.startsWith('agents/')) {
      scheduler.scheduleReload();
      eventTrigger.scheduleReload();
    }
  });

  const settings = new SettingsService(vault);
  const app = createApi(vault, indexer, runtime, agents, scheduler, settings, controller);

  return { root, indexer, runtime, scheduler, eventTrigger, app };
}

async function teardownWorkspace(ws: Workspace): Promise<void> {
  ws.scheduler.stop();
  ws.eventTrigger.stop();
  await ws.runtime.stop();
  await ws.indexer.stop();
}

async function main(): Promise<void> {
  let ws: Workspace;

  // Stable across switches: API route handlers capture this, the served fetch
  // delegates to the current workspace's app — so we can rebuild everything for
  // a new vault without re-listening on the port.
  const controller: VaultController = {
    current: () => ws.root,
    switch: async (next: string) => {
      const resolved = path.resolve(next);
      if (resolved === ws.root) return;
      await fs.mkdir(resolved, { recursive: true });
      const previous = ws;
      ws = await buildWorkspace(resolved, controller);
      await teardownWorkspace(previous);
      console.log(`[forma] vault переключён → ${resolved}`);
    },
  };

  ws = await buildWorkspace(VAULT_ROOT, controller);
  console.log(`[forma] vault: ${ws.root}`);

  // Delegate to the current workspace's app so a vault switch swaps the handler
  // without re-listening on the port.
  const handler: typeof ws.app.fetch = (req, env, ctx) => ws.app.fetch(req, env, ctx);
  const server = serve({ fetch: handler, port: PORT }, (info) => {
    console.log(`[forma] server: http://localhost:${info.port}`);
  });

  const shutdown = async () => {
    server.close();
    await teardownWorkspace(ws);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // When spawned by the desktop shell, exit as soon as the parent goes away
  // (its stdin pipe closes) so we never orphan the server on a crash / force-quit.
  if (process.env.FORMA_SIDECAR) {
    process.stdin.on('close', () => void shutdown());
    process.stdin.on('end', () => void shutdown());
    process.stdin.resume();
  }
}

void main();
