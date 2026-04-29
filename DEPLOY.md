# WS_LEXX Edge Tracker — Deploy Guide v3.0

Полная инструкция для развёртывания системы на новом Replit с нуля.

---

## Что это за система

**Edge Tracker** — внутренняя операционная платформа для проп-трейдинг деска.

Включает:
- Trade Journal — структурированный журнал сделок
- Playbook Engine — база стратегий и edge компании
- Performance Analytics — win rate, expectancy, ошибки
- Daily Feed — что работает прямо сейчас
- Watchlist — список акций с уровнями
- Research — паттерны и исследования
- Discussions — обсуждения внутри команды
- Big7 — ключевые уровни по крупным тикерам
- War Room — совместные торговые сессии
- Система ролей: trader / curator / admin

**Стек:** React + Vite (frontend) · Express 5 + Node.js (backend) · PostgreSQL (база данных) · pnpm monorepo

---

## ЧАСТЬ 1 — Подготовка нового Replit

### Шаг 1: Создай новый Repl

1. Зайди на replit.com
2. Create Repl → выбери **Blank Repl** (или Node.js)
3. Назови его как угодно (например `WS-LEXX-v3`)

### Шаг 2: Импортируй код из GitHub

В Shell нового Replit выполни:

```bash
git clone https://github.com/iskhakovzak/WS_LEXX.git .
```

Если папка не пустая:
```bash
git init
git remote add origin https://github.com/iskhakovzak/WS_LEXX.git
git pull origin main
```

### Шаг 3: Установи зависимости

```bash
pnpm install
```

---

## ЧАСТЬ 2 — База данных

### Шаг 4: Создай PostgreSQL базу данных в Replit

1. В левой панели Replit найди **Database** (иконка цилиндра)
2. Нажми **Create a PostgreSQL database**
3. Replit автоматически установит переменную `DATABASE_URL`

### Шаг 5: Восстанови дамп базы данных

Из архива релиза скачай файл `db_backup_v3.sql` и загрузи его в Replit Shell, затем:

```bash
# Проверь что переменные базы данных есть
echo $DATABASE_URL

# Восстанови дамп
psql $DATABASE_URL < db_backup_v3.sql
```

Если нужно восстановить через отдельные переменные:
```bash
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -U $PGUSER -d $PGDATABASE < db_backup_v3.sql
```

**Если не хочешь восстанавливать дамп** — база создастся автоматически при первом запуске сервера (миграции + базовый сид данных).

---

## ЧАСТЬ 3 — Настройка Workflows

### Шаг 6: Настрой два workflow

В Replit нужно создать два workflow для запуска приложений.

**Workflow 1 — API Server (backend):**
- Name: `artifacts/api-server: API Server`
- Command: `PORT=8080 pnpm --filter @workspace/api-server run dev`
- Wait for port: `8080`
- Output type: `console`

**Workflow 2 — Edge Tracker (frontend):**
- Name: `artifacts/edge-tracker: web`
- Command: `pnpm --filter @workspace/edge-tracker run dev`
- Wait for port: `5000`
- Output type: `webview`

Либо через Replit Agent введи:

```
Настрой два workflow:
1. Название "artifacts/api-server: API Server", команда "PORT=8080 pnpm --filter @workspace/api-server run dev", порт 8080, тип console
2. Название "artifacts/edge-tracker: web", команда "pnpm --filter @workspace/edge-tracker run dev", порт 5000, тип webview
```

---

## ЧАСТЬ 4 — Переменные окружения

### Шаг 7: Проверь переменные

Переменные которые нужны (большинство Replit ставит автоматически):

| Переменная | Значение | Откуда |
|---|---|---|
| `DATABASE_URL` | `postgresql://...` | Replit Database (авто) |
| `PGHOST` | hostname | Replit Database (авто) |
| `PGPORT` | `5432` | Replit Database (авто) |
| `PGUSER` | username | Replit Database (авто) |
| `PGPASSWORD` | password | Replit Database (авто) |
| `PGDATABASE` | dbname | Replit Database (авто) |
| `PORT` | `8080` | задаём в команде workflow |

Опционально (если нужен GitHub sync):
- `GITHUB_PERSONAL_ACCESS_TOKEN` — токен доступа к репозиторию

---

## ЧАСТЬ 5 — Запуск

### Шаг 8: Запусти оба workflow

Запусти сначала API Server, подожди пока в логах появится:
```
Server listening port: 8080
Database migrations completed
```

Потом запусти Edge Tracker.

### Шаг 9: Проверь работу

- Frontend: открой превью в Replit (должен показать страницу логина)
- Backend: `curl localhost:80/api/healthz` должен вернуть `{"status":"ok"}`

---

## ЧАСТЬ 6 — Пользователи

### Дефолтные аккаунты (если использовал дамп БД — они уже есть)

| Имя | Пароль | Роль |
|---|---|---|
| Закир | 0101 | trader |
| Антон | 61725 | curator |
| Артур | 93547 | trader |
| Рахматулло | 5555 | trader |
| Умид | 15964 | trader |
| Максат | 82374 | trader |
| Тимур | 39156 | curator |
| Ориф | 07770 | curator |
| Admin | 0987 | admin |

---

## ЧАСТЬ 7 — Деплой в продакшен

### Опубликовать приложение

1. В Replit нажми кнопку **Publish** (или Deploy)
2. Выбери **Reserved VM** для постоянной работы
3. Приложение будет доступно по адресу вида `ws-lexx.username.replit.app`

### Production отличия от development

В продакшене сервер запускается иначе (через `artifact.toml`):
- Build: `bash scripts/build-prod.sh`
- Run: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- PORT задаётся Replit автоматически (8080)

---

## Структура проекта

```
WS_LEXX/
├── artifacts/
│   ├── api-server/          # Express 5 backend
│   │   ├── src/
│   │   │   ├── routes/      # API endpoints (trades, playbook, users, ...)
│   │   │   ├── lib/
│   │   │   │   ├── migrate.ts   # DB migrations + seeding (20 таблиц)
│   │   │   │   ├── db.ts        # PostgreSQL connection pool
│   │   │   │   └── logger.ts    # Pino logger
│   │   │   └── index.ts     # Server entry point
│   │   └── build.mjs        # esbuild config
│   └── edge-tracker/        # React + Vite frontend
│       ├── src/
│       │   ├── pages/       # Все страницы (Trades, Playbook, Watchlist, ...)
│       │   ├── components/  # Layout, навигация
│       │   └── contexts/    # Auth, Theme
│       └── vite.config.ts
├── lib/                     # Общие библиотеки (api-spec, shared types)
├── scripts/                 # Utility скрипты
├── db_backup_v3.sql         # Дамп базы данных v3.0
├── pnpm-workspace.yaml      # Workspace config
└── DEPLOY.md                # Этот файл
```

---

## Быстрый промпт для Replit Agent на новом Repl

Если хочешь поднять через Replit Agent — дай ему этот промпт:

```
Я хочу поднять проект WS_LEXX Edge Tracker на этом Replit.

1. Сделай git clone https://github.com/iskhakovzak/WS_LEXX.git . (или git pull если уже склонировано)
2. Запусти pnpm install
3. Создай PostgreSQL базу данных через Replit Database
4. Восстанови дамп: psql $DATABASE_URL < db_backup_v3.sql
5. Настрой два workflow:
   - "artifacts/api-server: API Server" → PORT=8080 pnpm --filter @workspace/api-server run dev → port 8080, console
   - "artifacts/edge-tracker: web" → pnpm --filter @workspace/edge-tracker run dev → port 5000, webview
6. Запусти оба workflow
7. Убедись что API отвечает на /api/healthz и фронтенд открывается

Пароли пользователей и остальные детали в файле DEPLOY.md
```

---

## Troubleshooting

**"PORT environment variable is required"**
→ Добавь `PORT=8080` перед командой запуска API

**"node_modules missing"**
→ Запусти `pnpm install` в корне проекта

**"vite: not found"**
→ Запусти `pnpm install` в корне проекта

**База данных не подключается**
→ Проверь что Replit Database создана и переменная `DATABASE_URL` установлена

**Фронтенд открывается но API не отвечает**
→ Проверь что API Server workflow запущен и слушает port 8080

---

*WS_LEXX Edge Tracker v3.0 — Release 2026*
