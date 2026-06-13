import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Channel, Gate } from './channel.js';
import type {
  AgentEvent,
  AgentProvider,
  AgentSession,
  PermissionProfile,
  SessionOptions,
  UserMessage,
} from './types.js';

// Tools that only read state — always safe.
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'TodoWrite']);
// Tools that write files — allowed only inside the vault.
const WRITE_FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

type SdkMessage = Record<string, any>;
type PermissionResult =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string };

class ClaudeAgentSession implements AgentSession {
  id: string | null = null;

  private input = new Gate<SdkMessage | null>();
  private turn: Channel<AgentEvent> | null = null;
  private query: ReturnType<typeof query> | null = null;
  private pendingPermissions = new Map<string, (d: 'allow' | 'deny') => void>();
  private permCounter = 0;

  constructor(private opts: SessionOptions) {}

  send(message: UserMessage): AsyncIterable<AgentEvent> {
    if (!this.query) this.start();
    const channel = new Channel<AgentEvent>();
    this.turn = channel;
    this.input.put({
      type: 'user',
      message: { role: 'user', content: message.text },
      parent_tool_use_id: null,
    });
    return channel.drain();
  }

  resolvePermission(requestId: string, decision: 'allow' | 'deny'): void {
    const resolve = this.pendingPermissions.get(requestId);
    if (resolve) {
      this.pendingPermissions.delete(requestId);
      resolve(decision);
    }
  }

  async interrupt(): Promise<void> {
    await this.query?.interrupt();
  }

  async close(): Promise<void> {
    // Deny anything still waiting and end the input stream so query() returns.
    for (const resolve of this.pendingPermissions.values()) resolve('deny');
    this.pendingPermissions.clear();
    this.input.put(null);
  }

  private start(): void {
    const { opts } = this;
    this.query = query({
      prompt: this.inputStream() as any,
      options: {
        cwd: opts.vaultRoot,
        // Load vault/.claude/CLAUDE.md and skills, but not the host machine's
        // user/local settings.
        settingSources: ['project'],
        includePartialMessages: true,
        permissionMode: 'default',
        canUseTool: (toolName: string, input: unknown) => this.canUseTool(toolName, input),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.maxTurns ? { maxTurns: opts.maxTurns } : {}),
        ...(opts.maxCostUsd ? { maxBudgetUsd: opts.maxCostUsd } : {}),
        ...(opts.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
      } as any,
    });
    void this.consume();
  }

  private async *inputStream(): AsyncGenerator<SdkMessage> {
    while (true) {
      const msg = await this.input.next();
      if (msg === null) return;
      yield msg;
    }
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.query!) {
        this.handle(msg as SdkMessage);
      }
    } catch (err) {
      this.turn?.push({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      this.turn?.close();
    }
  }

  private handle(msg: SdkMessage): void {
    const turn = this.turn;
    if (!turn) return;

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init' && typeof msg.session_id === 'string') {
          this.id = msg.session_id;
          turn.push({ type: 'session', sessionId: msg.session_id });
        }
        return;

      case 'stream_event': {
        const event = msg.event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          turn.push({ type: 'text_delta', text: event.delta.text });
        }
        return;
      }

      case 'assistant':
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_use') {
            turn.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          }
        }
        return;

      case 'user':
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_result') {
            turn.push({
              type: 'tool_result',
              id: block.tool_use_id,
              isError: block.is_error === true,
              content: stringifyContent(block.content),
            });
          }
        }
        return;

      case 'result':
        if (typeof msg.session_id === 'string') this.id = msg.session_id;
        turn.push({
          type: 'result',
          sessionId: this.id,
          ok: msg.subtype === 'success',
          costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
          turns: typeof msg.num_turns === 'number' ? msg.num_turns : 0,
          durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : 0,
          stopReason: typeof msg.stop_reason === 'string' ? msg.stop_reason : null,
        });
        turn.close();
        return;

      default:
        return;
    }
  }

  private async canUseTool(toolName: string, input: unknown): Promise<PermissionResult> {
    const verdict = this.classify(toolName, input);
    if (verdict === 'allow') return { behavior: 'allow', updatedInput: input };
    if (verdict !== 'prompt') return { behavior: 'deny', message: verdict.deny };

    // Surface to the UI and wait for the user's decision.
    const requestId = `perm-${++this.permCounter}`;
    const decision = await new Promise<'allow' | 'deny'>((resolve) => {
      this.pendingPermissions.set(requestId, resolve);
      this.turn?.push({ type: 'permission_request', requestId, tool: toolName, input });
    });
    return decision === 'allow'
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'declined by user' };
  }

  /** Map (tool, input, profile) → allow | prompt | {deny}. */
  private classify(
    toolName: string,
    input: unknown,
  ): 'allow' | 'prompt' | { deny: string } {
    const profile: PermissionProfile = this.opts.permission;

    if (READ_TOOLS.has(toolName)) return 'allow';

    if (WRITE_FILE_TOOLS.has(toolName)) {
      if (profile === 'read-only') return { deny: 'read-only session' };
      if (!this.isInsideVault(input)) return { deny: 'write outside vault is blocked' };
      return 'allow';
    }

    // Everything else side-effects (Bash, WebFetch/WebSearch, MCP tools …).
    if (profile === 'read-only') return { deny: 'read-only session' };
    if (profile === 'vault-write') return { deny: 'side-effecting tool needs an interactive session' };
    return 'prompt';
  }

  private isInsideVault(input: unknown): boolean {
    const filePath = (input as { file_path?: unknown } | null)?.file_path;
    if (typeof filePath !== 'string') return false;
    const abs = path.resolve(this.opts.vaultRoot, filePath);
    return abs === this.opts.vaultRoot || abs.startsWith(this.opts.vaultRoot + path.sep);
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : JSON.stringify(part),
      )
      .join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
}

export class ClaudeAgentProvider implements AgentProvider {
  createSession(opts: SessionOptions): AgentSession {
    return new ClaudeAgentSession(opts);
  }
}
