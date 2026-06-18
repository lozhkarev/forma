/**
 * Provider-agnostic agent abstraction. The concrete provider (Claude Agent
 * SDK today, Codex later) is hidden behind these interfaces so the server
 * never imports a vendor SDK directly.
 */

/** What the agent is allowed to do in a session. See README / ARCHITECTURE §4. */
export type PermissionProfile = 'read-only' | 'vault-write' | 'full';

/** Reasoning effort level (maps to the SDK's `effort`). */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface SessionOptions {
  /** Working directory for the agent; all file tools operate here. */
  vaultRoot: string;
  permission: PermissionProfile;
  /** Resume a prior provider session by its id (continues full context). */
  resumeSessionId?: string;
  /** Model id override; provider picks a sensible default otherwise. */
  model?: string;
  /** Reasoning effort level. */
  effort?: AgentEffort;
  /** Hard stop after this many tool-use turns. */
  maxTurns?: number;
  /** Hard stop once estimated cost exceeds this (USD). */
  maxCostUsd?: number;
}

export interface UserMessage {
  text: string;
}

/**
 * Normalized stream of what happens during one turn. The server forwards
 * these to the web client over SSE and persists them to the transcript.
 */
export type AgentEvent =
  /** Provider session id is known — persist it for resume. */
  | { type: 'session'; sessionId: string }
  /** Incremental assistant text. */
  | { type: 'text_delta'; text: string }
  /** Agent decided to call a tool. */
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  /** Result of a tool call came back. */
  | { type: 'tool_result'; id: string; isError: boolean; content: string }
  /** Agent wants to do something that needs user approval. */
  | { type: 'permission_request'; requestId: string; tool: string; input: unknown }
  /** Turn finished. */
  | {
      type: 'result';
      sessionId: string | null;
      ok: boolean;
      costUsd: number | null;
      turns: number;
      durationMs: number;
      stopReason: string | null;
    }
  /** Unrecoverable error in the turn. */
  | { type: 'error'; message: string };

export interface AgentSession {
  /** Provider session id once known (null until the first turn starts). */
  readonly id: string | null;
  /** Send a user message; iterate the returned events until the turn ends. */
  send(message: UserMessage): AsyncIterable<AgentEvent>;
  /** Resolve an outstanding permission_request. */
  resolvePermission(requestId: string, decision: 'allow' | 'deny'): void;
  /** Change the model for subsequent turns. */
  setModel(model: string): Promise<void>;
  /** Change the permission profile for subsequent tool calls. */
  setPermission(permission: PermissionProfile): void;
  /** Change the reasoning effort for subsequent turns. */
  setEffort(effort: AgentEffort): Promise<void>;
  /** Stop the in-flight turn. */
  interrupt(): Promise<void>;
  /** End the session and release resources. */
  close(): Promise<void>;
}

export interface AgentProvider {
  createSession(opts: SessionOptions): AgentSession;
}
