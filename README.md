# WS_LEXX — платформа проп-деска

Внутренний сайт деска: дневной цикл трейдера (утро — план и плейбук, торговля, вечер — разбор дня), работа куратора и
Академия (Джун → Трейдер → Сеньор). Сделки приходят только из PropReports; вручную ведутся плейбук и планы.

Node.js 24 · pnpm monorepo · React 18 + Vite · Express 5 · PostgreSQL 16 · TypeScript 5.9 · интерфейс на RU / EN / UZ.

## Где что работает

- **Прод** — собственный сервер владельца: один процесс Node отдаёт сайт и API и выполняет фоновые задачи,
  PostgreSQL рядом, Caddy принимает HTTPS. Единственная инструкция выкладки, обновления, бэкапов и отката —
  [`docs/DEPLOY.md`](docs/DEPLOY.md). Replit, Supabase и Vercel больше не используются.
- **Разработка** — ПК владельца (Windows): локальная база, API и dev-сервер Vite (ниже).

## Состав репозитория

```
artifacts/
  api-server/      Express 5 API: src/routes (маршруты), src/lib (логика), src/jobs (планировщик задач),
                   src/db/migrations (версионные SQL-миграции, применяются при старте), src/config.ts (все переменные
                   окружения; образец — .env.example)
  edge-tracker/    сайт: React 18 + Vite + Tailwind v4, src/pages, src/components, src/i18n (RU/EN/UZ)
  binance-monitor/ бот WS News (Python): Binance Square → канал в Telegram
lib/               общие пакеты: db (подключение, схемы), api-spec / api-zod / api-client-react (контракты API)
scripts/           build-prod.sh (сборка прода), checks/ (храповики), src/ (локальная база, сиды, импорт PropReports)
docs/              DEPLOY.md, PILOT.md, IMPROVEMENT_PLAN.md, аудиты и исследования
ARCHITECTURE.md    архитектурные правила и принятые решения
```

## Разработка на ПК

```bash
pnpm install
pnpm --filter @workspace/scripts run local-db        # локальный Postgres на 5432, база edge_tracker (держать открытым)
pnpm db:test:create                                  # один раз: тестовая база edge_tracker_test
```

Переменные — в `.env.local` в корне (образец и описание каждой — `artifacts/api-server/.env.example`; для разработки
достаточно `JWT_SECRET`). API сам `.env`-файлы не читает, их подставляет команда запуска:

```bash
cd artifacts/api-server && pnpm run build && set -a && . ../../.env.local && set +a \
  && NODE_ENV=development PORT=8080 node --enable-source-maps dist/index.mjs      # API на :8080
pnpm --filter @workspace/edge-tracker run dev                                     # сайт (Vite), /api → :8080
```

Миграции применяются при старте API. На пустой базе dev-сервер создаёт учётки деска со случайными 6-значными PIN и
один раз пишет их в лог (или задайте `SEED_USERS`). Пароли в репозитории не хранятся.

## Команды

```bash
pnpm run typecheck            # typecheck всех пакетов (включая тесты)
pnpm test                     # тесты всех пакетов (API — на базе edge_tracker_test)
pnpm lint                     # Biome + ESLint
pnpm checks                   # храповики: i18n, «ru-RU», тела ошибок API, размеры, lint, слои, z-index, права
pnpm verify                   # lint + typecheck + test + checks + build — то же, что CI
bash scripts/build-prod.sh    # сборка прода: сайт → artifacts/api-server/dist/public, API → dist/index.mjs
pnpm --filter @workspace/api-spec run codegen        # перегенерировать клиент API из OpenAPI
npx tsx scripts/src/import-propreports.ts <file.xls> [--dry-run]   # импорт выписки PropReports из файла
```

## Правила, которые легко нарушить

- Схема базы меняется только новой миграцией в `artifacts/api-server/src/db/migrations` (`drizzle-kit push` запрещён).
- Переменные окружения читает только `src/config.ts`; новая переменная — в схему конфига и в `.env.example`.
- Права — только через матрицу (`lib/permissions`, `can` / `requireCap` / `route({ cap })`). Каждый изменяющий маршрут
  проверяется тестом «маршрут × роль» (`src/routes/__tests__/routeRoleMatrix.test.ts`): новый маршрут без проверки
  права или записи в `routeMatrix/expectations.ts` роняет тесты.
- Тексты интерфейса и ошибок — только в словарях RU/EN/UZ; кириллицы в коде нет.
- В серверном коде — `logger` / `req.log`, не `console.log`.

Подробно — [`ARCHITECTURE.md`](ARCHITECTURE.md).
