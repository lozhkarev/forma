import { Cron } from 'croner';
import type { AgentService } from './agents.js';

export interface ScheduledJob {
  name: string;
  schedule: string;
  nextRun: string | null;
}

/**
 * Fires custom agents on their cron schedules. Rebuilt whenever agent
 * definitions change so edits in the UI or on disk take effect without
 * a restart.
 */
export class Scheduler {
  private jobs = new Map<string, Cron>();
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private agents: AgentService) {}

  async start(): Promise<void> {
    await this.reload();
  }

  /** Rebuild all cron jobs from the current agent definitions. */
  async reload(): Promise<void> {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();

    const defs = await this.agents.listDefinitions();
    for (const def of defs) {
      if (!def.enabled || def.trigger.type !== 'cron' || !def.trigger.schedule) continue;
      try {
        const job = new Cron(def.trigger.schedule, { name: def.name }, () => {
          // Skip if the previous run is still going — avoids pile-ups on tight
          // schedules; the runtime semaphore bounds true concurrency anyway.
          if (this.agents.isRunning(def.name)) return;
          void this.agents
            .startRun(def.name, 'cron')
            .catch((err) => console.error(`[scheduler] ${def.name} failed to start:`, err));
        });
        this.jobs.set(def.name, job);
      } catch (err) {
        console.error(`[scheduler] invalid cron for ${def.name} (${def.trigger.schedule}):`, err);
      }
    }
    console.log(`[forma] scheduler: ${this.jobs.size} cron agent(s)`);
  }

  /** Debounced reload for filesystem-change bursts. */
  scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.reload(), 500);
  }

  list(): ScheduledJob[] {
    return [...this.jobs.entries()].map(([name, job]) => ({
      name,
      schedule: job.getPattern() ?? '',
      nextRun: job.nextRun()?.toISOString() ?? null,
    }));
  }

  stop(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }
}
