import type { AgentDefinition } from '@forma/core';
import type { PersistedRecord } from './chat';

export type { AgentDefinition };

/** Definition enriched with live state, as returned by GET /api/agents. */
export interface AgentSummary extends AgentDefinition {
  running: boolean;
  nextRun: string | null;
}

export type RunTrigger = 'manual' | 'cron' | 'event';
export type RunStatus = 'running' | 'success' | 'error';

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

export interface RunDetail {
  meta: AgentRun;
  events: PersistedRecord[];
}
