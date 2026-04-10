# WS_LEXX — ПОЛНЫЙ ПРОМТ ВОССТАНОВЛЕНИЯ

> Этот документ содержит ВСЮ информацию для 100% восстановления проекта с нуля на новом Replit аккаунте.
> Дата: 2026-04-09. Кодовая база, БД, конфигурация, все фичи — описаны до последней мелочи.

---

## 1. ЧТО ЭТО ЗА ПРОЕКТ

**WS_LEXX — PROP TRADING DESK** — внутренний инструмент для проп-трейдинговой команды из 8 трейдеров. Язык интерфейса: русский + английский. Тёмная тема по умолчанию (есть переключатель на светлую). Моноширинный шрифт, стиль "терминал/Bloomberg".

## 2. СТЕК ТЕХНОЛОГИЙ

### Монорепо (pnpm workspaces)
```
workspace root (/)
├── artifacts/
│   ├── api-server/     — Express 5 API (TypeScript, порт 3000)
│   └── edge-tracker/   — React 18 + Vite frontend (порт 5000)
├── lib/
│   ├── api-spec/       — OpenAPI 3.1 спецификация (openapi.yaml, 1361 строк)
│   ├── api-client-react/ — Автогенерированный React Query клиент (из OpenAPI через Orval)
│   ├── api-zod/        — Zod-схемы (автогенерация из OpenAPI)
│   └── db/             — Drizzle ORM схемы + pool подключение
├── package.json        — root workspace
├── pnpm-workspace.yaml — packages: artifacts/*, lib/*
└── .npmrc              — catalog versions, overrides, security
```

### Ключевые зависимости
- **Frontend**: React 19.1.0, Vite 7.3.2, TanStack React Query 5, Tailwind CSS 4, ShadcnUI (Radix), Wouter (routing), Recharts, Lucide icons, Framer Motion
- **Backend**: Express 5, Drizzle ORM, pg (PostgreSQL), Pino (logging), CORS
- **Build**: esbuild (API server), Vite (frontend)
- **БД**: Replit встроенный PostgreSQL (НЕ Supabase — он IPv6-only и не работает из Replit)

## 3. ЗАПУСК И СБОРКА

### Workflow "Start application" (основной):
```bash
cd artifacts/api-server && PORT=3000 node --enable-source-maps ./dist/index.mjs & cd artifacts/edge-tracker && PORT=5000 pnpm run dev
```

### Пересборка API перед рестартом:
```bash
pnpm --filter @workspace/api-server run build
```

### Production сборка:
```bash
pnpm run build:prod
# копирует фронтенд в api-server/dist/public
# запуск: PORT=5000 NODE_ENV=production node artifacts/api-server/dist/index.mjs
```

### Vite proxy (dev):
`/api` → `http://localhost:3000` (настроено в `vite.config.ts`)

### Env переменные:
- `DATABASE_URL` — строка подключения к PostgreSQL (Replit автоматически ставит)
- `PORT` — порт сервера (3000 для API, 5000 для frontend)
- `SUPABASE_URL` — **НЕ ИСПОЛЬЗОВАТЬ**, оставить как есть

## 4. БАЗА ДАННЫХ — ПОЛНАЯ СХЕМА

### 17 таблиц:

#### 4.1 `users` (8 записей)
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'trader',  -- 'trader' | 'curator'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
**Данные:**
| id | name | password | role |
|---|---|---|---|
| 1 | Закир | 0101 | trader |
| 2 | Антон | 61725 | curator |
| 3 | Артур | 93547 | trader |
| 4 | Рахматулло | 5555 | trader |
| 5 | Умид | 15964 | trader |
| 6 | Максат | 82374 | trader |
| 7 | Тимур | 39156 | curator |
| 8 | Ариф | 07770 | curator |

**Admin пароль** для управления пользователями: `0987` (проверяется фронтендом в Settings)

#### 4.2 `trades` (54 записи)
```sql
CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  setup TEXT,
  side TEXT,                    -- 'long' | 'short'
  event_type TEXT,
  entry NUMERIC(12,4),
  exit NUMERIC(12,4),
  stop NUMERIC(12,4),
  result TEXT NOT NULL,         -- 'win' | 'loss' | 'breakeven'
  pnl NUMERIC(12,2),
  r_multiple NUMERIC(8,2),
  hold_time TEXT,
  slippage NUMERIC(8,2),
  market_cap TEXT,
  float TEXT,
  relative_volume NUMERIC(8,2),
  session TEXT,
  screenshot_url TEXT,          -- URL-ы скриншотов через \n
  screenshot_notes TEXT,        -- JSON массив строк (подписи к скриншотам)
  notes TEXT,
  what_worked TEXT,
  what_failed TEXT,
  conclusion TEXT,
  trader TEXT,
  tags TEXT,                    -- теги через запятую
  event_id INTEGER,
  pattern_id INTEGER,
  playbook_id INTEGER,          -- связь с плейбуком
  deleted_at TIMESTAMPTZ,       -- soft delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.3 `playbook` (48 записей, 47 активных)
```sql
CREATE TABLE playbook (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  setup_type TEXT,              -- тип сетапа из ~80+ вариантов
  conditions TEXT,              -- условия входа
  checklist TEXT,               -- чеклист
  notes TEXT,
  confidence_level INTEGER,     -- уверенность 0-100%
  screenshot_url TEXT,          -- URL-ы скриншотов через \n
  screenshot_notes TEXT,        -- JSON массив строк
  tags TEXT,
  folder TEXT,                  -- папка для группировки
  source_type TEXT,             -- тип источника
  source_id INTEGER,
  parent_id INTEGER,            -- если не NULL → дочерний сетап (вложенность)
  deleted_at TIMESTAMPTZ,       -- soft delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
**Ключевые папки**: SMB Capital — Offering Plays, Gap Plays, IPO Plays, Intraday Setups, Short Setups, Momentum Setups, Reversal Setups, Swing Setups, Frameworks. Также: Sector Move, Risk Management, Macro / Event Plays, IPO / SPO Plays, Breakout Patterns, Short Setups, Intraday Momentum, Earnings Plays.

#### 4.4 `market_events` (11 записей)
```sql
CREATE TABLE market_events (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  reaction TEXT,
  percent_move NUMERIC(8,2),
  volume TEXT,
  summary TEXT,
  screenshot_url TEXT,
  screenshot_notes TEXT,
  tags TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.5 `research` (8 записей)
```sql
CREATE TABLE research (
  id SERIAL PRIMARY KEY,
  pattern_name TEXT NOT NULL,
  ticker TEXT,
  context TEXT,
  market_condition TEXT,
  what_worked TEXT,
  what_failed TEXT,
  repeat_count INTEGER DEFAULT 1,
  confidence_level INTEGER DEFAULT 50,
  screenshot_url TEXT,
  screenshot_notes TEXT,
  tags TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.6 `daily_feed` (9 записей)
```sql
CREATE TABLE daily_feed (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  what_works_now TEXT,
  what_doesnt_work TEXT,
  best_tickers TEXT,
  market_theme TEXT,
  notes TEXT,
  tags TEXT,
  screenshot_url TEXT,
  screenshot_notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.7 `discussions` (10 записей)
```sql
CREATE TABLE discussions (
  id SERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  type TEXT,
  trader TEXT,
  notes TEXT,
  tags TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.8 `comments` (0 записей)
```sql
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  discussion_id INTEGER NOT NULL,
  trader TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.9 `watchlist` (8 записей)
```sql
CREATE TABLE watchlist (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  catalyst TEXT,
  target_price NUMERIC(12,4),
  stop_price NUMERIC(12,4),
  status TEXT NOT NULL DEFAULT 'watching',
  notes TEXT,
  sector TEXT,
  tags TEXT,
  screenshot_url TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.10 `activity_log` (14 записей)
```sql
CREATE TABLE activity_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  section TEXT NOT NULL,
  entity_id TEXT,
  entity_title TEXT,
  trader TEXT,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.11 `trade_reactions` (0 записей)
```sql
CREATE TABLE trade_reactions (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL,
  trader TEXT NOT NULL,
  reaction_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.12 `trading_errors` (0 записей)
```sql
CREATE TABLE trading_errors (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  error_type TEXT NOT NULL,
  description TEXT NOT NULL,
  ticker TEXT,
  trade_id INTEGER,
  severity TEXT NOT NULL DEFAULT 'medium',
  lesson TEXT,
  resolved TEXT NOT NULL DEFAULT 'no',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.13 `trade_reviews` (0 записей)
```sql
CREATE TABLE trade_reviews (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL,
  curator TEXT NOT NULL,
  comment TEXT NOT NULL,
  rating TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.14 `playbook_trade_ideas` (0 записей)
```sql
CREATE TABLE playbook_trade_ideas (
  id SERIAL PRIMARY KEY,
  playbook_entry_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT,
  entry_zone TEXT,
  target TEXT,
  stop TEXT,
  status TEXT DEFAULT 'watching',
  notes TEXT,
  date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.15 `big7_levels` (1 запись)
```sql
CREATE TABLE big7_levels (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  label TEXT NOT NULL,
  price NUMERIC(12,4) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX big7_levels_ticker_idx ON big7_levels(ticker);
CREATE INDEX big7_levels_created_at_idx ON big7_levels(created_at);
```

#### 4.16 `big7_catalysts` (0 записей)
```sql
CREATE TABLE big7_catalysts (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  impact TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX big7_catalysts_ticker_idx ON big7_catalysts(ticker);
CREATE INDEX big7_catalysts_date_idx ON big7_catalysts(date);
```

#### 4.17 `trader_ratings` (1 запись)
```sql
CREATE TABLE trader_ratings (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  curator TEXT NOT NULL,
  week TEXT NOT NULL,
  discipline INTEGER DEFAULT 5,
  risk_management INTEGER DEFAULT 5,
  execution INTEGER DEFAULT 5,
  journaling INTEGER DEFAULT 5,
  improvement INTEGER DEFAULT 5,
  overall INTEGER DEFAULT 5,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 5. API МАРШРУТЫ (Express 5)

Все маршруты монтируются через `app.use("/api", router)`.

### 5.1 Users
- `GET /api/users` — активные пользователи (active=true)
- `GET /api/users/all` — все пользователи (включая деактивированных)
- `POST /api/users` — создать (body: `{name, password, role, adminPassword}`)
- `PATCH /api/users/:id` — обновить (body: `{name?, password?, role?, active?, adminPassword}`)
- `DELETE /api/users/:id` — soft-delete (body: `{adminPassword}`)

### 5.2 Trades
- `GET /api/trades` — все трейды (deleted_at IS NULL), ORDER BY created_at DESC
- `POST /api/trades` — создать
- `PATCH /api/trades/:id` — обновить
- `DELETE /api/trades/:id` — soft-delete

### 5.3 Playbook
- `GET /api/playbook` — все записи плейбука (deleted_at IS NULL)
- `GET /api/playbook/:id/children` — дочерние записи (parent_id = :id)
- `POST /api/playbook` — создать
- `PATCH /api/playbook/:id` — обновить (только переданные поля, parentId НЕ сбрасывается)
- `DELETE /api/playbook/:id` — soft-delete

### 5.4 Events (market_events)
- `GET /api/events` — все
- `POST /api/events` — создать
- `PATCH /api/events/:id` — обновить
- `DELETE /api/events/:id` — soft-delete

### 5.5 Research
- `GET /api/research` — все
- `POST /api/research` — создать
- `PATCH /api/research/:id` — обновить
- `DELETE /api/research/:id` — soft-delete

### 5.6 Daily Feed
- `GET /api/dailyfeed` — все
- `POST /api/dailyfeed` — создать
- `PATCH /api/dailyfeed/:id` — обновить
- `DELETE /api/dailyfeed/:id` — soft-delete

### 5.7 Discussions
- `GET /api/discussions` — все
- `POST /api/discussions` — создать
- `PATCH /api/discussions/:id` — обновить
- `DELETE /api/discussions/:id` — soft-delete

### 5.8 Watchlist
- `GET /api/watchlist` — все
- `POST /api/watchlist` — создать
- `PATCH /api/watchlist/:id` — обновить
- `DELETE /api/watchlist/:id` — soft-delete

### 5.9 Big7 Levels
- `GET /api/big7levels` — все уровни
- `POST /api/big7levels` — создать (body: `{ticker, label, price, notes?}`)
- `PATCH /api/big7levels/:id` — обновить
- `DELETE /api/big7levels/:id` — удалить (hard delete)

### 5.10 Big7 Catalysts
- `GET /api/big7/catalysts` — все катализаторы
- `POST /api/big7/catalysts` — создать (body: `{ticker, date, type, description?, impact?}`)
- `DELETE /api/big7/catalysts/:id` — удалить (hard delete)

### 5.11 Ratings
- `GET /api/ratings` — все оценки
- `GET /api/ratings/summary` — агрегированная сводка по трейдерам
- `POST /api/ratings` — создать (проверка: только кураторы из БД)
- `DELETE /api/ratings/:id` — удалить

### 5.12 Activity
- `GET /api/activity` — лента действий (последние 100)
- `POST /api/activity` — записать действие

### 5.13 Dashboard
- `GET /api/dashboard` — агрегированные данные для dashboard

### 5.14 Errors (trading_errors)
- `GET /api/errors` — все ошибки
- `POST /api/errors` — создать
- `PATCH /api/errors/:id` — обновить
- `DELETE /api/errors/:id` — удалить

### 5.15 Health
- `GET /api/health` — проверка здоровья

### 5.16 Admin
- `POST /api/admin/backup` — создание бекапа

### 5.17 Seed
- `POST /api/seed` — seed демо-данных

## 6. ФРОНТЕНД — ВСЕ СТРАНИЦЫ И КОМПОНЕНТЫ

### 6.1 Routing (Wouter)
```
/                — Dashboard
/trades          — Trades
/events          — Events
/research        — Research
/dailyfeed       — Daily Feed
/discussions     — Discussions
/analytics       — Analytics
/watchlist       — Watchlist
/playbook        — Playbook
/calculator      — Calculator
/activity        — Activity Feed
/error-tracker   — Error Tracker
/indicators      — Indicators
/big7            — Radar (Big 7)
/ratings         — Ratings
/settings        — Settings
```

### 6.2 Навигация (sidebar)
4 группы:
- **Обзор**: Dashboard, Analytics, Activity
- **Торговля**: Trades, Watchlist, Playbook, Calculator
- **Аналитика**: Events, Research, Daily Feed, Big 7, Indicators
- **Команда**: Discussions, Ratings, Error Tracker, Settings

### 6.3 Авторизация (`auth-context.tsx`)
- Только фронтенд, нет backend-auth
- Сессия хранится в `localStorage["ws_lexx_session"]`
- Роли: `trader` (полный доступ), `guest` (только просмотр)
- `<WriteOnly>` компонент — скрывает UI для гостей
- Кураторы определяются динамически из БД (role='curator' в таблице users)
- `useAuth()` возвращает: `{ user, loginAsTrader, loginAsGuest, logout, isAuthenticated, canEdit, isCurator, dbUsers, refreshUsers }`
- `DbUser` тип: `{ id, name, password, role, active, createdAt }`
- FALLBACK_TRADERS — захардкожены на случай если API недоступен

### 6.4 Темы (`theme-context.tsx`)
- `localStorage["ws_lexx_theme"]` — `"dark"` или `"light"`
- По умолчанию `dark`
- Класс `dark`/`light` ставится на `<html>`

### 6.5 Global Search (`global-search.tsx`)
- Открывается по Cmd+K / Ctrl+K или клику на кнопку "Поиск..."
- Ищет по: trades, playbook, daily feed, research, events
- **Кнопка "Заметки"** — переключает на поиск ТОЛЬКО в полях notes/conditions/descriptions (убирает шум от тикеров/тегов)
- Результаты группируются по разделам с иконками и цветовой кодировкой
- Клавиатурная навигация: стрелки вверх/вниз, Enter, Escape

### 6.6 Playbook (`playbook.tsx` — 1531 строк, ключевая страница)
**Фичи:**
- Сортировка по папкам (drag-reorder через localStorage `playbook-folder-order`)
- Вложенные сетапы (parent_id): дочерние скрыты из главного списка, видны внутри карточки родителя
- 80+ типов сетапов (SMB Capital 20 core + T3 Trading + Maverick + Bright Trading)
- Скриншоты с подписями (screenshotUrl через `\n`, screenshotNotes — JSON массив)
- Теги из 8 категорий (472 тега) + ручной ввод
- Фильтрация по: папкам, типам сетапов, уверенности, тегам
- CRUD: создание, редактирование, удаление (soft delete)
- Кнопка "Действия" — панель с лентой последних событий
- `staleTime: 0, gcTime: 0` — всегда свежие данные
- После мутаций: инвалидировать `["playbook"]` И `["playbook-children"]`
- `getSetupColor()` — динамическая функция для цвета бейджа типа сетапа

### 6.7 Trades (`trades.tsx`)
- Таблица всех трейдов
- Фильтры: трейдер, результат, тикер, даты
- Highlight конкретного трейда по URL `?highlight=ID`
- CRUD с soft delete
- Связь с playbook (playbook_id)

### 6.8 Radar / Big 7 (`big7.tsx` — 1050 строк)
**Полный набор фич в стиле SMB Capital:**

1. **Market Context Bar** (сверху):
   - SPY/QQQ bias (Bullish/Bearish/Neutral/Watching)
   - VIX уровень (цвет: <18 зелёный, <25 жёлтый, >25 красный)
   - Gap Direction (gap up / flat / gap down)
   - Market Notes

2. **Карточки тикеров** (по умолчанию Mag7: AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA):
   - **TradingView графики** — свечи + объём + MA (разворачиваемые)
   - **"In Play" toggle** — пометить тикер активным (подсвечивается рамкой)
   - **Premarket Bias** — Bull/Bear/Neutral/Watch
   - **Relative Strength vs SPY** — шкала 1-5 (Very Weak -> Very Strong)
   - **Ticker Stats** — ATR (14d), Avg Volume, Float, Short % (ручной ввод, сохраняется постоянно)
   - **Gap & Range** — Gap %, Open price, Prev Close, Expected Range (auto-calc из ATR)
   - **Trade Plan** — текстовый план на тикер (шаблон-подсказка)
   - **Key Levels** — CRUD уровней с типами:
     - support, resistance, pivot, vwap, pre-market high/low, ath, atl, gap fill, open, yesterday close/high/low
     - **Action Plan** на каждом уровне: buy / sell / watch / add size / trim / breakout long / breakdown short / fade
     - Действия цветом: зелёный = покупка, красный = продажа, жёлтый = fade, синий = watch
   - **Position Calculator** — Risk $, Entry, Stop -> Shares, Risk/Share, Position Size
   - **Session Scorecard** — 1-5 звёзд + текстовый обзор

3. **Catalyst Calendar** (модал):
   - Типы: Earnings, FOMC/Fed, Ex-Dividend, Product Launch, Sector Event, News
   - Impact: Low / Medium / High
   - Бейджи на карточках тикеров

4. **Фильтры/режимы**:
   - "In Play Only" — показать только активные
   - "Compact" / "Full" — переключение плотности

5. **Хранение данных**:
   - **PostgreSQL**: big7_levels (уровни), big7_catalysts (катализаторы)
   - **localStorage**:
     - `big7_day_{TICKER}_{DATE}` — дневные данные (bias, notes, inPlay, rs, gapPct, openPrice, prevClose, sessionScore, sessionNotes)
     - `big7_stats_{TICKER}` — постоянные статы (atr, avgVol, float, shortInt)
     - `big7_market_{DATE}` — контекст рынка (spyBias, qqBias, vixLevel, marketNotes, gapDirection)
     - `big7_custom_tickers` — кастомный список тикеров
     - `big7_account_risk` — риск на позицию для калькулятора

6. **Важный паттерн**: `updateTickerDayField()` — читает текущее состояние из localStorage перед записью, предотвращает race condition между компонентами

### 6.9 Ratings (`ratings.tsx`)
- Карточки трейдеров со средними оценками
- 6 категорий: Discipline, Risk Management, Execution, Journaling, Improvement, Overall (1-10)
- Только кураторы могут ставить оценки (проверка и на фронте и на бекенде)
- Понедельный список оценок

### 6.10 Settings (`settings.tsx`)
- Управление пользователями (требует admin пароль `0987`):
  - Добавление/редактирование/деактивация пользователей
  - Toggle видимости пароля
  - Fetch `/api/users/all`

### 6.11 Остальные страницы
- **Analytics** (`analytics.tsx`) — графики и статистика по трейдам (Recharts)
- **Dashboard** (`dashboard.tsx`) — обзорная страница со сводкой
- **Events** (`events.tsx`) — CRUD рыночных событий
- **Research** (`research.tsx`) — CRUD паттернов/исследований
- **Daily Feed** (`dailyfeed.tsx`) — лента: что работает, что нет, тема рынка
- **Discussions** (`discussions.tsx`) — обсуждения команды
- **Watchlist** (`watchlist.tsx`) — список наблюдения за тикерами
- **Calculator** (`calculator.tsx`) — калькулятор позиций
- **Activity** (`activity.tsx`) — лента последних действий
- **Error Tracker** (`error-tracker.tsx`) — трекер ошибок трейдеров
- **Indicators** (`indicators.tsx`) — страница индикаторов
- **Login** (`login.tsx`) — выбор трейдера + пароль ИЛИ гостевой доступ

## 7. КОМПОНЕНТЫ

- `screenshot-fields.tsx` (341 строк) — загрузка/просмотр скриншотов, множественные URL через `\n`, подписи (JSON массив)
- `tag-selector.tsx` (82 строки) — выбор тегов из категорий + ручной ввод, `TagChipEditor`
- `add-to-playbook.tsx` (192 строки) — модал "Добавить в плейбук" из трейда
- `undo-toast.tsx` (51 строка) — Toast с кнопкой отмены
- `layout.tsx` (159 строк) — Sidebar + header + GlobalSearch
- `ui/` — ShadcnUI компоненты (Radix-based)

## 8. ТЕГИ (`tags.ts` — 258 строк, 472 тега)

8 категорий:
1. **Сетап** — ORB, Gap and Go, VWAP Bounce, Red to Green, Parabolic Short, Flag Breakout, Earnings Gap, IPO Day Trade, Second Day Play, Channel Break, и др.
2. **Катализатор** — Earnings Beat/Miss, FDA Approval, Analyst Upgrade/Downgrade, Merger/Acquisition, Product Launch, Insider Buy/Sell, Sector Rotation, и др.
3. **Уровни** — Support, Resistance, VWAP, 9EMA, 20EMA, 50SMA, 200SMA, Pre-market High/Low, Yesterday High/Low, All-time High, Fibonacci, Volume Profile POC, и др.
4. **Профиль акции** — Low Float, Mid Float, Mega Cap, High Short Interest, High Relative Volume, Biotech, Tech, Energy, и др.
5. **Условия рынка** — Trending Up/Down, Range-bound, High/Low Volatility, Risk On/Off, Sector Rotation, Pre-market Gap, FOMC Day, CPI Day, и др.
6. **Исполнение** — Clean Entry, Late Entry, Early Exit, Scaled In/Out, Added on Dip, Trailed Stop, Market/Limit Order, и др.
7. **Ошибки/Уроки** — FOMO Entry, Oversized, Moved Stop, Revenge Trade, Didn't Take Profit, Traded Against Trend, и др.
8. **Результат** — Quick Scalp, Full Target, Partial Profit, Stopped Out, Break Even, Overnight Hold, и др.

## 9. ТИПЫ СЕТАПОВ (~80+)

SMB Capital 20 core: ATM Offering Play, Pricing Play, Gap and Go, IPO Day Trade, Second Day Play, VWAP Trend Trade, Parabolic Short, ORB, Low Float Momentum, Failed Follow Through, Short Squeeze, Sympathy Play, Halt & Resume, Anchored VWAP, 9 EMA Daily, Dead Cat Bounce, High of Day Break, News Fade, In Play Framework, Power Hour Momentum.
Плюс: Breakout, Reversal, Earnings Gap Up/Down, Intraday Momentum, Runner, Support, Scalp, Gap, ABCD variants, Mean Reversion, Pairs Trading, ETF Arb, и др.
Функция `getSetupColor(type)` возвращает динамический цвет бейджа.

## 10. КРИТИЧЕСКИЕ ПРАВИЛА КОДА

### 10.1 SQL -> camelCase
**ВСЕ** raw SQL запросы ОБЯЗАТЕЛЬНО должны возвращать camelCase псевдонимы:
```sql
SELECT id, setup_type AS "setupType", parent_id AS "parentId",
       screenshot_url AS "screenshotUrl", confidence_level AS "confidenceLevel",
       created_at AS "createdAt", deleted_at AS "deletedAt",
       screenshot_notes AS "screenshotNotes", source_type AS "sourceType",
       source_id AS "sourceId"
FROM playbook
```

### 10.2 Мутации плейбука
После ЛЮБОЙ мутации плейбука:
```ts
queryClient.invalidateQueries({ queryKey: ["playbook"] });
queryClient.invalidateQueries({ queryKey: ["playbook-children"] });
```

### 10.3 Плейбук staleTime
```ts
staleTime: 0, gcTime: 0
```

### 10.4 Скриншоты
- `screenshotUrl` — URL-ы через `\n`
- `screenshotNotes` — JSON-строка массива: `["Подпись 1", "Подпись 2"]`

### 10.5 Кураторы — из БД
```ts
// Frontend: useAuth().isCurator
// Backend: pool.query("SELECT 1 FROM users WHERE name=$1 AND role='curator' AND active=true", [name])
```

### 10.6 Трейдеры — из dbUsers
```ts
const { dbUsers } = useAuth();
const activeTraders = dbUsers.filter(u => u.active).map(u => u.name);
```

### 10.7 Soft Delete
GET: `WHERE deleted_at IS NULL`. DELETE: `SET deleted_at = NOW()`.

### 10.8 LocalStorage Big7
Паттерн `updateTickerDayField()` — всегда читает текущее состояние перед записью.

### 10.9 PATCH playbook
НЕ сбрасывать parentId если он не передан в body.

### 10.10 Dev vs Production — ДВЕ РАЗНЫЕ БАЗЫ ДАННЫХ
**КРИТИЧЕСКИ ВАЖНО**: Replit использует **раздельные БД** для dev и production.
- Dev БД доступна через `DATABASE_URL` при разработке
- Production БД — отдельная копия, созданная при первом деплое
- **Любые данные, добавленные напрямую в dev БД (через psql, API seed, SQL INSERT), НЕ попадут в production автоматически!**
- **Решение**: Все seed-данные (стратегии, пользователи) ОБЯЗАНЫ быть в `migrate.ts` с проверкой на существование. При деплое migration автоматически добавит недостающие данные.
- **Если данные видны в dev но не в production** → проверь: 1) был ли деплой после изменения, 2) есть ли seed в migrate.ts
- **Если пользователь сообщает "не вижу записи"** → первым делом спроси: dev preview или deployed версия? Проверь обе БД.
- Проверка production: `executeSql({ sqlQuery: "SELECT ...", environment: "production" })`
- Никогда не добавляй данные в БД через psql без дублирования в migrate.ts!

### 10.11 SETUP_TYPES — синхронизация с БД
Если добавляешь новый `setup_type` в БД (через seed или API), **обязательно** добавь его в массив `SETUP_TYPES` в `playbook.tsx`. Иначе он не будет доступен в выпадающем списке при создании/редактировании сетапа.

### 10.12 Playbook Seed Стратегии
В `migrate.ts` содержатся автоматические seed'ы:
- **8 пользователей** (трейдеры + кураторы) — проверка `COUNT(*) FROM users`
- **55 стратегий плейбука** в едином seed-блоке:
  - 20 SMB Capital стратегий (9 папок: Offering/Gap/IPO/Intraday/Short/Momentum/Reversal/Swing/Frameworks)
  - 24 дополнительных стратегий (8 папок: Pre-Market & After Hours, Advanced Tape Reading, Mean Reversion, Gap Trading, Swing Trading, Earnings, Macro & Sector, Position Management)
  - 11 OPG/IMBX/MOC стратегий (3 папки: OPG / Auction Plays, Imbalance (IMBX) Strategies, MOC / Closing Auction)
- **Дедупликация по имени**: каждая стратегия вставляется через `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM playbook WHERE name = $1 AND deleted_at IS NULL)` — не создаёт дубликатов при повторных запусках.
- **ВАЖНО**: НЕ проверять по папке — имена папок могут отличаться (дефис/тире). Проверять ТОЛЬКО по `name`.

### 10.13 Инвалидация кеша React Query
После ЛЮБОЙ мутации данных (POST, PATCH, DELETE) обязательно вызывать `qc.invalidateQueries()`:
```ts
const qc = useQueryClient();
qc.invalidateQueries({ queryKey: ["playbook"] });
qc.invalidateQueries({ queryKey: ["playbook-children"] });
qc.invalidateQueries({ queryKey: ["trades"] });
```
- В sub-компонентах (TradeActions, PlaybookChildren) нужен свой `const qc = useQueryClient()`
- Прямые fetch-мутации (без useMutation) тоже ОБЯЗАНЫ инвалидировать кеш
- Без инвалидации UI не обновляется после изменений — пользователь не видит свои действия

### 10.14 GitHub Backup
- Репо: `iskhakovzak/WS_LEXX` (приватный)
- Ветки: `main`, `release-v1.0`
- Release v1.0: содержит node_modules.tar.gz, dist.tar.gz, cache.tar.gz
- Для загрузки на GitHub используется GitHub API через Replit integration (token из `listConnections('github')`)
- Деструктивные git-команды заблокированы в main agent — использовать GitHub API через code_execution

## 11. ФАЙЛОВАЯ СТРУКТУРА

```
/
├── package.json, pnpm-workspace.yaml, .npmrc, tsconfig.json
├── replit.md, PROJECT_RECOVERY_PROMPT.md
├── artifacts/
│   ├── api-server/
│   │   ├── package.json, tsconfig.json, build.ts
│   │   └── src/
│   │       ├── index.ts, app.ts
│   │       ├── routes/ (17 route files + index.ts)
│   │       └── lib/ (asyncHandler.ts, migrate.ts, logger.ts)
│   ├── edge-tracker/
│   │   ├── package.json, tsconfig.json, vite.config.ts, index.html
│   │   └── src/
│   │       ├── main.tsx, App.tsx, index.css
│   │       ├── pages/ (16 page files)
│   │       ├── components/ (6 files + ui/)
│   │       ├── contexts/ (auth-context.tsx, theme-context.tsx)
│   │       └── lib/ (tags.ts, format.ts, utils.ts)
│   └── backups/ (SQL dump + JSON exports)
├── lib/
│   ├── api-spec/ (openapi.yaml, orval.config.ts)
│   ├── api-client-react/ (auto-generated)
│   ├── api-zod/ (auto-generated)
│   └── db/ (drizzle.config.ts, src/index.ts, src/schema/)
└── attached_assets/
```

## 12. МИГРАЦИИ (migrate.ts)

Файл `artifacts/api-server/src/lib/migrate.ts`:
1. `CREATE TABLE IF NOT EXISTS` для ВСЕХ 17 таблиц
2. `ALTER TABLE ADD COLUMN IF NOT EXISTS` для колонок добавленных позже
3. Seed default users (если таблица `users` пуста)
Запускается автоматически при старте API сервера.

## 13. ВОССТАНОВЛЕНИЕ — ПОШАГОВАЯ ИНСТРУКЦИЯ

1. Создать Repl (Node.js), включить PostgreSQL
2. Скопировать весь код
3. `pnpm install`
4. Проверить `DATABASE_URL` (Replit ставит автоматически)
5. `pnpm --filter @workspace/api-server run build`
6. Создать workflow "Start application" с командой из раздела 3
7. Запустить — migrate.ts создаст таблицы + seed users
8. Восстановить данные: `psql "$DATABASE_URL" < artifacts/backups/replit_postgres_full_dump.sql`
9. Проверить: войти как Закир/0101, проверить все страницы

## 14. БЕКАП ДАННЫХ

В `artifacts/backups/`:
- `replit_postgres_full_dump.sql` — полный SQL дамп (1687 строк)
- JSON по каждой таблице: users (8), trades (54), playbook (48), market_events (11), research (8), daily_feed (9), discussions (10), watchlist (8), activity_log (14), big7_levels (1), trader_ratings (1)
- Пустые: comments, trade_reactions, trading_errors, trade_reviews, playbook_trade_ideas, big7_catalysts

## 15. ИЗВЕСТНЫЕ ОСОБЕННОСТИ

1. **НЕ использовать Supabase** — IPv6-only, не работает из Replit
2. **Raw SQL ОБЯЗАТЕЛЬНО camelCase** — иначе фронтенд не видит данные
3. **Плейбук parent_id** — PATCH не должен сбрасывать если не передан
4. **playbook staleTime: 0** — иначе данные "залипают"
5. **Кураторы ТОЛЬКО из БД** — не хардкодить
6. **Big7 localStorage race** — использовать updateTickerDayField()
7. **API mount point** — `app.use("/api", router)`, т.е. `/api/trades` и т.д.
8. **TradingView виджеты** — нужен интернет
9. **Admin пароль** — `0987`
10. **Soft delete** — `deleted_at`, GET фильтрует `WHERE deleted_at IS NULL`
