import fs from 'node:fs/promises';
import path from 'node:path';
import type { VaultService } from './vault.js';

// Zonal layout — see docs/DATA-MODEL.md.
const DIRS = [
  'knowledge/inbox',
  'knowledge/raw',
  'knowledge/wiki',
  'work/inbox',
  'work/projects',
  'work/areas',
  'work/archive',
  'memory/preferences',
  'memory/recipes',
  'memory/facts',
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

## Зоны (важно не смешивать)

- \`knowledge/\` — «второй мозг», который ведёшь ты:
  - \`knowledge/inbox/\` — свалка источников от пользователя (статьи, выгрузки,
    файлы), которые ждут разбора;
  - \`knowledge/raw/\` — архив уже обработанных источников (на них ссылается wiki);
  - \`knowledge/wiki/\` — дистиллированные знания, \`wiki/index.md\` — карта.
- \`work/\` — дела пользователя (его владение):
  - \`work/inbox/\` — неразобранные задачи/заметки;
  - \`work/projects/<slug>/project.md\` + \`tasks/NNNN-*.md\` — проекты и задачи;
  - \`work/areas/<slug>/\` — бессрочные области ответственности (\`area.md\` опц.);
  - \`work/archive/\` — завершённое/неактивное.
- \`memory/\` — то, что ты выучил сам (предпочтения, рецепты, факты). Подпапки
  \`preferences/ recipes/ facts/\`. Это твоя память, не знания пользователя.
- \`journal/\`, \`chats/\`, \`reports/\` — операционное.

Поиск/выдача по доменам: вопрос «по знаниям» → ищи в \`knowledge/\`; планирование
и ведение дел → \`work/\`; «как ты обычно делаешь X» → \`memory/\`. Не подмешивай
задачи пользователя в ответы по знаниям и наоборот.

## Задачи

Задача — это \`.md\`-файл с frontmatter:

    ---
    title: Короткое название
    status: todo            # inbox | todo | in_progress | blocked | done | cancelled
    priority: normal        # low | normal | high | urgent (опц.)
    project: <slug>         # опц.; для задач в work/projects/<slug>/ не обязателен
    area: <slug>            # опц.
    due: 2026-06-20         # опц., дедлайн
    scheduled: 2026-06-17   # опц., на какой день запланирована
    depends_on: [t-0002]    # опц., зависимости
    tags: [tag1, tag2]      # опц.
    created: 2026-06-17
    ---

    Контекст, критерии готовности, заметки — свободный markdown.

Правила:

- Все даты — строки формата \`YYYY-MM-DD\`.
- Новую задачу без проекта клади в \`work/inbox/\`, задачу проекта — в
  \`work/projects/<slug>/tasks/\`.
- Трекаемая задача = файл; мелкие подшаги — чекбоксы \`- [ ]\` внутри файла.
  При разборе \`work/inbox/\` повышай нужное до файла-задачи.
- Меняешь статус/план — правь frontmatter существующего файла, не дублируй.
- Имена файлов — латиницей, kebab-case (например \`review-pr.md\`).

## Проекты и области

\`work/projects/<slug>/project.md\`: frontmatter \`title\`, \`status\`
(active|paused|done|archived), \`due\`, \`created\`; в теле — цели, риски, решения.
Область — папка \`work/areas/<slug>/\`; \`area.md\` опционален.

## Журнал

\`journal/YYYY-MM-DD.md\`: frontmatter \`type: journal\`, \`created\`; в теле —
план на день (чеклист со ссылками на задачи) и место под итоги.

<!-- Личный контекст пользователя: кто он, чем занимается, его конвенции. -->
`,

    'knowledge/inbox/README.md': `---
title: Knowledge inbox
---

Кидай сюда статьи, выгрузки, файлы — всё, что нужно занести во «второй мозг».
Librarian-агент разберёт: дистиллирует в \`knowledge/wiki/\`, а сам источник
переедет в \`knowledge/raw/\`. То, что осталось здесь, — ещё не разобрано.
`,

    'knowledge/wiki/index.md': `---
okf_version: "0.1"
---

# Карта знаний

OKF-bundle базы знаний (см. docs/OKF.md). Агент-библиотекарь поддерживает
это оглавление дистиллированных страниц.

## Pages

* [Forma](forma.md) — про эту систему
`,

    'knowledge/wiki/forma.md': `---
type: wiki
title: Forma
description: Локальный AI-воркспейс — база знаний и задачи с агентом.
sources: []
---

# Forma

Локальный AI-воркспейс: база знаний (\`knowledge/\`) и дела (\`work/\`),
интеллектуальная работа делегируется подключённому агенту.
`,

    'work/inbox/welcome.md': `---
title: Разобрать первые заметки
status: inbox
created: ${today()}
---

\`work/inbox/\` — место для всего неразобранного по делам. Агент помогает
превращать это в задачи и проекты. (Источники знаний — в \`knowledge/inbox/\`.)
`,

    'work/projects/forma-mvp/project.md': `---
title: Forma MVP
status: active
due: ${today().slice(0, 4)}-12-31
created: ${today()}
---

# Forma MVP

Довести Forma до ежедневно используемого инструмента.

## Цели

- Вести задачи и знания в одном месте
- Подключить агента для планирования и разбора inbox
`,

    'work/projects/forma-mvp/tasks/0001-try-the-ui.md': `---
id: t-0001
title: Осмотреться в интерфейсе Forma
status: todo
priority: normal
scheduled: ${today()}
created: ${today()}
---

Открыть дашборды задач и проектов, создать свой первый документ в knowledge/wiki/.
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
2. Собери кандидатов, просматривая \`work/inbox/\` и \`work/projects/*/tasks/\`:
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

Если подходящих задач нет — не выдумывай их, а предложи разобрать \`work/inbox/\`.
`,

    '.claude/skills/plan-week/SKILL.md': `---
name: plan-week
description: Plan the user's week — review deadlines and open tasks across projects and spread them over the coming days. Use when the user asks to plan their week ("plan my week", "спланируй неделю", "что на этой неделе").
---

# Планирование недели

Когда пользователь просит спланировать неделю:

1. Определи диапазон недели от сегодня (YYYY-MM-DD) на 7 дней вперёд.
2. Просмотри \`work/projects/*/project.md\` и все задачи в
   \`work/projects/*/tasks/\` и \`work/inbox/\`: собери открытые задачи
   (статус не done/cancelled), их due и priority.
3. Распредели задачи по дням недели, отталкиваясь от дедлайнов и приоритетов:
   срочное и просроченное — в начало недели, не перегружай отдельные дни.
   Проставь задачам scheduled на выбранный день, редактируя их frontmatter.
4. Запиши обзор недели: создай или обнови \`journal/<сегодня>.md\` разделом
   «План недели» — по дню на строку со ссылками на задачи. При желании
   пользователя можно вынести в отдельный отчёт в \`reports/\`.
5. Подсвети в чате риски: дни с перегрузом, дедлайны без запаса, конфликты.

Опирайся только на задачи из vault. Если их мало — предложи сначала
разобрать \`work/inbox/\`.
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
description: Distill items from the knowledge inbox into linked wiki pages with source references, then archive the sources. Use when asked to process the knowledge inbox or maintain the wiki ("distill inbox", "обнови вики", "разбери knowledge-инбокс").
---

# Дистилляция знаний

Преврати источники в дистиллированные wiki-страницы. Слой \`knowledge/wiki/\`
ведём как OKF-bundle (см. docs/OKF.md).

1. Просмотри новое в \`knowledge/inbox/\` и выжимки чатов в \`chats/*/summary.md\`.
   (Для не-markdown файлов извлеки содержимое инструментами чтения.)
2. Для устойчивых фактов, решений и концепций заведи или обнови страницу в
   \`knowledge/wiki/\`. Frontmatter страницы:
   - type: wiki (обязательно, непустой);
   - title и description (одна строка);
   - sources: пути исходников (knowledge/raw/..., chats/...).
   Тело — компактно, своими словами, без воды. Перелинковка — относительными
   ссылками [Заголовок](other.md) (переносимо по OKF); [[wiki-ссылки]] тоже ок.
3. Поддерживай \`knowledge/wiki/index.md\` в формате OKF: секции и строки вида
   "* [Заголовок](page.md) — короткое описание". Frontmatter index.md не трогай.
4. Обработанный источник перенеси \`knowledge/inbox/\` → \`knowledge/raw/\`
   (он остаётся как цитируемый источник). Инбокс должен пустеть.

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
  статус не done/cancelled) из work/projects/ и work/inbox/;
- ближайшие дедлайны на неделю вперёд;
- что лежит в work/inbox и просится в разбор.

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

Поддерживай гигиену дел и подсвечивай важное; запиши краткий список в
journal/<сегодня>.md под разделом "## Напоминания" (создай файл при
необходимости, не затирай существующее содержимое).

На что смотреть в work/:
- просроченные задачи: due раньше сегодня и статус не done/cancelled;
- задачи, давно висящие в in_progress или blocked без движения;
- задачи без срока, которые стоит запланировать.

Архивация (по явному разрешению): давно завершённые проекты/задачи
(status: done/archived) переноси из work/projects|areas в work/archive,
сохраняя структуру. Только подсвечивай статусы — не меняй и не удаляй без просьбы.
`,

    'agents/librarian.md': `---
name: librarian
trigger:
  type: cron
  schedule: "0 2 * * *"
permissions: vault-write
budget: { maxTurns: 40 }
output: knowledge/wiki/
enabled: false
---

Поддерживай базу знаний (используй подход навыка distill).

Разбери новое в knowledge/inbox/ и выжимки в chats/*/summary.md: обнови или
создай страницы в knowledge/wiki/ с frontmatter sources:, поддержи карту
knowledge/wiki/index.md, а обработанные источники перенеси в knowledge/raw/.
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
просроченные задачи по проектам из work/projects/, ключевые решения из journal/.
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
