/**
 * Phase 1.1 acceptance check: a vault-write session answers and creates a
 * file in a throwaway vault. Run with `npm run smoke -w @forma/agent`.
 *
 * Requires ANTHROPIC_API_KEY (or a configured cloud provider). Skips with a
 * clear message — and exit code 0 — if no credentials are present, so it is
 * safe in CI.
 */
import { mkdtemp, mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClaudeAgentProvider, type AgentEvent } from './index.js';

const MARKER = 'forma-smoke-ok';

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_USE_BEDROCK && !process.env.CLAUDE_CODE_USE_VERTEX) {
    console.log('⊘ skipped: set ANTHROPIC_API_KEY to run the agent smoke test');
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'forma-smoke-'));
  await mkdir(path.join(root, '.claude'), { recursive: true });
  await writeFile(
    path.join(root, '.claude', 'CLAUDE.md'),
    'This is a test vault. Create files exactly where asked.\n',
    'utf8',
  );

  const provider = new ClaudeAgentProvider();
  const session = provider.createSession({
    vaultRoot: root,
    permission: 'vault-write',
    maxTurns: 6,
    maxCostUsd: 0.5,
  });

  console.log(`vault: ${root}`);
  try {
    let lastResult: Extract<AgentEvent, { type: 'result' }> | null = null;
    const prompt = `Create a file named note.md in this directory with exactly this content: "${MARKER}". Then stop.`;
    for await (const event of session.send({ text: prompt })) {
      switch (event.type) {
        case 'session':
          console.log(`session: ${event.sessionId}`);
          break;
        case 'tool_use':
          console.log(`→ tool: ${event.name} ${JSON.stringify(event.input).slice(0, 80)}`);
          break;
        case 'permission_request':
          // vault-write auto-allows in-vault writes, so this should not happen.
          console.log(`! unexpected permission request for ${event.tool}; denying`);
          session.resolvePermission(event.requestId, 'deny');
          break;
        case 'result':
          lastResult = event;
          break;
        case 'error':
          console.error(`error: ${event.message}`);
          break;
        default:
          break;
      }
    }

    await session.close();

    const notePath = path.join(root, 'note.md');
    const exists = await stat(notePath).then(() => true).catch(() => false);
    const body = exists ? await readFile(notePath, 'utf8') : '';
    const ok = exists && body.includes(MARKER);

    console.log(
      `result: ok=${lastResult?.ok} turns=${lastResult?.turns} ` +
        `cost=$${lastResult?.costUsd?.toFixed(4) ?? '?'} file=${exists ? 'created' : 'missing'}`,
    );
    if (!ok) {
      console.error('✗ FAIL: expected note.md with marker content');
      process.exitCode = 1;
    } else {
      console.log('✓ PASS: agent created the file');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
