import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { agentFromDoc, type AgentDefinition } from '@forma/core';
import type { AgentEvent } from '@forma/agent';
import type { AgentRuntime } from './runtime.js';
import { VaultError, type VaultService } from './vault.js';

const nowIso = () => new Date().toISOString();
const round = (n: number) => Number(n.toFixed(4));

export type RunTrigger = 'manual' | 'cron' | 'event';
export type RunStatus = 'running' | 'success' | 'error';

/** Summary of one background agent run, persisted as `meta.json`. */
export interface AgentRun {
  agent: string;
  runId: string;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  costUsd: number;
  turns: number;
  error: string | null;
}

/** One persisted run event line. */
export interface RunRecord {
  t: string;
  record: AgentEvent;
}

/** Reject names that could escape the runs directory or the agents folder. */
function safeName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new VaultError(`invalid agent name: ${name}`, 400);
  }
  return name;
}

/**
 * Owns custom agents: reads their definitions from `agents/*.md`, runs them
 * headless via the runtime, and journals each run under `.forma/runs/`.
 */
export class AgentService {
  private runsDir: string;
  /** Agents with a run in flight (for overlap guard and live UI badges). */
  private running = new Set<string>();

  constructor(
    private vault: VaultService,
    private runtime: AgentRuntime,
  ) {
    this.runsDir = path.join(vault.root, '.forma', 'runs');
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }

  async listDefinitions(): Promise<AgentDefinition[]> {
    const files = await this.vault.listMarkdownFiles();
    const defs: AgentDefinition[] = [];
    for (const rel of files) {
      if (!rel.startsWith('agents/')) continue;
      const doc = await this.vault.readDoc(rel);
      defs.push(agentFromDoc(rel, doc.frontmatter, doc.body));
    }
    defs.sort((a, b) => a.name.localeCompare(b.name));
    return defs;
  }

  async getDefinition(name: string): Promise<AgentDefinition | null> {
    const rel = `agents/${safeName(name)}.md`;
    if (!(await this.vault.exists(rel))) return null;
    const doc = await this.vault.readDoc(rel);
    return agentFromDoc(rel, doc.frontmatter, doc.body);
  }

  /** Toggle a definition's `enabled` flag (the watcher re-arms triggers). */
  async setEnabled(name: string, enabled: boolean): Promise<AgentDefinition> {
    const rel = `agents/${safeName(name)}.md`;
    if (!(await this.vault.exists(rel))) throw new VaultError(`agent not found: ${name}`, 404);
    const doc = await this.vault.readDoc(rel);
    await this.vault.writeDoc(rel, { ...doc.frontmatter, enabled }, doc.body, {
      baseMtimeMs: doc.mtimeMs,
    });
    return (await this.getDefinition(name))!;
  }

  /**
   * Start a run in the background; returns the initial (running) record.
   * `context` (the triggering file path or webhook payload) is prepended to
   * the agent's prompt so it knows what set it off.
   */
  async startRun(name: string, trigger: RunTrigger, context?: string): Promise<AgentRun> {
    const def = await this.getDefinition(name);
    if (!def) throw new VaultError(`agent not found: ${name}`, 404);

    // Sortable, filesystem-safe id; random suffix avoids same-millisecond clashes.
    const runId = `${nowIso().replace(/[:.]/g, '-')}-${randomBytes(2).toString('hex')}`;
    const dir = path.join(this.runsDir, def.name, runId);
    await fs.mkdir(dir, { recursive: true });

    const run: AgentRun = {
      agent: def.name,
      runId,
      trigger,
      startedAt: nowIso(),
      finishedAt: null,
      status: 'running',
      costUsd: 0,
      turns: 0,
      error: null,
    };
    await this.writeMeta(dir, run);
    void this.execute(def, dir, run, context);
    return run;
  }

  private async execute(
    def: AgentDefinition,
    dir: string,
    run: AgentRun,
    context?: string,
  ): Promise<void> {
    this.running.add(def.name);
    const eventsFile = path.join(dir, 'events.jsonl');
    const prompt = context ? `${context}\n\n${def.prompt}` : def.prompt;
    // Background runs can't approve anything interactively: full → vault-write.
    const permission = def.permission === 'full' ? 'vault-write' : def.permission;
    try {
      const outcome = await this.runtime.runHeadless({
        prompt,
        permission,
        model: def.model ?? this.runtime.defaultModel(),
        maxTurns: def.budget.maxTurns ?? undefined,
        maxCostUsd: def.budget.maxCostUsd ?? undefined,
        onEvent: (event) =>
          fs.appendFile(eventsFile, JSON.stringify({ t: nowIso(), record: event }) + '\n', 'utf8'),
      });
      await this.writeMeta(dir, {
        ...run,
        finishedAt: nowIso(),
        status: outcome.error || !outcome.ok ? 'error' : 'success',
        costUsd: round(outcome.costUsd),
        turns: outcome.turns,
        error: outcome.error,
      });
    } catch (err) {
      await this.writeMeta(dir, {
        ...run,
        finishedAt: nowIso(),
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running.delete(def.name);
    }
  }

  /**
   * Mark runs left as `running` by a crashed/restarted server as errored —
   * otherwise they'd hang in the journal forever. Run once at startup.
   */
  async reapStaleRuns(): Promise<number> {
    let agentDirs: string[];
    try {
      agentDirs = await fs.readdir(this.runsDir);
    } catch {
      return 0; // no runs yet
    }
    let reaped = 0;
    for (const name of agentDirs) {
      const agentDir = path.join(this.runsDir, name);
      let runIds: string[];
      try {
        runIds = await fs.readdir(agentDir);
      } catch {
        continue;
      }
      for (const runId of runIds) {
        const dir = path.join(agentDir, runId);
        const meta = await this.readMeta(dir);
        if (meta?.status === 'running') {
          await this.writeMeta(dir, {
            ...meta,
            status: 'error',
            finishedAt: nowIso(),
            error: 'interrupted (server restarted)',
          });
          reaped++;
        }
      }
    }
    return reaped;
  }

  async listRuns(name: string, limit = 50): Promise<AgentRun[]> {
    const agentDir = path.join(this.runsDir, safeName(name));
    let entries: string[];
    try {
      entries = await fs.readdir(agentDir);
    } catch {
      return [];
    }
    const runs: AgentRun[] = [];
    for (const runId of entries) {
      const meta = await this.readMeta(path.join(agentDir, runId));
      if (meta) runs.push(meta);
    }
    runs.sort((a, b) => (a.runId < b.runId ? 1 : -1));
    return runs.slice(0, limit);
  }

  async getRun(name: string, runId: string): Promise<{ meta: AgentRun; events: RunRecord[] } | null> {
    const dir = path.join(this.runsDir, safeName(name), safeName(runId));
    const meta = await this.readMeta(dir);
    if (!meta) return null;
    return { meta, events: await this.readEvents(dir) };
  }

  private async writeMeta(dir: string, run: AgentRun): Promise<void> {
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(run, null, 2), 'utf8');
  }

  private async readMeta(dir: string): Promise<AgentRun | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as AgentRun;
    } catch {
      return null;
    }
  }

  private async readEvents(dir: string): Promise<RunRecord[]> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, 'events.jsonl'), 'utf8');
    } catch {
      return [];
    }
    const records: RunRecord[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      try {
        records.push(JSON.parse(line) as RunRecord);
      } catch {
        // skip malformed line
      }
    }
    return records;
  }
}
