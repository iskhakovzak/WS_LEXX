# WS_LEXX Edge Tracker — Migration Guide

Этот документ описывает полный перенос проекта на новый Replit и новую базу данных Supabase.

---

## Содержание

1. [Архитектура проекта](#архитектура-проекта)
2. [Перенос на новый Replit](#перенос-на-новый-replit)
3. [Настройка новой БД Supabase](#настройка-новой-бд-supabase)
4. [Переменные окружения (Secrets)](#переменные-окружения-secrets)
5. [Запуск после переноса](#запуск-после-переноса)
6. [Резервная копия данных](#резервная-копия-данных)
7. [Чеклист переноса](#чеклист-переноса)

---

## Архитектура проекта

```
monorepo (pnpm workspaces)
├── artifacts/
│   ├── edge-tracker/          # React + Vite фронтенд (порт 24402)
│   └── api-server/            # Express 5 бэкенд (порт 8080)
├── lib/
│   ├── api-spec/              # OpenAPI спека (openapi.yaml) + codegen
│   ├── api-client-react/      # Сгенерированные React Query хуки
│   ├── api-zod/               # Сгенерированные Zod схемы
│   └── db/                    # Drizzle ORM схемы таблиц
└── scripts/                   # Утилиты
```

**Стек:**
- Frontend: React 18 + Vite 7 + TailwindCSS + shadcn/ui
- Backend: Express 5 + Drizzle ORM + Pino логгер
- DB: PostgreSQL через Supabase
- Auth: собственная сессионная авторизация (пароли в таблице `users`)
- Роуты проксируются через Replit Reverse Proxy

---

## Перенос на новый Replit

### Шаг 1 — Создать новый Replit

1. На [replit.com](https://replit.com) создать новый Repl типа **"Import from GitHub"**
2. Указать репозиторий: `https://github.com/iskhakovzak/WS_LEXX`
3. Выбрать ветку `main`

> Если нет доступа к GitHub import — создать пустой Node.js Repl, затем в Shell:
> ```bash
> git clone https://github.com/iskhakovzak/WS_LEXX.git .
> ```

### Шаг 2 — Настроить Secrets

Перейти в **Tools → Secrets** и добавить все переменные из раздела [Переменные окружения](#переменные-окружения-secrets).

### Шаг 3 — Установить зависимости

Replit сделает это автоматически через `.replit`. Если нет — в Shell:
```bash
pnpm install
```

### Шаг 4 — Настроить Workflows

В Replit перейти в **Tools → Workflows** и убедиться, что есть два воркфлоу:

| Название | Команда |
|---|---|
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` |
| `artifacts/edge-tracker: web` | `pnpm --filter @workspace/edge-tracker run dev` |

Если их нет — создать вручную (кнопка «+» в Workflows).

### Шаг 5 — Запустить

Запустить оба воркфлоу. API-сервер при старте **автоматически прогонит все миграции** БД.

---

## Настройка новой БД Supabase

### Создать новый проект Supabase

1. Перейти на [supabase.com](https://supabase.com) → New Project
2. Запомнить **пароль БД** при создании (понадобится для `SUPABASE_DB_PASSWORD`)
3. После создания проекта перейти в **Settings → Database**

### Получить строки подключения

В разделе **Settings → Database → Connection string**:

| Параметр | Где взять |
|---|---|
| `SUPABASE_DATABASE_URL` | Connection string → **URI** (начинается с `postgresql://`) |
| `SUPABASE_DB_PASSWORD` | Пароль, заданный при создании проекта |

В разделе **Settings → API**:

| Параметр | Где взять |
|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | **anon / public** ключ |
| `SUPABASE_SECRET_KEY` | **service_role** ключ |

> Миграции прогоняются автоматически при старте `api-server`. Все таблицы создаются с нуля — вручную ничего делать не нужно.

---

## Переменные окружения (Secrets)

Все секреты добавляются в **Replit → Tools → Secrets**:

| Ключ | Описание | Где взять |
|---|---|---|
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string | Supabase → Settings → Database → URI |
| `SUPABASE_DB_PASSWORD` | Пароль БД | Задаётся при создании проекта Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Anon/public ключ | Supabase → Settings → API |
| `SUPABASE_SECRET_KEY` | Service role ключ | Supabase → Settings → API |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub PAT | github.com → Settings → Developer settings → PAT |

> **Примечание:** `OPENAI_API_KEY` используется для AI-review фич. Если есть — добавить. Если нет — фича будет недоступна, но всё остальное работает.

---

## Запуск после переноса

После старта API-сервера в логах должно быть:

```
INFO: Running database migrations...
INFO: Migration: table trades OK
INFO: Migration: table market_events OK
... (все таблицы)
INFO: Database migrations completed
INFO: Server listening { port: 8080 }
```

### Стандартные пароли входа

Пользователи хранятся в таблице `users` в БД.
На новой пустой БД нужно создать пользователей через эндпоинт или вручную.

Временный admin-пароль (для `settings` страницы): **`0987`**

### Проверка работоспособности

```bash
# API healthcheck
curl https://<replit-domain>/api/healthz

# Или локально через прокси
curl http://localhost:80/api/healthz
```

---

## Резервная копия данных

### Экспорт данных из старой Supabase

Перейти в **Supabase → Database → Backups** → скачать последний backup.

Или через SQL Editor — экспортировать таблицы в CSV:
```sql
-- Пример для trades
COPY trades TO STDOUT WITH CSV HEADER;
```

### Основные таблицы с данными

| Таблица | Содержимое |
|---|---|
| `trades` | Все сделки |
| `trade_ideas` | Торговые идеи |
| `market_events` | События рынка |
| `research` | Исследования / паттерны |
| `daily_feed` | Дневные записи |
| `discussions` | Обсуждения и комментарии |
| `watchlist` | Вотчлист |
| `playbook` | Стратегии плейбука |
| `playbook_trade_ideas` | Примеры сделок по стратегиям |
| `users` | Пользователи системы |
| `trader_ratings` | Рейтинги трейдеров |
| `emotional_state_log` | Эмоциональный журнал |
| `pre_trade_checklist_responses` | Ответы чеклиста |

### Импорт в новую Supabase

Через **Supabase → SQL Editor** можно вставить INSERT-скрипты или загрузить backup.

---

## Чеклист переноса

```
□ 1. Создан новый Replit и клонирован репозиторий WS_LEXX
□ 2. Создан новый Supabase проект
□ 3. Получены все 4 Supabase секрета
□ 4. Все секреты добавлены в Replit Secrets
□ 5. pnpm install выполнен успешно
□ 6. Оба Workflow созданы и запущены
□ 7. В логах API-сервера видно "Database migrations completed"
□ 8. Открыт /api/healthz — ответ 200 OK
□ 9. Открыт фронтенд — страница загружается
□ 10. Создан тестовый пользователь и проверен вход
□ 11. (Опционально) Импортированы данные из старой БД
```

---

## Структура репозитория (для разработчика)

```
WS_LEXX/
├── .replit                          # Конфигурация Replit
├── replit.md                        # Память агента (архитектура проекта)
├── pnpm-workspace.yaml              # Workspace + catalog зависимостей
├── package.json                     # Root команды
├── tsconfig.base.json               # Базовый TypeScript конфиг
├── artifacts/
│   ├── edge-tracker/                # Фронтенд
│   │   ├── src/pages/               # Страницы: trades, events, research, ...
│   │   ├── src/components/          # Компоненты
│   │   └── vite.config.ts
│   └── api-server/
│       ├── src/routes/              # API маршруты
│       ├── src/lib/migrate.ts       # Миграции БД (addColumns паттерн)
│       └── src/openapi.yaml         # (НЕ используется — спека в lib/api-spec)
└── lib/
    ├── api-spec/openapi.yaml        # ГЛАВНАЯ OpenAPI спека
    ├── api-client-react/            # Сгенерированные хуки (НЕ редактировать вручную)
    ├── api-zod/                     # Сгенерированные Zod схемы (НЕ редактировать)
    └── db/src/schema/               # Drizzle схемы таблиц
```

### Команды разработки

```bash
# Регенерировать API клиент (после изменения openapi.yaml)
pnpm --filter @workspace/api-spec run codegen

# Тайпчек
pnpm run typecheck

# Запустить отдельно (не нужно — используй Workflows)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/edge-tracker run dev
```
