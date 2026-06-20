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

Доп.: выбор модели в чате. Сервер: `GET /api/agent/models`
(реестр models.ts — Opus 4.8 / Sonnet 4.6 / Haiku 4.5, проверены на шлюзе) +
`model` в сессии (createSession, summary, meta, resume). UI: дропдаун моделей
справа в ChatInput; модель фиксируется на активную сессию, как профиль
разрешений. ✓ Проверено: создание сессии с Haiku → агент ответил → модель
сохранена в summary/meta.

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

### 1.4 Контекст агента в vault ✅

Сделано: обогащён `.claude/CLAUDE.md` (структура vault, формат задач с примером
frontmatter, правила: даты YYYY-MM-DD, inbox vs `projects/*/tasks`, правка
существующих файлов вместо дублей, kebab-case имена; проекты, журнал). Три
skill'а в `.claude/skills/<name>/SKILL.md`: `plan-day`, `plan-week`,
`weekly-review` (frontmatter name/description для триггера, тело — инструкции).
Канон контента — в `apps/server/src/bootstrap.ts` (vault gitignored), живой
vault обновлён для разработки. SDK уже грузит и CLAUDE.md, и skills
(`settingSources: ['project']`, cwd = vault).

✓ Проверено: бутстрап свежего временного vault кладёт CLAUDE.md + 3 SKILL.md,
все парсятся (экранирование template-литералов корректно); typecheck/build.
Сквозной прогон «спланируй день» с живым агентом — при ручной проверке.

- Дополнить `vault/.claude/CLAUDE.md`: формат задач/проектов, правила
  (создавать задачи в inbox или projects/*/tasks, статусы, даты).
- Первые skills в `vault/.claude/skills/`: `plan-day`, `plan-week`,
  `weekly-review` (markdown-инструкции).
- ✓ Критерий: «спланируй мой день» создаёт/обновляет `journal/YYYY-MM-DD.md`
  и проставляет `scheduled` у задач.

### 1.5 Дашборд «Сегодня» ✅

Сделано: маршрут `/today` сделан стартовым (индекс редиректит на него), пункт
«Today» первым в навигации. Страница (`pages/TodayPage.tsx`): задачи на сегодня
(scheduled = today + due ≤ today среди активных, сортировка по дате), журнал дня
`journal/<today>.md` (read-only рендер), кнопка «✦ Plan my day». Кнопка кладёт
готовый промпт в композер свежего чата через `startWithPrompt` (ChatProvider →
ChatPanel сидит `draft` → управляемый ChatInput). Общий `components/TaskItem.tsx`
вынесен из TasksPage и переиспользован. Read-only markdown —
`components/MarkdownView.tsx` (TipTap `editable:false`, те же расширения, что в
редакторе).

✓ Проверено: typecheck, прод-сборка (все модули), vite-трансформы новых модулей,
полный dev-стек через vite-proxy (/api проксируется, задачи отдаются). PASS.

Оставлено: ответы агента в чате всё ещё pre-wrap — теперь можно переиспользовать
MarkdownView (техдолг №2).

- Маршрут `/today` (сделать стартовым вместо `/tasks`): задачи на сегодня
  (scheduled=today + просроченные due), журнал дня (рендер markdown),
  кнопка «спланировать день» → открывает чат с готовым промптом.
- ✓ Критерий: утренний сценарий целиком в одном экране.

Рекомендуемый порядок: 1.1 → 1.2 → 1.3, затем 1.4/1.5 параллельно.

---

## Фаза 2 «Автономия» ✅

### 2.1 Определения агентов + headless-движок + REST ✅

Сделано: тип `AgentDefinition` + парсер `agentFromDoc` в core
(`agentdef.ts`, frontmatter trigger/permissions/budget/output/enabled, тело =
промпт; терпим к пропускам). Примитив `AgentRuntime.runHeadless` (runtime.ts):
один промпт до результата, переиспользует provider + семафор чатов, любой
permission_request авто-деним (нет UI). `AgentService` (agents.ts): чтение
определений из `agents/*.md`, запуск с журналом в
`.forma/runs/<name>/<runId>/` (`meta.json` + `events.jsonl`), листинг запусков,
флаг `isRunning`, headless-кламп `full → vault-write`. REST (agents-api.ts,
`/api/agents`): list, get, `:name/runs`, `:name/runs/:runId`, `POST :name/run`.

✓ Проверено: агент реально создал `raw/agent-smoke.md`; meta success,
$0.039, 2 turns; журнал на месте.

### 2.2 Scheduler (croner) ✅

Сделано: `Scheduler` (scheduler.ts) на croner — собирает cron-агентов,
перестраивается по изменениям в `agents/` (debounce, через SSE-события
индексатора), guard от наложения (`isRunning`), `list()` с nextRun.

✓ Проверено: cron `*/2 * * * * *` создал запуск с `trigger: cron` за ~1с;
лог «scheduler: 1 cron agent(s)».

### 2.3 Событийные триггеры + webhook ✅

Сделано: `VaultEvent` различает `added`/`changed` (индексатор берёт kind из
chokidar add/change). `EventTrigger` (event-trigger.ts): glob→RegExp,
запускает event-агентов на появление файла (только `added`, чтобы агент не
зациклился на своих правках). Контекст запуска (`startRun(..., context)`)
прокидывает в промпт путь-триггер или payload вебхука. Вебхук
`POST /api/agents/:name/hook`.

✓ Проверено: новый файл в `inbox/` → запуск `trigger: event` за 1с;
webhook → ещё один; оба success.

### 2.4 Встроенные агенты ✅

Сделано: `secretary` (утренняя сводка, cron 9:00) и `janitor` (просроченное/
зависшее, cron 18:00) — файлами через bootstrap. По умолчанию
**`enabled: false`** (нет UI-тумблера и ежедневная стоимость — включать
осознанно; либо запускать вручную).

✓ Проверено: бутстрап ставит обоих; ручной прогон `janitor` (haiku, $0.036)
нашёл просроченную задачу и записал «## Напоминания» в журнал дня.

### 2.5 Web UI агентов ✅

Сделано: страница «Agents» (`pages/AgentsPage.tsx`, маршрут `/agents`, пункт
навигации): карточки агентов с тумблером enabled, бейджем running, триггером/
permission/next-run, кнопками «Run now» и «Edit» (→ редактор `agents/<name>.md`
в Docs), «+ New agent» (создаёт скелет и открывает в Docs). Раскрывающаяся
история запусков (poll 3s): статус/turns/стоимость/ошибка, по клику — транскрипт
запуска через `foldRecords`/`describeTool`. Бэкенд: `GET /api/agents` обогащён
`running` + `nextRun` (из `Scheduler.list()`), `PATCH /api/agents/:name`
(`enabled`) → `AgentService.setEnabled`. Список обновляется поллингом (running/
nextRun) и SSE-инвалидацией `['agents']` при правке файлов определений.

✓ Проверено: через vite-proxy — список с enabled/running/nextRun; PATCH enable
→ у агента появился nextRun (9:00 локально); прогон janitor (haiku, $0.046)
success; транскрипт запуска — 44 события. typecheck + прод-сборка.

### 2.6 Настройки: MCP + skills ✅

Сделано: `SettingsService` (settings.ts) — CRUD `.claude/mcp.json`
(атомарная запись temp+rename) и read-only список skills из
`.claude/skills/*/SKILL.md`. REST `/api/settings`: `GET/PUT/DELETE mcp[/:name]`,
`GET skills`. Страница «Settings» (`pages/SettingsPage.tsx`, маршрут
`/settings`, пункт навигации ⚙): форма MCP-сервера (stdio: command/args/env;
http: url/headers; env/headers строками KEY=VALUE), список с edit/delete,
секция skills с переходом в редактор SKILL.md. Рантайм: `claude.ts` грузит
`.claude/mcp.json` в SDK-сессии **только для `full`** (фоновым/read-only MCP
запрещён — серверы не поднимаем), guard на отсутствие/битый файл.

Намеренно НЕ сделано (вынесено в техдолг): живая «Test connection / список
инструментов» MCP-сервера — требует поднимать сервер и делать handshake.

✓ Проверено: skills отдаёт 3 bootstrap-скилла; MCP CRUD (PUT→диск→DELETE);
регрессия чата — full-сессия с чтением mcp.json стартует и завершает ход
($0.008), ошибок нет. typecheck + прод-сборка.

Зависимость: `croner` добавлен в `apps/server`.

## Фаза 3 «Знания» ✅

### 3.1 Ссылки и бэклинки ✅

Сделано: извлечение ссылок в core (`links.ts`, `extractLinks` — `[[wiki]]` с
алиасами и markdown `[..](..)`; внешние URL/якоря/картинки отсеиваются) и
резолвинг (`resolveLink`/`buildNameIndex` — wiki по basename, wiki/ при
коллизии; md по относительному/абсолютному пути; битые ссылки → null).
Индекс: таблица `links` (source/target/kind), заполняется при индексировании,
чистится по source. API `GET /api/backlinks?path=`. Веб: панель
«Linked references» в редакторе (`components/Backlinks.tsx`), SSE-инвалидация
`['backlinks']` при любой правке vault.

✓ Проверено: бутстрапный `[[forma]]` даёт бэклинк; 3 ссылки из одного дока
дедуплицируются; `[[index]]` резолвится по basename; битые/внешние
игнорируются. typecheck + прод-сборка.

### 3.2 Агент-librarian + skill distill ✅

Сделано: skill `distill` (редактируемые инструкции дистилляции) и встроенный
агент `librarian` (cron 02:00, `enabled: false`, permission vault-write,
output `wiki/`) — оба файлами через bootstrap + живой vault. librarian
опирается на навык distill: `raw/` и `chats/*/summary.md` → страницы `wiki/`
с frontmatter `sources:`, поддержка `wiki/index.md`, инкрементально.

✓ Проверено: ручной прогон (haiku, $0.057, 17 turns) создал `wiki/arc-vfs.md`
из заметки в `raw/` — с `sources: [raw/...]` и `[[forma]]`-ссылкой.

### 3.3 Автовыжимки чатов ✅

Сделано: idle-триггер в `AgentRuntime` — по простою сессии
(`FORMA_SUMMARY_IDLE_MS`, деф. 120с) фоновая `summarizeSession` делает headless-
выжимку транскрипта → `chats/<id>/summary.md` (frontmatter type: summary) +
устойчивые факты/решения в `raw/<date>-chat-<id>.md` (дальше их подберёт
librarian). Идемпотентно по числу turns; работает и для не-live сессий
(читает транскрипт с диска). Ручной эндпоинт
`POST /api/agent/sessions/:id/summarize` (force).

✓ Проверено: авто-выжимка по idle создала корректный summary.md; ручной
эндпоинт и не-live путь — ok; на дефолтной модели (sonnet) факты выгружены в
`raw/` (haiku шаг 2 часто пропускает — это на усмотрение модели). typecheck.

### 3.4 OKF-совместимость + отчёты ✅

Сделано (OKF): слой `wiki/` ведём как OKF-bundle v0.1 — решение и расхождения
задокументированы в [OKF.md](OKF.md). Стартовый `wiki/index.md` — OKF-корень
(`okf_version: "0.1"` + секции со строками `* [Title](page.md) — описание`),
`wiki/forma.md` несёт `type`/`description`. Skill `distill` обновлён: страницы
с `type: wiki`/`title`/`description`/`sources:`, относительные md-ссылки,
index.md в формате §6. Резолвер ссылок (3.1) понимает и md-, и `[[ ]]`-ссылки —
бэклинки не сломались.

Сделано (отчёты): встроенный агент `weekly-report` (cron пт 18:00,
`enabled: false`, output `reports/`) файлами через bootstrap; страница
«Reports» (`pages/ReportsPage.tsx`, маршрут `/reports`, пункт навигации) —
список `reports/*.md` со ссылками в редактор.

✓ Проверено: бутстрап ставит weekly-report; wiki conformance (непустой `type`);
бэклинк index.md→forma.md через md-ссылку; reports/ в дереве. typecheck + сборка.

### 3.5 `[[ ]]`-автодополнение в редакторе ✅

Сделано: эндпоинт `GET /api/docs` (`indexer.listDocs` — title/path + `insert`:
уникальный basename, иначе путь). TipTap-расширение `WikiLinkSuggestion`
(`components/editor/wikiLinkSuggestion.ts`) на триггер `[[`: ванильный popup
(без tippy/React-root), фильтрация по списку документов (грузится при монтировании
редактора), вставка литерала `[[insert]]` (round-trip в markdown, резолвится
индексом ссылок 3.1). Подключено в Editor (не в read-only MarkdownView).

✓ Проверено: `/api/docs` отдаёт корректные insert; де-экранирование скобок при
сериализации (баг tiptap-markdown) — ссылки индексируются; UI (popup, фильтр,
навигация, вставка, Esc, бэклинк) проверен в браузере. typecheck + сборка.

Заодно фикс: кнопка Save гасла не всегда (frontmatter сравнивался по ссылке) —
синхронизируем после сохранения.

## Фаза 4 «Десктоп» — в работе

Tauri 2-обёртка (`apps/desktop`): web как фронт, Node-server как sidecar.

### 4.1 Скелет: Tauri 2 + sidecar ✅
- `apps/desktop/src-tauri` — Rust-обёртка: спавнит сервер, глушит при выходе.
- Сервер упакован в Node SEA (`scripts/build-sidecar.mjs`): esbuild-бандл →
  инъекция в официальный статический node (Homebrew-node — лаунчер над
  libnode.dylib, для SEA не годится; скрипт качает/кэширует нужный node).
  `node:sqlite`/FTS5 работают без нативных зависимостей.
- Web ходит на API через `API_BASE`: пусто в браузере (Vite-proxy), абсолютный
  origin sidecar в Tauri-сборке.

### 4.2 Агент в упаковке ✅
- SDK запускает нативный `claude` (платформенный optional-dep, ~215MB). Кладём
  его вторым sidecar; Rust пробрасывает `FORMA_CLAUDE_BIN`, claude.ts передаёт
  как `pathToClaudeCodeExecutable`. Проверено end-to-end внутри приложения.

### 4.3 First-run vault picker + Keychain ✅
- Первый запуск: нативный выбор папки vault → сохраняем в app-config; дальше
  переиспользуем (фолбэк `~/FormaVault`).
- Креды в macOS Keychain (крейт `keyring`) → инжектятся в env sidecar; команды
  `store_credential`/`credential_present`. Фолбэк на env / `~/.claude`.
- Экран Settings → «Desktop»: смена vault (с рестартом сервера) и ввод кредов.

### 4.4 Переключение vault в рантайме ✅
- Сервер: `buildWorkspace(root)` собирает все сервисы; `POST /api/vault/switch`
  пересобирает их на новый корень и подменяет Hono-app без re-listen порта
  (`GET /api/vault` — текущий путь). Работает и в вебе, и в десктопе **без
  рестарта процесса**.
- Web: секция Settings → «Vault» (общая) — путь-инпут + Switch; в десктопе
  кнопка выбора папки. Десктоп дополнительно сохраняет выбор для след. запуска
  (`remember_vault`).

### 4.5 Осталось
- Подпись/нотаризация .app (сейчас ad-hoc codesign) — для распространения.
- Полный `tauri build` и проверка прод-пути (.app ~350MB из-за node+claude).

---

## Техдолг и улучшения (вне фаз, брать по возможности)

1. **Тесты**: vitest поднят (`npm test`). Покрыто: core — frontmatter
   round-trip (даты!), detectKind, taskFromDoc, links; server — VaultService
   (traversal, оптимистичная блокировка, листинги). Осталось: IndexService
   (переиндексация/запросы), agent — Channel/Gate + classify() профилей,
   web — foldRecords/describeTool, и сам редактор (TipTap, см. ниже).
2. **Рендер markdown в ответах агента** (чат): сейчас pre-wrap текст. Уже есть
   переиспользуемый `components/MarkdownView.tsx` (read-only TipTap) — применить
   его в чате (учесть стриминг: рендерить по мере накопления текста).
3. **Смена профиля разрешений в активной сессии** (SDK setPermissionMode) —
   сейчас профиль фиксируется при создании чата.
2. ✅ Git-интеграция vault (`GitService`, simple-git): `git init` + initial
   commit при старте, лейблованный коммит после каждого агентского прогона,
   дебаунс-коммит правок (ручных/внешних/чат-агента) по событиям индекса.
   Управляется настройкой `gitAutocommit` (Settings → Git history), вкл/выкл на лету. Best-effort, `.forma/` игнорируется.
3. ✅ Rename/move документов: `POST /api/doc/move` + `VaultService.moveDoc`,
   переписывание входящих ссылок (`[[wiki]]` и `[md](path)`) в бэклинках,
   контекстное меню в дереве (rename/move, delete, new here). Reindex обоих.
4. ✅ Kanban-доска (`/board?project=`): колонки по статусам, drag-and-drop
   карточек для смены статуса (оптимистично), селектор проекта. Карточка
   проекта ведёт на доску.
5. Code-splitting (manualChunks для TipTap, ~880KB бандл) и апгрейд на
   Vite 7 (закрывает dev-only advisory esbuild).
6. ✅ Виртуализация списка задач (`@tanstack/react-virtual`, плоский список с
   заголовками секций). Осталось: пагинация поиска.
7. Конфиг приложения `~/.forma/config.json` (путь к vault, порт) вместо env.
8. **MCP «Test connection»** (фаза 2.6, отложено): поднять MCP-сервер из
   `mcp.json` и вернуть список инструментов/ошибку в UI настроек.
9. **MCP для фоновых агентов**: сейчас MCP-инструменты доступны только в
   интерактивном чате (`full`); read-only MCP для headless-агентов потребует
   различать read/write инструменты по allow-list.
10. ✅ Зависшие запуски агентов: `AgentService.reapStaleRuns()` при старте
    помечает `running`-запуски как `error` («interrupted»).
11. ✅ Индексация `.claude/*.md`: вотчер теперь пропускает любые dot-папки, как
    и `reindexAll` — индекс консистентен между перезапусками.
