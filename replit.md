# WS_LEXX — Prop Trading Desk

## Overview

pnpm workspace monorepo — Prop Trading Desk с React/Vite фронтендом и Express 5 API.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 18 + Vite + TailwindCSS + Wouter
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (локальный Replit PostgreSQL)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)

## Artifacts

- `artifacts/edge-tracker` — React/Vite фронтенд, порт из `PORT` env, путь `/`
- `artifacts/api-server` — Express 5 API сервер, порт 8080, путь `/api`

## Key Commands

```bash
pnpm install                                       # установить зависимости
pnpm --filter @workspace/api-server run dev        # запустить API (dev)
pnpm --filter @workspace/edge-tracker run dev      # запустить фронтенд (dev)
pnpm --filter @workspace/api-spec run codegen      # regenerate API hooks из OpenAPI spec
bash scripts/build-prod.sh                         # production build (frontend + API)
```

## Auth (фронтенд только)

Сессия в `localStorage["ws_lexx_session"]`. Трейдеры:
- Закир / `0101`
- Антон / `61725` (куратор)
- Артур / `93547`
- Рахматулло / `5555`
- Умид / `15964`
- Максат / `82374`
- Тимур / `39156` (куратор)
- Ариф / `07770` (куратор)
- Admin / `0987`

## Критические правила

1. База данных — локальный PostgreSQL (`DATABASE_URL` env var). На Replit автоматически выставляется через built-in PostgreSQL.
2. Миграции (`CREATE TABLE IF NOT EXISTS`) запускаются автоматически при старте через `runMigrations()` — данные НЕ перетираются.
3. Никакого автосида, никакого seed/reset при старте — данные сохраняются через рестарты и переопубликование.
4. API mount point: `app.use("/api", router)` — т.е. `/api/trades`, `/api/events` и т.д.
5. Soft delete — поле `deleted_at`, GET запросы фильтруют `WHERE deleted_at IS NULL`.
6. В продакшене API сервер раздаёт статику фронтенда из `dist/public/`.

## Структура

```
artifacts/
  edge-tracker/     # React/Vite фронтенд
  api-server/       # Express 5 API + production static serving
lib/
  db/               # Drizzle ORM схемы и подключение к БД
  api-zod/          # Zod схемы для API (генерируются через Orval)
  api-spec/         # OpenAPI спецификация
scripts/
  build-prod.sh     # production build script
```
