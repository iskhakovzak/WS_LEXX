# WS_LEXX — Prop Trading Desk

Внутренний инструмент для prop trading desk: трекер сделок, журнал событий, плейбук стратегий, war room, обсуждения.

## Быстрый старт на Replit

### 1. Создай новый Replit

Создай новый Replit с типом **"Import from GitHub"** или **"Blank Repl"** с Node.js 24.

### 2. Добавь PostgreSQL базу данных

В Replit: **Database → Create PostgreSQL Database**. Переменная `DATABASE_URL` выставится автоматически.

### 3. Установи зависимости и запусти

```bash
pnpm install
```

Затем запусти оба workflow (API Server и Frontend) — они уже настроены в `.replit`.

### 4. Готово

Миграции запускаются автоматически при первом старте — создадут все таблицы.
Пользователи добавятся автоматически (если таблица `users` пуста).

---

## Промпт для ИИ-агента (запуск с нуля)

Если нужно передать этот проект другому ИИ для запуска — скопируй этот промпт:

```
Ты работаешь с проектом WS_LEXX Prop Trading Desk.
Это pnpm monorepo с двумя artifacts:
- artifacts/edge-tracker — React 18 + Vite + TailwindCSS фронтенд
- artifacts/api-server — Express 5 API сервер

СТЕК:
- Node.js 24, pnpm, TypeScript 5.9
- PostgreSQL через Drizzle ORM
- Zod v4 валидация, Orval codegen из OpenAPI spec
- Wouter для роутинга на фронте

БАЗА ДАННЫХ:
- Только PostgreSQL, через DATABASE_URL env var
- На Replit: создай built-in PostgreSQL через Database tab — DATABASE_URL выставится сам
- Никаких SQLite, better-sqlite3, lowdb, local.db, db.sqlite, JSON файлов
- Миграции запускаются автоматически при старте (CREATE TABLE IF NOT EXISTS — безопасно)
- Никакого автосида, никакого reset/truncate при старте
- Данные сохраняются через все рестарты и переопубликования

ПРАВИЛА КОДА:
- API маршруты монтируются на /api (т.е. /api/trades, /api/events и т.д.)
- Soft delete — поле deleted_at, GET запросы фильтруют WHERE deleted_at IS NULL
- В продакшене Express раздаёт фронтенд из dist/public/
- BASE_PATH=/ при production build фронтенда (scripts/build-prod.sh)
- pg.types.setTypeParser для int OIDs (20,21,23,26) — возвращает числа, не строки

ЗАПУСК DEV:
- API: pnpm --filter @workspace/api-server run dev (порт 8080)
- Frontend: pnpm --filter @workspace/edge-tracker run dev (порт из PORT env)

PRODUCTION BUILD:
- bash scripts/build-prod.sh
- Собирает фронт, копирует в artifacts/api-server/dist/public/
- Запуск: node --enable-source-maps artifacts/api-server/dist/index.mjs

АУТЕНТИФИКАЦИЯ (только фронтенд, без JWT):
- Сессия в localStorage["ws_lexx_session"]
- Трейдеры: Закир/0101, Антон/61725, Артур/93547, Рахматулло/5555, Умид/15964, Максат/82374, Тимур/39156, Ариф/07770, Admin/0987

ЧТО НЕ ДЕЛАТЬ:
- Не менять тип id колонок (они SERIAL — не трогать)
- Не добавлять SQLite/Supabase/Prisma fallback
- Не делать seed/reset на старте
- Не хардкодить DATABASE_URL
- Не добавлять отдельные env для dev и prod
```

---

## Структура проекта

```
artifacts/
  edge-tracker/          # React/Vite фронтенд
    src/
      pages/             # страницы (dashboard, trades, events, playbook, etc.)
      components/        # UI компоненты
      hooks/             # API хуки (сгенерированы Orval)
  api-server/            # Express 5 API
    src/
      routes/            # маршруты API
      lib/
        migrate.ts       # автомиграции при старте
        logger.ts        # pino логгер
lib/
  db/                    # Drizzle ORM схемы и подключение
  api-zod/               # Zod схемы (сгенерированы из OpenAPI)
  api-spec/              # OpenAPI 3.0 спецификация
scripts/
  build-prod.sh          # production build
```

## Таблицы БД

`trades`, `market_events`, `research`, `daily_feed`, `discussions`, `comments`, `watchlist`, `playbook`, `users`, `activity_log`, `trade_reactions`, `trade_reviews`, `trading_errors`, `big7_levels`, `big7_catalysts`, `trader_ratings`, `war_room_sessions`, `war_room_levels`
