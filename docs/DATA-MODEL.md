# Forma — модель данных

Детальная спецификация хранения. Дополняет [ARCHITECTURE.md](ARCHITECTURE.md)
(высокоуровневая картина) и задаёт инварианты для `detectKind`, bootstrap,
индекса и агентских воркфлоу. Статус: **черновик для согласования** (раскладка
зон утверждена, схемы frontmatter и миграция — обсуждаются).

## 1. Принцип: три эстейта + ops

Данные различаются по двум осям — **кто источник истины** и **в каком домене
это ищется**. Поэтому не одно дерево «документов», а зоны:

| Зона | `zone` | Владелец истины | Что | Домен поиска | Роль агента |
|---|---|---|---|---|---|
| Knowledge (Resources) | `knowledge` | агент курирует | `raw/` источники + `wiki/` дистиллят | RAG для вопросов | строит, дистиллирует |
| Work (Projects/Areas) | `work` | **пользователь** | проекты, области, задачи, доки | планирование, доски, поиск по работе | оперирует, поддерживает |
| Memory | `memory` | агент | выученные рецепты/предпочтения/факты | recall «как делать» | накапливает |
| Ops | `ops` | система | journal, chats, reports, agents | — | рантайм |

**Главный инвариант — разделение доменов поиска.** Зона выводится из верхней
папки (как сейчас в `detectKind`), руками не проставляется: физическое
размещение = логическая зона.

- Вопрос по знаниям → ищем только `zone=knowledge`. Работа и память не подмешиваются.
- Планирование → только `zone=work`.
- «Как ты обычно делаешь X» → только `zone=memory`.

Пользовательские доки **индексируются** (чтобы доски/поиск/планирование
работали), но в отдельной дорожке `work` — в knowledge-RAG они не попадают,
пока пользователь явно не дистиллирует в `wiki/`.

## 2. Раскладка vault (PARA)

```
vault/
├── knowledge/                  # Resources — агентский «второй мозг»
│   ├── inbox/                  # ⬇︎ СВАЛКА: кидаешь сюда страницы/доки/файлы, без агента
│   │   └── 2026-06-13-some-article.md
│   ├── raw/                    # архив УЖЕ обработанных источников (wiki ссылается сюда)
│   │   └── 2026-06-13-arc-vfs.md
│   ├── log.md                  # append-only хроника ингеста (ведёт librarian)
│   └── wiki/                   # дистиллят
│       ├── index.md            # карта знаний (агент поддерживает)
│       └── arc/vfs-design.md
├── work/                       # пользовательское — НЕ knowledge-RAG
│   ├── inbox/                  # триаж: задачи/заметки в любом виде, дефолт капчера
│   ├── projects/<slug>/        # P: цель + срок
│   │   ├── project.md
│   │   ├── tasks/NNNN-title.md
│   │   └── notes/...
│   ├── areas/<slug>/           # A: бессрочная ответственность
│   │   └── area.md
│   └── archive/                # done/inactive P и A (перенос janitor'ом)
│       └── projects/<slug>/...
├── memory/                     # выученное агентом (подпапки по kind)
│   ├── preferences/planning.md
│   ├── recipes/inbox-triage.md
│   └── facts/people.md
├── journal/                    # ops: дневные планы/итоги YYYY-MM-DD.md
├── chats/                      # ops: история диалогов
├── reports/                    # ops: сгенерированные отчёты
├── agents/                     # ops: пользовательские определения агентов
├── .claude/                    # CLAUDE.md, skills/, mcp.json
└── .forma/                     # index.db, runs/ (gitignored)
```

Два инбокса по намерению: **`work/inbox/`** (actionable — разобрать в проекты/задачи)
и **`knowledge/inbox/`** (reference — ингест во второй мозг).

### Воркфлоу ингеста знаний (сценарии 1–2)

Сценарий: пользователь **без агента** кидает несвязанные страницы/доки/файлы,
потом хочет, чтобы агент это обработал и положил во второй мозг.

1. **Свалка.** Кидаешь что угодно в `knowledge/inbox/` — в любой момент, без
   структуры, можно несвязанное. Принимаются `.md`/текст; для прочего (PDF,
   html, картинка) агент извлечёт содержимое. (Сценарий 1: система сама
   скачивает страницу/файл — кладёт сюда же.)
2. **Триггер.** Librarian-агент запускается на добавление файлов в
   `knowledge/inbox/**` (event-trigger, дебаунс/батч) — то есть **сам**, без
   твоего участия. Плюс ручное «разбери knowledge-инбокс».
3. **Дистилляция.** Для каждого элемента: читает → определяет тему(ы) →
   создаёт/**обновляет** нужную `wiki/<topic>.md` (мёрж, не дубли) → проставляет
   `sources:` → обновляет `wiki/index.md`.
4. **Дренаж.** Обработанный источник **переезжает** `knowledge/inbox/` →
   `knowledge/raw/`. Инбокс на глазах пустеет; «что ждёт обработки» = что лежит в
   `inbox/`. `raw/` — архив источников, на которые ссылается wiki.

Итог: ты просто бросаешь в одну папку и забываешь; второй мозг наполняется сам,
а очередь видна как содержимое `knowledge/inbox/`.

## 3. Виды документов (`kind`) и вывод зоны

`kind` определяется `detectKind(path, frontmatter)` — явный `type:` главнее, иначе
по пути. Зона — из верхней папки.

| Путь | `kind` | `zone` |
|---|---|---|
| `knowledge/inbox/**` | `raw` | knowledge |
| `knowledge/raw/**` | `raw` | knowledge |
| `knowledge/wiki/**` | `wiki` | knowledge |
| `work/projects/<slug>/project.md` | `project` | work |
| `work/projects/<slug>/tasks/**` | `task` | work |
| `work/areas/<slug>/area.md` | `area` (файл опционален) | work |
| `work/areas/<slug>/**` (без area.md) | `note` | work |
| `work/inbox/**` | `task` (если есть `status`) иначе `note` | work |
| `work/archive/**` | как исходный (`project`/`task`/`area`), `status: archived` | work |
| `memory/**` | `memory` | memory |
| `journal/**` | `journal` | ops |
| `chats/**` | `chat` | ops |
| `reports/**` | `report` | ops |
| `agents/**` | `agent` | ops |

Новые относительно текущего: `area`, `memory`. Индекс получает столбец `zone`.

## 4. Задачи: файлы + чекбоксы + promotion

- **Трекаемая задача = файл** `.md` с frontmatter — единица доски, планирования,
  зависимостей, истории (git). Агент дописывает прогресс в тело.
- **Чекбокс `- [ ]` = инлайн-подшаг** внутри задачи/проекта/заметки. Не отдельная
  сущность; индексатор может парсить их в файле задачи → прогресс-бар.
- **Promotion**: пользователь кидает в `work/inbox/` что угодно (чек-лист, абзац,
  «стори»); при триаже агент повышает нужное до файла-задачи (id, status, project,
  due). Лёгкое остаётся чекбоксами.

## 5. Схемы frontmatter

Даты — строки `YYYY-MM-DD`. `*` — опционально.

**Task** (`work/.../tasks/NNNN-*.md`, `work/inbox/*`)
```yaml
id: t-0001
title: …
status: inbox|todo|in_progress|blocked|done|cancelled
project: <slug>*          # или area
area: <slug>*
priority: low|normal|high|urgent*
due: 2026-06-20*
scheduled: 2026-06-16*
depends_on: [t-0002]*     # для разблокировок/критического пути
tags: [...]*
source: chat:… | mail:… | tracker:ABC-123*
external_id: ABC-123*     # зеркало внешней системы
created: 2026-06-13
started: …*  done_at: …*  archived_at: …*
```

**Project** (`work/projects/<slug>/project.md`)
```yaml
type: project
title: …
status: active|paused|done|archived
area: <slug>*
goal: …
due: …*  started: …*
risks: …*  sources: [...]*       # ссылки на knowledge, если есть
```

**Area** (`work/areas/<slug>/area.md`)
```yaml
type: area
title: …
status: active|archived
review_cadence: weekly|monthly|quarterly*
```

**Wiki** (`knowledge/wiki/**`)
```yaml
type: wiki*               # обычно по пути
title: …
sources: [knowledge/raw/…, https://…]   # откуда дистиллировано
updated: 2026-06-13
```

**Raw** (`knowledge/raw/**`)
```yaml
type: raw*
title: …
source: https://… | mail:… | file
captured: 2026-06-13
distilled: false          # librarian ставит true, когда учтено в wiki
tags: [...]*
```

**Memory** (`memory/**`)
```yaml
type: memory
kind: preference|recipe|fact
title: …
scope: planning|writing|review|…*
created: 2026-06-13
confidence: low|medium|high*
```

## 6. Lifecycle и зависимости

- Статусы задач — как выше; проекты/области — `active|paused|done|archived`.
- **Архив = физический перенос** `work/projects/<slug>` → `work/archive/projects/<slug>`
  janitor-агентом (раз в N дней уносит давно-`done`). Активные виды фильтруют по
  статусу; архив в git (история сохранена), но **исключён** из планирования и RAG.
- **Зависимости**: `depends_on` + таблица `deps` в индексе → агент видит «разблокировалось»,
  просрочки с хвостом, критический путь (сценарий 9).

## 7. Память агента (отдельно от wiki и skills)

- **Skills** (`.claude/skills/`) — заранее написанные пользователем процедуры.
- **Knowledge/wiki** — знания о предметке/мире.
- **Memory** (`memory/`) — выученное агентом: трактовки запросов пользователя,
  сработавшие рецепты, конвенции, предпочтения по планированию. Маленькие `.md`,
  агент дописывает после сессий; рантайм подмешивает релевантные. Вне RAG и вне work.

## 8. Внешние системы (MCP)

Выбранные внешние тикеты **зеркалятся** в файлы-задачи (`source`, `external_id`),
чтобы участвовать в планировании; sync-агент держит статус. Внешняя система —
источник истины, файл — «планировочная тень».

## 9. Домены поиска по сценариям

| Сценарий | Зона(ы) |
|---|---|
| Вопрос по накопленным знаниям (3) | `knowledge` (wiki → raw) |
| Планирование дня/недели/квартала (8), ведение задач (9) | `work` |
| «Как ты обычно делаешь X» | `memory` |
| Глобальный поиск в UI | все зоны, сгруппировано/помечено по zone |

## 10. Миграция и bootstrap

Текущая раскладка плоская (`wiki/ raw/ projects/ inbox/ journal/…`). Переход:

| Сейчас | Станет |
|---|---|
| `wiki/**` | `knowledge/wiki/**` |
| `raw/**` | `knowledge/raw/**` (архив источников) |
| `projects/**` | `work/projects/**` |
| `inbox/**` | `work/inbox/**` |
| (нет, пустые) | `knowledge/inbox/`, `work/areas/`, `work/archive/`, `memory/{preferences,recipes,facts}/` |
| `journal/ chats/ reports/ agents/ .claude/ .forma/` | без изменений |

- `detectKind`, `bootstrap`, индекс (`zone`, `area`, `deps`) — обновить под §3/§5.
- Миграция существующего vault — одноразовый скрипт (move + правка путей в ссылках,
  переиспользуя логику rename/move).
- Bootstrap нового vault — генерирует структуру §2 с seed-контентом и зональными
  README, чтобы при первом запуске сразу была правильная раскладка.

## 11. Решено

- **Area**: `area.md` опционален — область может быть просто папкой-контейнером;
  файл есть, если у области есть цель/ритм ревью.
- **`memory/`**: подпапки по `kind` (`preferences/`, `recipes/`, `facts/`).
- **Глобальный поиск**: единый список с метками зоны `[knowledge]/[work]/…`;
  фильтрация по area/zone — позже.
- **Knowledge-инбокс**: явный `knowledge/inbox/` (drain-able), `raw/` — архив
  обработанных источников. См. воркфлоу в §2.
