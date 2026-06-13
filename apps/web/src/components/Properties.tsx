import { useState } from 'react';
import type { Frontmatter, TaskStatus } from '@forma/core';
import { objectToYaml, TASK_STATUSES, yamlToObject } from '@forma/core';
import { STATUS_LABELS } from '../lib/labels';

interface Props {
  frontmatter: Frontmatter;
  onChange: (fm: Frontmatter) => void;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Свойства документа (frontmatter): чипы + статус задачи быстрым селектом,
 * полное редактирование — через YAML.
 */
export function Properties({ frontmatter, onChange }: Props) {
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);

  const entries = Object.entries(frontmatter);
  const isTask = typeof frontmatter.status === 'string';

  const openYaml = () => {
    setYamlDraft(objectToYaml(frontmatter));
    setYamlError(null);
    setYamlMode(true);
  };

  const applyYaml = () => {
    try {
      onChange(yamlToObject(yamlDraft));
      setYamlMode(false);
    } catch (e) {
      setYamlError(e instanceof Error ? e.message : 'некорректный YAML');
    }
  };

  if (yamlMode) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-3">
        <textarea
          value={yamlDraft}
          onChange={(e) => setYamlDraft(e.target.value)}
          rows={Math.max(4, yamlDraft.split('\n').length)}
          spellCheck={false}
          className="w-full resize-y rounded border border-stone-200 p-2 font-mono text-xs focus:border-stone-400 focus:outline-none"
        />
        {yamlError && <div className="mt-1 text-xs text-rose-600">{yamlError}</div>}
        <div className="mt-2 flex gap-2">
          <button onClick={applyYaml} className="rounded bg-stone-900 px-3 py-1 text-xs text-white">
            Применить
          </button>
          <button onClick={() => setYamlMode(false)} className="rounded px-3 py-1 text-xs text-stone-500">
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isTask && (
        <select
          value={frontmatter.status as string}
          onChange={(e) => onChange({ ...frontmatter, status: e.target.value as TaskStatus })}
          className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      )}
      {entries
        .filter(([key]) => !(isTask && key === 'status'))
        .map(([key, value]) => (
          <span
            key={key}
            className="rounded-lg bg-stone-100 px-2 py-1 text-xs text-stone-600"
            title={`${key}: ${formatValue(value)}`}
          >
            <span className="text-stone-400">{key}:</span> {formatValue(value) || '—'}
          </span>
        ))}
      <button onClick={openYaml} className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-100">
        {entries.length > 0 ? 'править YAML' : '+ свойства'}
      </button>
    </div>
  );
}
