# Forma — план работ

Статус на 2026-06-13. Архитектура — в [ARCHITECTURE.md](ARCHITECTURE.md),
конвенции для агентов — в корневом [CLAUDE.md](../CLAUDE.md).

## Сделано: фаза 0 «Скелет» ✅

- Монорепо npm workspaces: `packages/core`, `apps/server`, `apps/web`.
- Vault: bootstrap структуры и стартового контента, атомарная запись,
  оптимистичная блокировка (409), защита от path traversal.
- Индекс: `node:sqlite` + FTS5 (documents/tasks/projects/docs_fts),
  chokidar-вотчер внешних правок, кириллический поиск со снипетами.
- REST + SSE: `/api/tree|doc|tasks|task|projects|search|events`.
- UI: задачи (фильтры, группировка, быстрый ввод в inbox, смена статуса),
  проекты (карточки с прогрессом), документы (дерево + TipTap-редактор
  поверх markdown, панель frontmatter, обработка внешних изменений файла).

Проверено: typecheck, прод-сборка, smoke всех эндпоинтов, вотчер, прокси.

---

## Фаза 1 «Агент» — следующая

Цель: интерактивный чат с агентом, который управляет vault; дашборд «Сегодня».
Главный сценарий: «разбери inbox», «спланируй мой день».

### 1.1 `packages/agent` — абстракция и Claude-провайдер

- Интерфейсы `AgentProvider` / `AgentSession` (ARCHITECTURE §4):
  `send() → AsyncIterable<AgentEvent>`, `interrupt()`, resume по sessionId.
- События: `text_delta`, `tool_use`, `tool_result`, `permission_request`,
  `result` (со стоимостью/turns), `error`.
- Реализация на `@anthropic-ai/claude-agent-sdk`: `cwd` = vault,
  системный контекст из `vault/.claude/CLAUDE.md` подхватывается SDK.
- Авторизация: ANTHROPIC_API_KEY из env ИЛИ существующий логин Claude Code
  (SDK умеет CLI-авторизацию) — задокументировать в README.
- Профили разрешений: `read-only` / `vault-write` / `full` →
  маппинг на permission-настройки SDK; запрет записи вне vault.
- ✓ Критерий: смоук-скрипт — сессия отвечает и создаёт файл в тестовом vault.

### 1.2 Server: AgentRuntime + API

- `POST /api/agent/sessions` — создать сессию (опц. `docPath` для контекста).
- `POST /api/agent/sessions/:id/messages` — сообщение пользователя.
- `GET  /api/agent/sessions/:id/stream` — SSE событий сессии.
- `POST /api/agent/sessions/:id/permissions/:reqId` — allow/deny.
- `POST /api/agent/sessions/:id/interrupt`.
- `GET  /api/agent/sessions` — список сессий (читается из `vault/chats/`).
- Персист: `vault/chats/<YYYY-MM-DD>-<slug>/transcript.jsonl` (события),
  `meta.md` (frontmatter: started, cost, turns, title).
- Очередь: лимит параллельных сессий (по умолчанию 2), таймаут/maxTurns.
- ✓ Критерий: curl-сценарий «создай задачу X в inbox» → файл появился,
  события стримятся, transcript сохранён.

### 1.3 Web: чат

- Правая панель-чат (toggle, ширина ~380px), доступна с любой страницы.
- Стриминг markdown-ответа; tool-calls видимы свёрнутыми строками
  («читает projects/...», «правит inbox/...»).
- Inline-подтверждение permission_request (кнопки разрешить/отклонить).
- Список прошлых сессий + продолжение (resume).
- Из редактора документа — кнопка «обсудить с агентом» (передаёт docPath).
- ✓ Критерий: задача, созданная агентом из чата, сразу видна в списке задач
  (SSE-инвалидация уже работает).

### 1.4 Контекст агента в vault

- Дополнить `vault/.claude/CLAUDE.md`: формат задач/проектов, правила
  (создавать задачи в inbox или projects/*/tasks, статусы, даты).
- Первые skills в `vault/.claude/skills/`: `plan-day`, `plan-week`,
  `weekly-review` (markdown-инструкции).
- ✓ Критерий: «спланируй мой день» создаёт/обновляет `journal/YYYY-MM-DD.md`
  и проставляет `scheduled` у задач.

### 1.5 Дашборд «Сегодня»

- Маршрут `/today` (сделать стартовым вместо `/tasks`): задачи на сегодня
  (scheduled=today + просроченные due), журнал дня (рендер markdown),
  кнопка «спланировать день» → открывает чат с готовым промптом.
- ✓ Критерий: утренний сценарий целиком в одном экране.

Рекомендуемый порядок: 1.1 → 1.2 → 1.3, затем 1.4/1.5 параллельно.

---

## Фаза 2 «Автономия»

- Scheduler (croner) в сервере; определения агентов — `vault/agents/*.md`
  (frontmatter: trigger cron|event|manual, permissions, budget, output).
- Журнал запусков `.forma/runs/<agent>/<ts>.jsonl` + UI: список агентов,
  запуски, стоимость, кнопка «запустить сейчас», редактор определения.
- Встроенные агенты файлами: `secretary` (утренняя сводка),
  `janitor` (просроченные задачи, напоминания).
- Событийные триггеры: glob по vault (новый файл в `inbox/`), webhook-эндпоинт.
- UI настроек: управление `vault/.claude/mcp.json` (добавить MCP-сервер,
  проверить подключение, список инструментов) и skills. Секреты — только
  ссылки на env-переменные, не в vault.

## Фаза 3 «Знания»

- Агент-`librarian` (по расписанию): дистилляция `raw/` + `chats/` → `wiki/`,
  поддержка `wiki/index.md`, frontmatter `sources:`.
- Автовыжимки завершённых чат-сессий → `chats/*/summary.md` + факты в `raw/`.
- Отчёты (`weekly-report` агент) и weekly-review сценарий в чате.
- Бэклинки и `[[wiki-links]]`: таблица links в индексе, автодополнение
  в редакторе, панель «ссылается сюда».

## Фаза 4 «Десктоп»

- Tauri 2: web как фронт, server как sidecar-процесс; иконка, автостарт.
- Секреты в macOS Keychain; выбор/создание vault при первом запуске.

---

## Техдолг и улучшения (вне фаз, брать по возможности)

1. **Тесты** (приоритет, лучше до фазы 1): vitest; core — round-trip
   frontmatter (даты!), detectKind, taskFromDoc; server — VaultService
   (traversal, конфликты), IndexService (переиндексация, запросы).
2. **Git-интеграция vault** (simple-git): `git init` при bootstrap,
   автокоммит после агентских сессий и батч-коммиты ручных правок.
3. Rename/move документов (API + UI), создание из дерева по правому клику.
4. Kanban-доска внутри проекта (сейчас только список задач с фильтром).
5. Code-splitting (manualChunks для TipTap, ~880KB бандл) и апгрейд на
   Vite 7 (закрывает dev-only advisory esbuild).
6. Виртуализация длинных списков задач; пагинация поиска.
7. Конфиг приложения `~/.forma/config.json` (путь к vault, порт) вместо env.
