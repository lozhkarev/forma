# Forma — контекст для агентов

AI-воркспейс: база знаний + задачи в локальном файловом vault, интеллект
делегируется подключённому агенту. Прочитай перед работой:

- **docs/ARCHITECTURE.md** — архитектура и принципы (обязательно)
- **docs/PLAN.md** — текущий статус и детальный план работ

## Команды

```bash
npm install            # зависимости (Node ≥ 24, npm workspaces)
npm run dev            # сервер :8787 + веб :5173 (vault в ./vault)
npm run typecheck      # tsc во всех пакетах — гонять после правок
npm run build          # прод-сборка (web: tsc + vite build)
npm run dev:server     # только API-сервер
```

Тестов пока нет (план: vitest, см. PLAN.md «Техдолг»).

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
- Тексты UI — на русском; код, идентификаторы, имена файлов — английские.
- Стиль UI: Tailwind, палитра stone, скругления rounded-lg/xl — смотри
  существующие компоненты и не выбивайся.
