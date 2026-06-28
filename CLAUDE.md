# Forma — контекст для агентов

AI-воркспейс: база знаний + задачи в локальном файловом vault, интеллект
делегируется подключённому агенту. Прочитай перед работой:

- **docs/ARCHITECTURE.md** — архитектура и принципы (обязательно)
- **docs/PLAN.md** — текущий статус и детальный план работ

## Команды

```bash
npm install            # зависимости (Node ≥ 24, npm workspaces)
npm run dev            # сервер :8787 + веб :5173 (vault: $FORMA_VAULT или ~/FormaVault)
npm run typecheck      # tsc во всех пакетах — гонять после правок
npm run build          # прод-сборка (web: tsc + vite build)
npm run dev:server     # только API-сервер
npm test               # vitest (юнит-тесты core + VaultService)
npm run test:watch     # vitest в watch-режиме
```

Десктоп (Tauri 2, нужен Rust toolchain — `. "$HOME/.cargo/env"` если не в PATH):

```bash
npm run dev -w @forma/desktop          # окно Tauri; web+server поднимаются внутри
npm run build:sidecar -w @forma/desktop  # пересобрать Node SEA sidecar (после правок server)
npm run build -w @forma/desktop         # собрать .app (prebuild соберёт sidecar+web)
```

Первый запуск десктопа спрашивает папку vault (сохраняется в app-config). При
правках кода сервера для десктопа нужно пересобрать sidecar — в dev обычный
`npm run dev` (веб) удобнее.

Тесты: vitest, файлы `*.test.ts` рядом с кодом. Покрыты чистые модули
`packages/core` (frontmatter, kind, links) и `VaultService` (path
traversal, оптимистичная блокировка, атомарная запись) на временном vault.
Веб (TipTap/React) пока не покрыт — см. PLAN.md «Техдолг».

## Структура

- `packages/core` — типы домена, парсинг frontmatter, конвенции vault.
  Общий код сервера и веба; экспортируется как TS-исходники (без сборки).
- `apps/server` — Hono API: VaultService (файлы), IndexService
  (node:sqlite + FTS5 + chokidar), REST + SSE.
- `apps/web` — React + Vite + TanStack Router/Query + TipTap + Tailwind 4.
- `vault/` — данные пользователя (gitignored), создаётся при первом запуске.

## Ключевые инварианты

1. **Файлы — источник истины.** SQLite-индекс — производный, его можно
   удалить (`vault/.forma/index.db`) и пересобрать перезапуском. Никогда не
   писать в индекс «вперёд» файлов.
2. Запись файлов — только через `VaultService.writeDoc` (атомарность,
   защита от path traversal, оптимистичная блокировка по mtime → 409).
3. Даты во frontmatter — строки `YYYY-MM-DD` (парсер нормализует Date от
   js-yaml, см. `packages/core/src/frontmatter.ts`).
4. Статусы задач: `inbox | todo | in_progress | blocked | done | cancelled`.
   Тип документа определяется `detectKind` (явный `type:` > конвенции путей).
5. После мутаций через API индексируем синхронно + вотчер подхватывает
   внешние правки; UI обновляется через SSE `/api/events`.

## Конвенции кода

- TypeScript strict, ESM везде; импорты внутри пакетов с расширением `.js`.
- **Язык UI — английский по умолчанию** (метки, кнопки, плейсхолдеры).
  Код, идентификаторы, имена файлов — тоже английские. Контент vault
  пишет пользователь на любом языке. (Фаза-0 экраны пока на русском —
  перевести, см. PLAN.md «Техдолг».)
- Стиль UI: Tailwind, палитра stone, скругления rounded-lg/xl — смотри
  существующие компоненты и не выбивайся. Чат с агентом — минималистичный
  инпут в духе «Do anything» (одна строка, иконки + действия снизу);
  ориентир приложен пользователем, детали стиля — после функциональности.
