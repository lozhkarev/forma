import type {
  AgentDefinition,
  AgentPermission,
  AgentTriggerType,
  Frontmatter,
} from './types.js';

const PERMISSIONS: AgentPermission[] = ['read-only', 'vault-write', 'full'];
const TRIGGER_TYPES: AgentTriggerType[] = ['cron', 'event', 'manual'];

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Agent name derived from its file path (`agents/weekly.md` → `weekly`). */
export function agentNameFromPath(relPath: string): string {
  return (relPath.split('/').pop() ?? relPath).replace(/\.md$/, '');
}

function parseTrigger(raw: unknown): AgentDefinition['trigger'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const t = raw as Record<string, unknown>;
    const type = TRIGGER_TYPES.includes(t['type'] as AgentTriggerType)
      ? (t['type'] as AgentTriggerType)
      : 'manual';
    return { type, schedule: str(t['schedule']), glob: str(t['glob']) };
  }
  // Shorthand: `trigger: cron`.
  const shorthand = str(raw);
  if (shorthand && TRIGGER_TYPES.includes(shorthand as AgentTriggerType)) {
    return { type: shorthand as AgentTriggerType, schedule: null, glob: null };
  }
  return { type: 'manual', schedule: null, glob: null };
}

function parseBudget(raw: unknown): AgentDefinition['budget'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const b = raw as Record<string, unknown>;
    return { maxTurns: num(b['maxTurns']), maxCostUsd: num(b['maxCostUsd']) };
  }
  return { maxTurns: null, maxCostUsd: null };
}

/**
 * Parse an agent definition file. Tolerant of missing fields: unknown or
 * absent values fall back to safe defaults (manual trigger, vault-write).
 */
export function agentFromDoc(
  relPath: string,
  frontmatter: Frontmatter,
  body: string,
): AgentDefinition {
  const permRaw = str(frontmatter['permissions']) ?? str(frontmatter['permission']);
  const permission: AgentPermission = PERMISSIONS.includes(permRaw as AgentPermission)
    ? (permRaw as AgentPermission)
    : 'vault-write';

  return {
    name: str(frontmatter['name']) ?? agentNameFromPath(relPath),
    path: relPath,
    enabled: frontmatter['enabled'] !== false,
    trigger: parseTrigger(frontmatter['trigger']),
    permission,
    model: str(frontmatter['model']),
    budget: parseBudget(frontmatter['budget']),
    output: str(frontmatter['output']),
    prompt: body.trim(),
  };
}
