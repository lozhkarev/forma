/** Agent models offered in the UI. Verified available on the configured gateway. */
export interface AgentModel {
  id: string;
  label: string;
  description?: string;
}

export const AGENT_MODELS: AgentModel[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', description: 'Most capable' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', description: 'Balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest' },
];

/**
 * The catalog plus the configured default. If the default isn't a known model
 * (custom override), surface it as an option too so the UI can show it.
 */
export function modelsWithDefault(defaultId: string): { models: AgentModel[]; default: string } {
  const known = AGENT_MODELS.some((m) => m.id === defaultId);
  const models = known ? AGENT_MODELS : [{ id: defaultId, label: defaultId }, ...AGENT_MODELS];
  return { models, default: defaultId };
}
