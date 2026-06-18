import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ClaudeAgentProvider,
  type AgentEvent,
  type AgentProvider,
  type AgentSession,
  type PermissionProfile,
} from '@forma/agent';
import { parseDoc, serializeDoc } from '@forma/core';

/** One line of a chat transcript: a normalized agent event or a user message. */
export type ChatRecord =
  | { type: 'user'; text: string }
  | AgentEvent;

export interface PersistedRecord {
  t: string;
  record: ChatRecord;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  permission: PermissionProfile;
  model: string;
  providerSessionId: string | null;
  createdAt: string;
  lastActive: string;
  costUsd: number;
  turns: number;
  contextDocPath: string | null;
}

interface RuntimeConfig {
  model?: string;
  maxConcurrentTurns: number;
  maxTurns: number;
  maxCostUsd: number;
}

/** Result of a one-shot headless agent run (background agents). */
export interface HeadlessOutcome {
  ok: boolean;
  costUsd: number;
  turns: number;
  error: string | null;
}

const nowIso = () => new Date().toISOString();

/** Counting semaphore limiting how many turns run at once across sessions. */
class Semaphore {
  private waiters: Array<() => void> = [];
  constructor(private permits: number) {}
  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits++;
  }
}

/** Minimal async channel (single consumer) for fanning records into an SSE stream. */
class Channel<T> {
  private queue: T[] = [];
  private resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;
  push(item: T): void {
    if (this.closed) return;
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.queue.push(item);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.resolvers) resolve({ value: undefined, done: true });
    this.resolvers = [];
  }
  async *drain(): AsyncGenerator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const result = await new Promise<IteratorResult<T>>((r) => this.resolvers.push(r));
      if (result.done) return;
      yield result.value;
    }
  }
}

/**
 * Fan-out bus: keeps the full record buffer (the chat transcript) and notifies
 * live subscribers. New subscribers receive a synchronous replay of the buffer
 * and then live records, with no gap (no await between replay and registration).
 */
class EventBus {
  readonly buffer: PersistedRecord[] = [];
  private subscribers = new Set<(r: PersistedRecord) => void>();

  preload(records: PersistedRecord[]): void {
    this.buffer.push(...records);
  }

  publish(record: PersistedRecord): void {
    this.buffer.push(record);
    for (const fn of this.subscribers) fn(record);
  }

  subscribe(fn: (r: PersistedRecord) => void): () => void {
    for (const r of this.buffer) fn(r);
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}

export class RuntimeSession {
  title: string | null = null;
  providerSessionId: string | null = null;
  costUsd = 0;
  turns = 0;
  lastActive: string;
  /** Called after each completed turn (used to (re)arm the idle summary). */
  onActivity: (() => void) | null = null;
  /** Selected fragment to hand the agent as context on the first message. */
  contextSelection: string | null = null;

  private bus = new EventBus();
  private queue: string[] = [];
  private busy = false;

  constructor(
    readonly id: string,
    readonly dir: string,
    readonly permission: PermissionProfile,
    readonly model: string,
    readonly contextDocPath: string | null,
    readonly createdAt: string,
    private agent: AgentSession,
    private semaphore: Semaphore,
  ) {
    this.lastActive = createdAt;
  }

  summary(): SessionSummary {
    return {
      id: this.id,
      title: this.title,
      permission: this.permission,
      model: this.model,
      providerSessionId: this.providerSessionId,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      costUsd: this.costUsd,
      turns: this.turns,
      contextDocPath: this.contextDocPath,
    };
  }

  transcript(): PersistedRecord[] {
    return [...this.bus.buffer];
  }

  /** Accept a user message: persist, publish, and queue a turn. Returns immediately. */
  async postMessage(text: string): Promise<void> {
    let message = text;
    if (this.title === null) {
      this.title = text.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled chat';
      // On the first message, hand the agent the document and/or selection context.
      const ctx: string[] = [];
      if (this.contextDocPath) ctx.push(`We are discussing the vault file \`${this.contextDocPath}\`.`);
      if (this.contextSelection) ctx.push(`Relevant selection:\n${this.contextSelection}`);
      if (ctx.length > 0) message = `(Context: ${ctx.join('\n\n')})\n\n${text}`;
    }
    await this.record({ type: 'user', text });
    this.queue.push(message);
    void this.drainQueue();
  }

  resolvePermission(requestId: string, decision: 'allow' | 'deny'): void {
    this.agent.resolvePermission(requestId, decision);
  }

  async interrupt(): Promise<void> {
    await this.agent.interrupt();
  }

  async close(): Promise<void> {
    await this.agent.close();
  }

  /** Buffered + live records until the abort signal fires. */
  async *events(signal: AbortSignal): AsyncGenerator<PersistedRecord> {
    const channel = new Channel<PersistedRecord>();
    const unsubscribe = this.bus.subscribe((r) => channel.push(r));
    const onAbort = () => {
      unsubscribe();
      channel.close();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    try {
      for await (const record of channel.drain()) yield record;
    } finally {
      unsubscribe();
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const text = this.queue.shift()!;
        await this.semaphore.acquire();
        try {
          await this.runTurn(text);
        } finally {
          this.semaphore.release();
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async runTurn(text: string): Promise<void> {
    try {
      for await (const event of this.agent.send({ text })) {
        await this.record(event);
        if (event.type === 'session') this.providerSessionId = event.sessionId;
        if (event.type === 'result') {
          this.costUsd += event.costUsd ?? 0;
          this.turns += event.turns;
          await this.saveMeta();
        }
      }
      this.onActivity?.();
    } catch (err) {
      await this.record({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async record(record: ChatRecord): Promise<void> {
    const entry: PersistedRecord = { t: nowIso(), record };
    this.lastActive = entry.t;
    this.bus.publish(entry);
    await fs.appendFile(path.join(this.dir, 'transcript.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  }

  async saveMeta(): Promise<void> {
    const frontmatter = {
      type: 'chat',
      title: this.title ?? 'Untitled chat',
      started: this.createdAt,
      lastActive: this.lastActive,
      providerSessionId: this.providerSessionId,
      permission: this.permission,
      model: this.model,
      costUsd: Number(this.costUsd.toFixed(4)),
      turns: this.turns,
      ...(this.contextDocPath ? { contextDoc: this.contextDocPath } : {}),
    };
    const body = `# ${this.title ?? 'Untitled chat'}\n`;
    await fs.writeFile(path.join(this.dir, 'meta.md'), serializeDoc(frontmatter, body), 'utf8');
  }

  preloadTranscript(records: PersistedRecord[]): void {
    this.bus.preload(records);
  }
}

export class AgentRuntime {
  private provider: AgentProvider = new ClaudeAgentProvider();
  private semaphore: Semaphore;
  private sessions = new Map<string, RuntimeSession>();
  private chatsDir: string;
  /** Idle-summary timers and the turn count each chat was last summarized at. */
  private summaryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastSummaryTurns = new Map<string, number>();
  private summaryIdleMs = Number(process.env.FORMA_SUMMARY_IDLE_MS ?? 120_000);

  constructor(
    private vaultRoot: string,
    private config: RuntimeConfig,
  ) {
    this.semaphore = new Semaphore(config.maxConcurrentTurns);
    this.chatsDir = path.join(vaultRoot, 'chats');
  }

  async createSession(opts: {
    permission?: PermissionProfile;
    contextDocPath?: string | null;
    contextSelection?: string;
    model?: string;
  }): Promise<RuntimeSession> {
    const permission = opts.permission ?? 'full';
    const model = opts.model ?? this.config.model ?? 'claude-sonnet-4-6';
    const id = `${nowIso().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
    const dir = path.join(this.chatsDir, id);
    await fs.mkdir(dir, { recursive: true });

    const agent = this.provider.createSession({
      vaultRoot: this.vaultRoot,
      permission,
      model,
      maxTurns: this.config.maxTurns,
      maxCostUsd: this.config.maxCostUsd,
    });

    const session = new RuntimeSession(
      id,
      dir,
      permission,
      model,
      opts.contextDocPath ?? null,
      nowIso(),
      agent,
      this.semaphore,
    );
    session.onActivity = () => this.armSummary(id);
    session.contextSelection = opts.contextSelection ?? null;
    this.sessions.set(id, session);
    await session.saveMeta();
    return session;
  }

  /** Reattach to a persisted chat: continue the provider session and replay history. */
  async resumeSession(id: string): Promise<RuntimeSession | null> {
    const existing = this.sessions.get(id);
    if (existing) return existing;

    const dir = path.join(this.chatsDir, id);
    let metaRaw: string;
    try {
      metaRaw = await fs.readFile(path.join(dir, 'meta.md'), 'utf8');
    } catch {
      return null;
    }
    const { frontmatter } = parseDoc(metaRaw);
    const permission = (frontmatter['permission'] as PermissionProfile) ?? 'full';
    const model =
      typeof frontmatter['model'] === 'string'
        ? frontmatter['model']
        : (this.config.model ?? 'claude-sonnet-4-6');
    const providerSessionId =
      typeof frontmatter['providerSessionId'] === 'string' ? frontmatter['providerSessionId'] : undefined;

    const agent = this.provider.createSession({
      vaultRoot: this.vaultRoot,
      permission,
      model,
      maxTurns: this.config.maxTurns,
      maxCostUsd: this.config.maxCostUsd,
      resumeSessionId: providerSessionId,
    });

    const createdAt = typeof frontmatter['started'] === 'string' ? frontmatter['started'] : nowIso();
    const contextDoc = typeof frontmatter['contextDoc'] === 'string' ? frontmatter['contextDoc'] : null;
    const session = new RuntimeSession(id, dir, permission, model, contextDoc, createdAt, agent, this.semaphore);
    session.title = typeof frontmatter['title'] === 'string' ? frontmatter['title'] : null;
    session.providerSessionId = providerSessionId ?? null;
    session.costUsd = typeof frontmatter['costUsd'] === 'number' ? frontmatter['costUsd'] : 0;
    session.turns = typeof frontmatter['turns'] === 'number' ? frontmatter['turns'] : 0;
    session.onActivity = () => this.armSummary(id);
    session.preloadTranscript(await readTranscript(dir));
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): RuntimeSession | undefined {
    return this.sessions.get(id);
  }

  defaultModel(): string {
    return this.config.model ?? 'claude-sonnet-4-6';
  }

  /**
   * Run one prompt to completion with no interactive session or persistence —
   * the execution primitive for background (custom) agents. Shares the turn
   * semaphore with chats. Any permission prompt is auto-denied (no UI to ask).
   */
  async runHeadless(opts: {
    prompt: string;
    permission: PermissionProfile;
    model: string;
    maxTurns?: number;
    maxCostUsd?: number;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
  }): Promise<HeadlessOutcome> {
    await this.semaphore.acquire();
    const agent = this.provider.createSession({
      vaultRoot: this.vaultRoot,
      permission: opts.permission,
      model: opts.model,
      maxTurns: opts.maxTurns ?? this.config.maxTurns,
      maxCostUsd: opts.maxCostUsd ?? this.config.maxCostUsd,
    });

    let ok = false;
    let costUsd = 0;
    let turns = 0;
    let error: string | null = null;
    try {
      for await (const event of agent.send({ text: opts.prompt })) {
        if (event.type === 'permission_request') agent.resolvePermission(event.requestId, 'deny');
        if (opts.onEvent) await opts.onEvent(event);
        if (event.type === 'result') {
          ok = event.ok;
          costUsd += event.costUsd ?? 0;
          turns += event.turns;
        } else if (event.type === 'error') {
          error = event.message;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      await agent.close().catch(() => {});
      this.semaphore.release();
    }
    return { ok, costUsd, turns, error };
  }

  /** (Re)arm the idle timer that summarizes a chat once it goes quiet. */
  private armSummary(id: string): void {
    if (this.summaryIdleMs <= 0) return;
    const existing = this.summaryTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.summaryTimers.delete(id);
      void this.summarizeSession(id).catch((e) => console.error('[summary] failed', id, e));
    }, this.summaryIdleMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.summaryTimers.set(id, timer);
  }

  /**
   * Distill a chat into chats/<id>/summary.md plus durable facts into raw/.
   * Skips when nothing new happened since the last summary (unless forced).
   */
  async summarizeSession(id: string, force = false): Promise<HeadlessOutcome | null> {
    const live = this.sessions.get(id);
    const records = live ? live.transcript() : await this.loadTranscript(id);
    if (!records || records.length === 0) return null;

    const turns = live
      ? live.turns
      : records.filter((r) => r.record.type === 'result').length;
    if (!force && (this.lastSummaryTurns.get(id) ?? 0) >= turns) return null;

    const text = condenseTranscript(records);
    if (text.trim() === '') return null;

    const today = nowIso().slice(0, 10);
    const clipped = text.length > 12_000 ? text.slice(-12_000) : text;
    const prompt = [
      'Ниже — транскрипт диалога пользователя с агентом. Сделай краткую выжимку.',
      '',
      `1. Создай или перезапиши chats/${id}/summary.md с frontmatter:`,
      '   type: summary',
      `   of: ${id}`,
      `   created: ${today}`,
      '   и кратким markdown-резюме: что обсуждали, решения, итоги.',
      `2. Если появились устойчивые факты/решения/знания — допиши их пунктами в`,
      `   raw/${today}-chat-${id}.md (создай при отсутствии; дополняй, не затирай).`,
      '   Если ничего стоящего нет — пропусти этот шаг.',
      '',
      'Будь краток, игнорируй болтовню, больше ничего не меняй.',
      '',
      '--- ТРАНСКРИПТ ---',
      clipped,
    ].join('\n');

    const outcome = await this.runHeadless({
      prompt,
      permission: 'vault-write',
      model: this.defaultModel(),
      maxTurns: 12,
    });
    if (outcome.ok && !outcome.error) this.lastSummaryTurns.set(id, turns);
    return outcome;
  }

  /** List persisted chats (from each chats/<id>/meta.md), newest first. */
  async listSessions(): Promise<SessionSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.chatsDir);
    } catch {
      return [];
    }
    const summaries: SessionSummary[] = [];
    for (const id of entries) {
      const live = this.sessions.get(id);
      if (live) {
        summaries.push(live.summary());
        continue;
      }
      try {
        const metaRaw = await fs.readFile(path.join(this.chatsDir, id, 'meta.md'), 'utf8');
        const { frontmatter } = parseDoc(metaRaw);
        summaries.push({
          id,
          title: (frontmatter['title'] as string) ?? null,
          permission: (frontmatter['permission'] as PermissionProfile) ?? 'full',
          model: (frontmatter['model'] as string) ?? (this.config.model ?? 'claude-sonnet-4-6'),
          providerSessionId: (frontmatter['providerSessionId'] as string) ?? null,
          createdAt: (frontmatter['started'] as string) ?? '',
          lastActive: (frontmatter['lastActive'] as string) ?? '',
          costUsd: (frontmatter['costUsd'] as number) ?? 0,
          turns: (frontmatter['turns'] as number) ?? 0,
          contextDocPath: (frontmatter['contextDoc'] as string) ?? null,
        });
      } catch {
        // not a chat dir
      }
    }
    summaries.sort((a, b) => (a.lastActive < b.lastActive ? 1 : -1));
    return summaries;
  }

  async loadTranscript(id: string): Promise<PersistedRecord[] | null> {
    const live = this.sessions.get(id);
    if (live) return live.transcript();
    const dir = path.join(this.chatsDir, id);
    try {
      await fs.stat(path.join(dir, 'meta.md'));
    } catch {
      return null;
    }
    return readTranscript(dir);
  }

  async stop(): Promise<void> {
    for (const timer of this.summaryTimers.values()) clearTimeout(timer);
    this.summaryTimers.clear();
    await Promise.all([...this.sessions.values()].map((s) => s.close().catch(() => {})));
  }
}

/** Flatten a transcript to plain "User:/Agent:" text for summarization. */
function condenseTranscript(records: PersistedRecord[]): string {
  const lines: string[] = [];
  let assistant = '';
  const flush = () => {
    if (assistant.trim()) lines.push(`Agent: ${assistant.trim()}`);
    assistant = '';
  };
  for (const { record } of records) {
    if (record.type === 'user') {
      flush();
      lines.push(`User: ${record.text}`);
    } else if (record.type === 'text_delta') {
      assistant += record.text;
    } else if (record.type === 'result') {
      flush();
    }
  }
  flush();
  return lines.join('\n\n');
}

async function readTranscript(dir: string): Promise<PersistedRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, 'transcript.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const records: PersistedRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as PersistedRecord);
    } catch {
      // skip malformed line
    }
  }
  return records;
}
