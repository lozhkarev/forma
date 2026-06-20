import { existsSync } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * Best-effort git history for the vault: `git init` on first run, an explicit
 * commit after each agent run, and debounced commits for bursts of edits
 * (manual, external, or agent chat). All operations are serialized and never
 * throw into request paths — if git is unavailable the service quietly disables.
 */
export class GitService {
  private git: SimpleGit;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;

  constructor(private root: string) {
    this.git = simpleGit(root);
  }

  async ensureRepo(): Promise<void> {
    try {
      if (!existsSync(path.join(this.root, '.git'))) {
        await this.git.init();
      }
      const cfg = (await this.git.listConfig()).all;
      if (!cfg['user.name']) await this.git.addConfig('user.name', 'Forma');
      if (!cfg['user.email']) await this.git.addConfig('user.email', 'forma@localhost');
      this.enabled = true;
      if (!(await this.hasCommits())) await this.commitNow('Initial vault');
    } catch (err) {
      this.enabled = false;
      console.warn(`[forma] git отключён: ${(err as Error).message}`);
    }
  }

  private async hasCommits(): Promise<boolean> {
    try {
      await this.git.revparse(['HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  /** Commit all changes now (serialized). No-op if clean or disabled. */
  commitAll(message: string): Promise<void> {
    return this.enqueue(() => this.commitNow(message));
  }

  /** Coalesce bursts of edits into one commit a few seconds after they settle. */
  scheduleCommit(message: string, delayMs = 4000): void {
    if (!this.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.commitAll(message);
    }, delayMs);
  }

  private async commitNow(message: string): Promise<void> {
    if (!this.enabled) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.git.raw(['add', '-A']);
    const status = await this.git.status();
    if (status.files.length === 0) return; // nothing staged
    await this.git.commit(message);
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.queue.catch(() => undefined);
  }
}
