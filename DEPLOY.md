# WS_LEXX Edge Tracker — Deploy Guide v5.0

Полная инструкция для развёртывания системы на новом Replit с нуля.

---

## Что это за система

**WS_LEXX Edge Tracker** — внутренняя операционная платформа для проп-трейдинг деска.

Включает: Trade Journal · Playbook · Analytics · Trade Ideas · AI Review · Watchlist · Big7 · War Room · Research · Discussions · Calculator · Psychology · Digest · Backups

**Стек:** React 18 + Vite (frontend) · Express 5 + Node.js 24 (backend) · PostgreSQL (база данных) · pnpm monorepo · TypeScript 5.9

---

## ЧАСТЬ 1 — Код

### Шаг 1: Создай новый Repl

1. Зайди на [replit.com](https://replit.com)
2. Create Repl → **Blank Repl** (Node.js)
3. Назови его (например `WS-LEXX-v5`)

### Шаг 2: Импортируй код из GitHub

В Shell нового Replit:

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

### Шаг 4: Создай PostgreSQL в Replit

1. В левой панели Replit: **Database** (иконка цилиндра)
2. Нажми **Create a PostgreSQL database**
3. Replit автоматически выставит `DATABASE_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

### Шаг 5: Восстанови данные (если есть бекап)

**Вариант A — из автобекапа (.sql.gz из Object Storage):**
```bash
# Скачай через Админку → Инструменты → Бекапы БД → скачать
gunzip backup-file.sql.gz
psql "$DATABASE_URL" < backup-file.sql
```

**Вариант B — из .sql файла:**
```bash
psql "$DATABASE_URL" < db_backup_v5.sql
```

**Вариант C — с нуля (без бекапа):**
Пропусти этот шаг. Миграции создадут все таблицы при первом старте. Пользователи сидятся автоматически если таблица пустая.

---

## ЧАСТЬ 3 — Секреты

### Шаг 6: Добавь секреты в Replit Secrets

В Replit: **Tools → Secrets**

| Переменная | Значение | Обязательно |
|---|---|---|
| `JWT_SECRET` | случайная строка 32+ символов | **ДА** (без неё сервер не стартует) |
| `PLAYBOOK_PASSWORD` | пароль для плейбука | **ДА** |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ID бакета Replit Object Storage | для автобекапов |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | токен GitHub | для push из Replit |

Переменные которые Replit выставляет автоматически после создания БД:
`DATABASE_URL` · `PGHOST` · `PGPORT` · `PGUSER` · `PGPASSWORD` · `PGDATABASE`

---

## ЧАСТЬ 4 — Workflows

### Шаг 7: Workflows уже настроены в `.replit`

Оба workflow прописаны автоматически. Просто нажми **Run** или запусти их через вкладку Workflows.

Если workflow нужно создать вручную:

**Workflow 1 — API Server:**
- Name: `artifacts/api-server: API Server`
- Command: `pnpm --filter @workspace/api-server run dev`
- Port: `8080`

**Workflow 2 — Edge Tracker (frontend):**
- Name: `artifacts/edge-tracker: web`
- Command: `pnpm --filter @workspace/edge-tracker run dev`

---

## ЧАСТЬ 5 — Запуск

### Шаг 8: Запусти оба workflow

Сначала **API Server**, дождись в логах:
```
Server listening  port: 8080
Database migrations completed
dbBackup cron started  intervalH: 48, keepLast: 10, delayMin: 3
```

Потом **Edge Tracker**.

### Шаг 9: Проверь работу

```bash
# API healthcheck:
curl localhost:80/api/healthz
# Ответ: {"status":"ok","timestamp":"..."}
```

Frontend: открой превью в Replit — должна открыться страница логина.

---

## ЧАСТЬ 6 — Пользователи

| Имя | Пароль | Роль |
|---|---|---|
| Закир | `0101` | trader |
| Антон | `61725` | curator |
| Артур | `93547` | trader |
| Рахматулло | `5555` | trader |
| Умид | `15964` | trader |
| Максат | `82374` | trader |
| Тимур | `39156` | curator |
| Ариф | `07770` | curator |
| Admin | `0987` | admin |

Пароли хранятся в bcrypt (таблица `users.password_hash`).

---

## ЧАСТЬ 7 — Деплой в продакшен

### Опубликовать приложение

1. В Replit нажми **Publish** → **Reserved VM**
2. Приложение будет доступно по `https://ws-lexx.username.replit.app`

### Production сборка (делается автоматически при Publish)

```bash
bash scripts/build-prod.sh
# Собирает фронтенд → артефакты/api-server/dist/public/
# Запуск: node --enable-source-maps artifacts/api-server/dist/index.mjs
```

---

## ЧАСТЬ 8 — Автобекапы

Бекапы запускаются автоматически. **Ничего настраивать не нужно** если выставлен `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.

- Первый бекап: через 3 минуты после старта сервера
- Периодичность: каждые 48 часов
- Формат: `pg_dump | gzip` → `ws-lexx-backups/YYYY-MM-DDTHH-mm-ssZ.sql.gz`
- Хранится: последних 10 файлов (~20 дней)

**Управление:** Войди как admin → **Админка → Инструменты → Бекапы БД**
- Список всех бекапов (curators+)
- Кнопка «Создать сейчас» (admin)
- Скачать .sql.gz (admin, signed URL на 15 мин)

**Восстановление:**
```bash
gunzip backup.sql.gz
psql "$DATABASE_URL" < backup.sql
```

---

## Troubleshooting

**"JWT_SECRET not set — server cannot start"**
→ Добавь `JWT_SECRET` в Replit Secrets (Tools → Secrets)

**"PORT environment variable is required"**
→ Workflow уже настроен правильно. Перезапусти через Workflows.

**"node_modules missing" / "vite: not found"**
→ Запусти `pnpm install` в корне проекта

**База данных не подключается**
→ Проверь что Replit Database создана. Переменная `DATABASE_URL` должна быть в Secrets.

**Фронтенд открывается но API не отвечает**
→ Убедись что workflow `artifacts/api-server: API Server` запущен и показывает `Server listening port: 8080`

**Бекапы не создаются**
→ Проверь что `DEFAULT_OBJECT_STORAGE_BUCKET_ID` выставлен в Secrets и Replit Object Storage добавлен

---

## Быстрый промпт для Replit Agent на новом Repl

```
Я хочу поднять проект WS_LEXX Edge Tracker (v5.0) на этом Replit.

1. git clone https://github.com/iskhakovzak/WS_LEXX.git . (или git pull если уже склонировано)
2. pnpm install
3. Создай PostgreSQL базу данных через Replit Database tab
4. Добавь в Secrets: JWT_SECRET (случайная строка 32+ символов), PLAYBOOK_PASSWORD (любой пароль)
5. Если есть файл дампа: psql $DATABASE_URL < db_backup_v5.sql
6. Запусти оба workflow (они уже прописаны в .replit):
   - artifacts/api-server: API Server
   - artifacts/edge-tracker: web
7. Дождись "Server listening port: 8080" и "Database migrations completed" в логах API
8. Проверь: curl localhost:80/api/healthz → {"status":"ok"}

Пользователи: Admin/0987 (admin), Антон/61725 (curator), Закир/0101 (trader)
Подробности в файле DEPLOY.md и README.md
```

---

*WS_LEXX Edge Tracker v5.0 — 2026-05-05*
