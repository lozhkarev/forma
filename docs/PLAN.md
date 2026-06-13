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

## Фаза 1 «Агент» — в работе

Цель: интерактивный чат с агентом, который управляет vault; дашборд «Сегодня».
Главный сценарий: «разбери inbox», «спланируй мой день».

### 1.1 `packages/agent` — абстракция и Claude-провайдер ✅

Сделано: `AgentProvider`/`AgentSession`/`AgentEvent` (types.ts), Channel/Gate
для демультиплексирования стрима (channel.ts), `ClaudeAgentProvider` на
@anthropic-ai/claude-agent-sdk (claude.ts) — streaming-input сессия, перевод
SDK-сообщений в нормализованные события, профили разрешений read-only/
vault-write/full с canUseTool и guard'ом «писать только внутри vault»,
resume по sessionId, бюджеты maxTurns/maxCostUsd. Смоук-скрипт (smoke.ts).

Заметки для 1.2: текстовые дельты идут из stream_event (includePartialMessages),
полный assistant-блок используем только для tool_use. Модель не хардкожена —
по умолчанию берётся из SDK; переопределяется SessionOptions.model.

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

### 1.2 Server: AgentRuntime + API ✅

Сделано: `AgentRuntime`/`RuntimeSession` (runtime.ts), маршруты (agent-api.ts),
смонтированы как `/api/agent/*`. Эндпоинты:
- `POST /api/agent/sessions` — создать (body: permission, contextDocPath,
  model) или `{resume: <id>}` — переподключиться к сохранённому чату.
- `GET  /api/agent/sessions` — список (из `chats/<id>/meta.md`), newest-first.
- `GET  /api/agent/sessions/:id` — summary + полный transcript (для истории).
- `POST /api/agent/sessions/:id/messages` — сообщение (202, ход в фоне).
- `GET  /api/agent/sessions/:id/stream` — SSE: реплей буфера + live (event: record).
- `POST /api/agent/sessions/:id/permissions/:reqId` — {decision: allow|deny}.
- `POST /api/agent/sessions/:id/interrupt`.

Персист: `chats/<YYYY-MM-DD>-<rand>/transcript.jsonl` (по записи на событие,
включая user) + `meta.md` (frontmatter: type, title, started, lastActive,
providerSessionId, permission, costUsd, turns). Очередь: глобальный семафор
(FORMA_MAX_CONCURRENT=2) + посменная обработка на сессию; бюджеты
FORMA_MAX_TURNS/FORMA_MAX_COST_USD; модель FORMA_AGENT_MODEL (def sonnet).

✓ Проверено вживую: create → SSE-стрим (user/session/tool_use/tool_result/
text_delta/result) → агент создал inbox/buy-milk.md (попал в индекс) →
transcript сохранён, listSessions читает чаты. PASS.

Заметки для 1.3 (web): SSE отдаёт `event: record` с `{t, record}`, где record —
наш `AgentEvent` или `{type:'user',text}`. Поток сообщения: POST messages
(быстрый 202) → события прилетают по уже открытому stream. permission_request
→ показать кнопки → POST permissions/:reqId. Файлы, которые агент создаёт в
vault, уже инвалидируют списки задач через существующий `/api/events`.

### 1.3 Web: чат ✅

Сделано: правая панель-чат (ChatPanel), смонтирована один раз в Layout
(переживает смену роутов), toggle «Agent» в сайдбаре. Минималистичный инпут
«Do anything» (ChatInput) с автоgrowth, профиль разрешений снизу, кнопки
send/stop. Стриминг через EventSource (`/stream`), сборка событий в
сообщения — чистая `foldRecords` (lib/chat.ts, тесты офлайн): текстовые
дельты склеиваются, tool-calls — свёрнутые строки с описанием
(`describeTool`), permission_request — карточка Allow/Deny, result —
разделитель с turns/cost. История сессий (resume), кнопка «✦ Discuss» в
редакторе (передаёт docPath как контекст). Фаза-0 UI переведена на английский
(техдолг №0 закрыт; в коде остались только русские комментарии).

✓ Проверено: typecheck, прод-сборка, foldRecords офлайн, vite-трансформы всех
модулей, полный цикл чата через vite-proxy (как в браузере) — агент создал
inbox/proxy-test.md, событие пришло по SSE, задача в индексе. PASS.

Оставлено на потом (техдолг): рендер markdown в ответах (сейчас pre-wrap
текст), смена профиля разрешений на лету (сейчас фиксируется при создании).

--- исходный план задачи ниже ---

### 1.3 Web: чат (исходные требования)

- Правая панель-чат (toggle, ширина ~380px), доступна с любой страницы.
- Минималистичный инпут в духе референса пользователя: одна растущая
  строка-плейсхолдер «Do anything», снизу строка действий (вложение,
  выбор профиля разрешений, кнопка отправки). Стиль — после функциональности.
- Стриминг markdown-ответа; tool-calls видимы свёрнутыми строками
  («reading projects/...», «editing inbox/...»).
- Inline-подтверждение permission_request (кнопки allow/deny).
- Список прошлых сессий + продолжение (resume).
- Из редактора документа — кнопка «Discuss with agent» (передаёт docPath).
- UI на английском (см. корневой CLAUDE.md).
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
   (traversal, конфликты), IndexService (переиндексация, запросы);
   agent — Channel/Gate, classify() профилей разрешений (без сети);
   web — foldRecords/describeTool. Сейчас всё проверяется ad-hoc скриптами.
2. **Рендер markdown в ответах агента** (чат): сейчас pre-wrap текст. Нужен
   безопасный рендер (marked + sanitize или mini-renderer), code-блоки.
3. **Смена профиля разрешений в активной сессии** (SDK setPermissionMode) —
   сейчас профиль фиксируется при создании чата.
2. **Git-интеграция vault** (simple-git): `git init` при bootstrap,
   автокоммит после агентских сессий и батч-коммиты ручных правок.
3. Rename/move документов (API + UI), создание из дерева по правому клику.
4. Kanban-доска внутри проекта (сейчас только список задач с фильтром).
5. Code-splitting (manualChunks для TipTap, ~880KB бандл) и апгрейд на
   Vite 7 (закрывает dev-only advisory esbuild).
6. Виртуализация длинных списков задач; пагинация поиска.
7. Конфиг приложения `~/.forma/config.json` (путь к vault, порт) вместо env.
