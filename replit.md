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
- **Database**: PostgreSQL + Drizzle ORM (Supabase via Connection Pooler)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

- `artifacts/edge-tracker` — React/Vite фронтенд, порт 24402, путь `/`
- `artifacts/api-server` — Express 5 API сервер, порт 8080, путь `/api`

## Key Commands

- `pnpm install` — установить зависимости
- `pnpm --filter @workspace/api-server run build` — собрать API сервер
- `pnpm --filter @workspace/api-server run dev` — запустить API в dev режиме
- `pnpm --filter @workspace/edge-tracker run dev` — запустить фронтенд
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

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

1. База данных — Supabase PostgreSQL через Connection Pooler (`SUPABASE_DB_PASSWORD` env var). Подключение через `aws-1-ap-northeast-1.pooler.supabase.com:5432`
2. Миграции запускаются автоматически при старте сервера через `runMigrations()` в `migrate.ts`
3. Raw SQL ОБЯЗАТЕЛЬНО camelCase — иначе фронтенд не видит данные
4. API mount point: `app.use("/api", router)` — т.е. `/api/trades` и т.д.
5. Soft delete — `deleted_at`, GET фильтрует `WHERE deleted_at IS NULL`

## Backups

В `artifacts/backups/`:
- `replit_postgres_full_dump.sql` — полный SQL дамп
- JSON по каждой таблице
