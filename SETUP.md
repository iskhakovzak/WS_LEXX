# WS_LEXX — PROP TRADING DESK
## Инструкция по развёртыванию в новом Replit-аккаунте

---

## ВАЖНО ПРОЧИТАЙ ПЕРЕД НАЧАЛОМ

Это pnpm-монорепо. Здесь используется **только pnpm** — npm и yarn не работают.  
База данных — **встроенная PostgreSQL от Replit** (не Supabase, не внешняя — только Replit DB).  
Миграции запускаются **автоматически** при старте сервера — ничего вручную не нужно.

---

## СТРУКТУРА ПРОЕКТА

```
/
├── artifacts/
│   ├── api-server/      ← Express 5 API (порт 3000 в dev, 5000 в prod)
│   └── edge-tracker/    ← React + Vite фронтенд
├── lib/
│   ├── db/              ← Drizzle ORM + схемы таблиц PostgreSQL
│   ├── api-zod/         ← Zod-валидация для API
│   └── api-client-react/← React-хуки для API
├── pnpm-workspace.yaml  ← Описание монорепо
├── pnpm-lock.yaml       ← Локфайл (НЕ УДАЛЯТЬ)
├── start.sh             ← Скрипт запуска production
└── replit.nix           ← Системные зависимости Nix
```

---

## ШАГ 1 — СОЗДАТЬ REPL

1. Создай новый Repl типа **"Import from GitHub"** или **"Upload folder"** — залей архив проекта как есть
2. Тип Repl — **Node.js** (или любой, главное потом настроить вручную)
3. Дождись пока Replit проиндексирует файлы

---

## ШАГ 2 — ПОДКЛЮЧИТЬ БАЗУ ДАННЫХ

**Это обязательный шаг — без него сервер упадёт при старте.**

1. В левой панели Replit нажми **"Tools"** → **"Database"** (или значок базы данных)
2. Нажми **"Create a database"** → выбери **PostgreSQL**
3. Replit автоматически добавит переменную `DATABASE_URL` в окружение
4. Убедись что `DATABASE_URL` появилась в **Secrets** (Tools → Secrets)

> ⚠️ НИКОГДА не используй Supabase — он работает только по IPv6, а Replit по умолчанию IPv4. Соединение не установится.

---

## ШАГ 3 — НАСТРОИТЬ WORKFLOW (команда запуска)

В Replit нажми **"Tools"** → **"Workflows"** → добавь (или измени существующий):

**Для разработки (dev mode, с HMR):**
```
Название: Start application
Команда:  cd artifacts/api-server && PORT=3000 node --enable-source-maps ./dist/index.mjs & cd artifacts/edge-tracker && PORT=5000 pnpm run dev
```

**Для продакшена (после сборки):**
```
Название: Start application  
Команда:  sh start.sh
```

> В dev-режиме фронтенд на порту 5000 (Vite), API на 3000.  
> В prod-режиме всё на порту 5000 (Express отдаёт собранный фронтенд).

---

## ШАГ 4 — ПЕРВАЯ УСТАНОВКА ЗАВИСИМОСТЕЙ

Открой **Shell** в Replit и выполни:

```bash
pnpm install
```

Это установит все зависимости для всего монорепо сразу (все пакеты в `artifacts/` и `lib/`).

> ⚠️ Если попробуешь `npm install` — получишь ошибку. Только `pnpm`.

---

## ШАГ 5 — СОБРАТЬ ПРОЕКТ (если нужен production)

```bash
pnpm run build:prod
```

Эта команда:
1. Собирает React-фронтенд (`artifacts/edge-tracker/dist/public/`)
2. Собирает API-сервер (`artifacts/api-server/dist/`)
3. Копирует собранный фронтенд в папку API-сервера (`artifacts/api-server/dist/public/`)

После этого всё готово к запуску через `sh start.sh`.

---

## ШАГ 6 — ЗАПУСК

### Dev-режим (разработка):
Запусти workflow "Start application" — Replit сам запустит команду из Шага 3.

### Production-запуск (вручную):
```bash
sh start.sh
```

---

## МИГРАЦИИ БАЗЫ ДАННЫХ

**Ничего делать не надо** — при каждом старте сервер автоматически запускает `runMigrations()` который создаёт все таблицы через `CREATE TABLE IF NOT EXISTS`.

Таблицы которые создаются автоматически:
- `trades` — трейды
- `market_events` — события
- `research` — исследования
- `playbook_entries` — плейбук
- `playbook_trade_links` — связи трейдов с плейбуком
- `watchlist` — вотчлист
- `daily_feed` — дневная лента
- `discussions` + `discussion_comments` — обсуждения
- `trade_reactions` + `trade_reviews` — реакции и ревью
- `activity_log` — лог активности
- И другие вспомогательные таблицы

---

## ПАРОЛИ ТРЕЙДЕРОВ

Пароли хранятся **в коде** (`artifacts/edge-tracker/src/contexts/auth-context.tsx`), не в базе данных.

Текущие пароли (на момент написания инструкции):

| Трейдер | Пароль |
|---------|--------|
| Закир | `0101` |
| Антон | `61725` |
| Артур | `93547` |
| Рахматулло | `5555` |
| Умид | `15964` |
| Максат | `82374` |
| Тимур | `39156` |

Чтобы изменить пароль — открой файл `artifacts/edge-tracker/src/contexts/auth-context.tsx`, найди объект `TRADER_PASSWORDS` и измени нужное значение. Потом пересобери: `pnpm run build:prod`.

Пароль Администратора (сброс данных): `0987`

---

## ТИПИЧНЫЕ ОШИБКИ И КАК ИХ ИЗБЕЖАТЬ

### ❌ "Cannot find module" или "workspace:* not found"
**Причина:** зависимости не установлены или установлены через npm.  
**Решение:** `pnpm install` из корня проекта.

### ❌ "DATABASE_URL must be set"
**Причина:** база данных не подключена к Repl.  
**Решение:** Tools → Database → Create PostgreSQL. Проверь что `DATABASE_URL` есть в Secrets.

### ❌ Сервер запускается но выдаёт ошибки подключения к БД
**Причина:** скорее всего используется Supabase или внешняя IPv6-база.  
**Решение:** используй только встроенную Replit PostgreSQL.

### ❌ "Use pnpm instead" при запуске npm install
**Причина:** `package.json` блокирует npm через `preinstall` скрипт.  
**Решение:** установи pnpm и используй только его: `pnpm install`.

### ❌ Белый экран или 404 на фронтенде
**Причина:** проект не собран (`dist/` пустая).  
**Решение:** `pnpm run build:prod`, затем перезапусти workflow.

### ❌ API возвращает 500 на все запросы
**Причина:** таблицы не созданы (БД пустая, миграции не прошли).  
**Решение:** убедись что `DATABASE_URL` задана, перезапусти workflow — миграции запустятся автоматически.

### ❌ Фронтенд не обновляется после изменений кода
**Причина:** в dev-режиме работает Vite HMR — просто сохрани файл, браузер обновится.  
В production нужна пересборка: `pnpm run build:prod` и перезапуск workflow.

### ❌ PORT уже занят
**Причина:** старый процесс не завершился.  
**Решение:** перезапусти Repl или убей процесс: `pkill -f node`.

---

## ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (Secrets)

| Переменная | Откуда взять | Зачем |
|-----------|-------------|-------|
| `DATABASE_URL` | Автоматически от Replit Database | Подключение к PostgreSQL |

Других обязательных секретов нет. Всё остальное зашито в код.

---

## КАК ОБНОВИТЬ КОД (если меняешь что-то)

1. Внеси изменения в файлы
2. Запусти сборку: `pnpm run build:prod`
3. Перезапусти workflow

Для изменений только в фронтенде в dev-режиме — сборка не нужна, Vite обновит сам.

---

## ПРОМТ ДЛЯ АГЕНТА REPLIT (скопируй целиком если начинаешь новый чат)

```
Ты работаешь с проектом WS_LEXX — Prop Trading Desk. 
Это pnpm-монорепо с React/Vite фронтендом и Express 5 API.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1. Используй ТОЛЬКО pnpm — никогда npm или yarn
2. База данных — ТОЛЬКО встроенная Replit PostgreSQL (DATABASE_URL из Secrets). Supabase НЕ работает (IPv6 only)
3. Миграции запускаются автоматически при старте сервера через runMigrations() в artifacts/api-server/src/lib/migrate.ts — не трогай их вручную
4. Для запуска dev: workflow "Start application" с командой: cd artifacts/api-server && PORT=3000 node --enable-source-maps ./dist/index.mjs & cd artifacts/edge-tracker && PORT=5000 pnpm run dev
5. Для production-сборки: pnpm run build:prod (собирает и фронт и бэк, копирует dist)
6. Пароли трейдеров хранятся в artifacts/edge-tracker/src/contexts/auth-context.tsx в объекте TRADER_PASSWORDS
7. API сервер на порту 3000 (dev) или 5000 (prod), фронтенд на 5000 (dev Vite)
8. Никогда не переключайся на Supabase, внешние базы данных или docker
9. Не используй npm install — только pnpm install
10. Структура: artifacts/api-server (бэк), artifacts/edge-tracker (фронт), lib/db (схема и ORM)

Текущий стек:
- Frontend: React 19, Vite 7, Tailwind CSS 4, wouter (роутер), TanStack Query, shadcn/ui
- Backend: Express 5, Drizzle ORM, PostgreSQL (Replit built-in)
- Монорепо: pnpm workspaces

Пароли (в auth-context.tsx):
Закир=0101, Антон=61725, Артур=93547, Рахматулло=5555, Умид=15964, Максат=82374, Тимур=39156
Admin reset: 0987
```

---

## ДОПОЛНИТЕЛЬНО

- Логи сервера: в Replit нажми "Console" рядом с workflow
- Если что-то сломалось — сначала проверь Console на ошибки
- Rollback: Replit делает автоматические чекпоинты, можно откатиться через History
- Deploy (публикация): Tools → Deployments → "Deploy" — создаст отдельную production-среду с отдельной БД
