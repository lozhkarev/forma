import fs from 'node:fs/promises';
import path from 'node:path';
import type { VaultService } from './vault.js';

const DIRS = [
  'wiki',
  'raw',
  'projects',
  'inbox',
  'journal',
  'chats',
  'agents',
  'reports',
  '.claude/skills',
  '.forma',
];

const today = () => new Date().toISOString().slice(0, 10);

/** Стартовые файлы — пишутся только если файла ещё нет. */
function starterFiles(): Record<string, string> {
  return {
    '.gitignore': `.forma/\n.DS_Store\n`,

    '.claude/CLAUDE.md': `# Контекст для агента Forma

Это vault — база знаний и задач пользователя. Структура:

- \`wiki/\` — дистиллированные знания, перелинкованы [[wiki-ссылками]]
- \`raw/\` — сырые материалы: заметки, выгрузки, transcripts
- \`projects/<slug>/project.md\` + \`projects/<slug>/tasks/\` — проекты и их задачи
- \`inbox/\` — неразобранные задачи и заметки
- \`journal/YYYY-MM-DD.md\` — дневные планы и итоги

Задача — это .md файл с frontmatter: \`status\` (inbox|todo|in_progress|blocked|done|cancelled),
\`due\`, \`scheduled\`, \`project\`, \`priority\`, \`tags\`. Даты — строки YYYY-MM-DD.

<!-- Добавьте сюда личный контекст: кто вы, чем занимаетесь, конвенции. -->
`,

    'wiki/index.md': `# Карта знаний

Стартовая точка базы знаний. Здесь агент-библиотекарь поддерживает
оглавление дистиллированных страниц.

- [[forma]] — про эту систему
`,

    'wiki/forma.md': `---
title: Forma
sources: []
---

# Forma

Локальный AI-воркспейс: база знаний (wiki + raw) и проектные задачи,
интеллектуальная работа делегируется подключённому агенту.
`,

    'projects/forma-mvp/project.md': `---
title: Forma MVP
status: in_progress
due: ${today().slice(0, 4)}-12-31
created: ${today()}
---

# Forma MVP

Довести Forma до ежедневно используемого инструмента.

## Цели

- Вести задачи и знания в одном месте
- Подключить агента для планирования и разбора inbox
`,

    'projects/forma-mvp/tasks/0001-try-the-ui.md': `---
id: t-0001
title: Осмотреться в интерфейсе Forma
status: todo
priority: normal
scheduled: ${today()}
created: ${today()}
---

Открыть дашборды задач и проектов, создать свой первый документ в wiki/.
`,

    'inbox/welcome.md': `---
title: Разобрать первые заметки
status: inbox
created: ${today()}
---

Inbox — место для всего неразобранного. Агент (фаза 1) будет помогать
превращать это в задачи и знания.
`,

    [`journal/${today()}.md`]: `---
type: journal
created: ${today()}
---

# ${today()}

Первый день Forma.
`,
  };
}

export async function bootstrapVault(vault: VaultService): Promise<void> {
  for (const dir of DIRS) {
    await fs.mkdir(path.join(vault.root, dir), { recursive: true });
  }
  for (const [relPath, content] of Object.entries(starterFiles())) {
    const abs = path.join(vault.root, relPath);
    try {
      await fs.stat(abs);
    } catch {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    }
  }
}
