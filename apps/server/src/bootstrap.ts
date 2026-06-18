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

Это vault — личная база знаний и задач пользователя. Ты работаешь прямо в
файлах (Read / Glob / Grep / Edit / Write). Источник истины — markdown:
меняешь файлы, а UI и индекс подхватывают изменения сами. Не выдумывай данные,
которых нет в vault.

## Структура

- \`wiki/\` — дистиллированные знания, перелинкованы \`[[wiki-ссылками]]\`;
  \`wiki/index.md\` — карта знаний.
- \`raw/\` — сырьё: заметки, выгрузки, transcripts (по духу append-only).
- \`projects/<slug>/project.md\` + \`projects/<slug>/tasks/NNNN-*.md\` — проекты
  и их задачи.
- \`inbox/\` — неразобранные задачи и заметки.
- \`journal/YYYY-MM-DD.md\` — план дня и итоги.
- \`reports/\` — сгенерированные отчёты.

## Задачи

Задача — это \`.md\`-файл с frontmatter:

    ---
    title: Короткое название
    status: todo            # inbox | todo | in_progress | blocked | done | cancelled
    priority: normal        # low | normal | high | urgent (опц.)
    project: <slug>         # опц.; для задач в projects/<slug>/ не обязателен
    due: 2026-06-20         # опц., дедлайн
    scheduled: 2026-06-17   # опц., на какой день запланирована
    tags: [tag1, tag2]      # опц.
    created: 2026-06-17
    ---

    Контекст, критерии готовности, заметки — свободный markdown.

Правила:

- Все даты — строки формата \`YYYY-MM-DD\`.
- Новую задачу без проекта клади в \`inbox/\`, задачу проекта — в
  \`projects/<slug>/tasks/\`.
- Когда меняешь статус или планируешь задачу — правь frontmatter
  существующего файла, не создавай дубликат.
- Имена файлов — латиницей, kebab-case (например \`review-pr.md\`).

## Проекты

\`projects/<slug>/project.md\`: frontmatter \`title\`, \`status\`, \`due\`, \`created\`;
в теле — цели, риски, ключевые решения.

## Журнал

\`journal/YYYY-MM-DD.md\`: frontmatter \`type: journal\`, \`created\`; в теле —
план на день (чеклист со ссылками на задачи) и место под итоги.

<!-- Личный контекст пользователя: кто он, чем занимается, его конвенции. -->
`,

    'wiki/index.md': `---
okf_version: "0.1"
---

# Карта знаний

OKF-bundle базы знаний (см. docs/OKF.md). Агент-библиотекарь поддерживает
это оглавление дистиллированных страниц.

## Pages

* [Forma](forma.md) — про эту систему
`,

    'wiki/forma.md': `---
type: wiki
title: Forma
description: Локальный AI-воркспейс — база знаний и задачи с агентом.
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

    '.claude/skills/plan-day/SKILL.md': `---
name: plan-day
description: Plan the user's day from tasks in the vault — pick what to do today, set the scheduled date, and write today's journal. Use when the user asks to plan their day ("plan my day", "what should I do today", "спланируй день", "что делать сегодня").
---

# Планирование дня

Когда пользователь просит спланировать день:

1. Определи сегодняшнюю дату в формате YYYY-MM-DD.
2. Собери кандидатов, просматривая \`inbox/\` и \`projects/*/tasks/\`:
   - задачи со scheduled = сегодня;
   - просроченные: due не позже сегодня и статус не done/cancelled;
   - если этого мало — самые приоритетные todo / in_progress
     (по priority, затем по ближайшему due).
3. Собери реалистичный план — обычно не больше 5–7 задач. Выбранным задачам
   проставь scheduled = сегодня, отредактировав frontmatter их файлов.
   Не плоди дубликаты: правь существующие задачи.
4. Создай или обнови \`journal/<сегодня>.md\`:
   - frontmatter type: journal и created: <сегодня>;
   - заголовок с датой;
   - раздел «План на день» — чеклист, каждый пункт ссылается на файл задачи;
   - оставь пустой раздел «Итоги» под конец дня.
5. Коротко отчитайся в чате: что в плане и почему именно это.

Если подходящих задач нет — не выдумывай их, а предложи разобрать \`inbox/\`.
`,

    '.claude/skills/plan-week/SKILL.md': `---
name: plan-week
description: Plan the user's week — review deadlines and open tasks across projects and spread them over the coming days. Use when the user asks to plan their week ("plan my week", "спланируй неделю", "что на этой неделе").
---

# Планирование недели

Когда пользователь просит спланировать неделю:

1. Определи диапазон недели от сегодня (YYYY-MM-DD) на 7 дней вперёд.
2. Просмотри \`projects/*/project.md\` и все задачи в \`projects/*/tasks/\`
   и \`inbox/\`: собери открытые задачи (статус не done/cancelled), их due
   и priority.
3. Распредели задачи по дням недели, отталкиваясь от дедлайнов и приоритетов:
   срочное и просроченное — в начало недели, не перегружай отдельные дни.
   Проставь задачам scheduled на выбранный день, редактируя их frontmatter.
4. Запиши обзор недели: создай или обнови \`journal/<сегодня>.md\` разделом
   «План недели» — по дню на строку со ссылками на задачи. При желании
   пользователя можно вынести в отдельный отчёт в \`reports/\`.
5. Подсвети в чате риски: дни с перегрузом, дедлайны без запаса, конфликты.

Опирайся только на задачи из vault. Если их мало — предложи сначала
разобрать \`inbox/\`.
`,

    '.claude/skills/weekly-review/SKILL.md': `---
name: weekly-review
description: Review the past week — what got done, what slipped, and key decisions — and write a short report. Use when the user asks for a weekly review or retrospective ("weekly review", "итоги недели", "ретро за неделю").
---

# Итоги недели

Когда пользователь просит подвести итоги недели:

1. Определи прошедшую неделю относительно сегодняшней даты (YYYY-MM-DD).
2. Собери факты из vault:
   - задачи, закрытые за неделю (статус done), сгруппированные по проектам;
   - просроченное и зависшее (due прошёл, статус не done; blocked);
   - ключевые решения и заметки из \`journal/\` за эти дни.
3. Сформируй краткий отчёт:
   - сделано (по проектам);
   - не сделано / съехало и почему;
   - решения и выводы;
   - на что обратить внимание на следующей неделе.
4. Сохрани отчёт в \`reports/weekly-<год>-W<номер недели>.md\`
   (frontmatter type: report, created: <сегодня>) и кратко перескажи в чате.

Только факты из vault, без домыслов. Если данных мало — так и скажи.
`,

    '.claude/skills/distill/SKILL.md': `---
name: distill
description: Distill raw notes and chat summaries into linked wiki pages with source references. Use when asked to distill, update the knowledge base, or maintain the wiki ("distill raw", "обнови вики", "законспектируй заметки").
---

# Дистилляция знаний

Преврати сырьё в дистиллированные wiki-страницы. Слой wiki/ ведём как
OKF-bundle (см. docs/OKF.md).

1. Просмотри новое и изменённое в raw/ и выжимки чатов в chats/*/summary.md.
2. Для устойчивых фактов, решений и концепций заведи или обнови страницу в wiki/.
   Frontmatter страницы:
   - type: wiki (обязательно, непустой);
   - title и description (одна строка);
   - sources: пути исходников (raw/..., chats/...).
   Тело — компактно, своими словами, без воды. Перелинковка — относительными
   ссылками [Заголовок](other.md) (переносимо по OKF); [[wiki-ссылки]] тоже ок.
3. Поддерживай wiki/index.md в формате OKF: секции и строки вида
   "* [Заголовок](page.md) — короткое описание". Frontmatter index.md не трогай
   (там только okf_version).
4. Помечай устаревшее прямо в тексте, но не удаляй без явной просьбы.

Имена файлов — латиницей, kebab-case. Не дублируй существующие страницы —
лучше дополни. Источник истины — markdown в vault.
`,

    'agents/secretary.md': `---
name: secretary
trigger:
  type: cron
  schedule: "0 9 * * *"
permissions: vault-write
budget: { maxTurns: 20 }
output: journal/
enabled: false
---

Подготовь короткую утреннюю сводку и запиши её в journal/<сегодня>.md
(создай файл, если его нет; добавь раздел "## Утренняя сводка", не затирая
существующее содержимое).

Что включить:
- задачи на сегодня: scheduled = сегодня и просроченные (due не позже сегодня,
  статус не done/cancelled);
- ближайшие дедлайны на неделю вперёд;
- что лежит в inbox и просится в разбор.

Будь краток: 5–8 пунктов, по делу. Не меняй статусы задач и ничего не удаляй.
`,

    'agents/janitor.md': `---
name: janitor
trigger:
  type: cron
  schedule: "0 18 * * *"
permissions: vault-write
budget: { maxTurns: 20 }
output: journal/
enabled: false
---

Найди и подсвети то, что требует внимания, и запиши краткий список в
journal/<сегодня>.md под разделом "## Напоминания" (создай файл при
необходимости, не затирай существующее содержимое).

На что смотреть:
- просроченные задачи: due раньше сегодня и статус не done/cancelled;
- задачи, давно висящие в in_progress или blocked без движения;
- задачи без срока, которые стоит запланировать.

Только подсвечивай. Не меняй статусы и ничего не удаляй без явной просьбы.
`,

    'agents/librarian.md': `---
name: librarian
trigger:
  type: cron
  schedule: "0 2 * * *"
permissions: vault-write
budget: { maxTurns: 40 }
output: wiki/
enabled: false
---

Поддерживай базу знаний (используй подход навыка distill).

Просмотри новое в raw/ и выжимки в chats/*/summary.md, обнови или создай
страницы в wiki/ с frontmatter sources:, поддержи карту wiki/index.md.
Работай инкрементально: не переписывай всё, дополняй. Если нового нет —
ничего не меняй.
`,

    'agents/weekly-report.md': `---
name: weekly-report
trigger:
  type: cron
  schedule: "0 18 * * 5"
permissions: vault-write
budget: { maxTurns: 40 }
output: reports/
enabled: false
---

Собери отчёт за неделю (используй подход навыка weekly-review): закрытые и
просроченные задачи по проектам из projects/, ключевые решения из journal/.
Сохрани в reports/weekly-<год>-W<номер недели>.md (frontmatter type: report,
created: <сегодня>). Кратко и по делу.
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
