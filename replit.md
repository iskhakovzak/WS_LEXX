# WS_LEXX - PROP TRADING DESK

Внутренний инструмент для проп-трейдинговой команды. 8 трейдеров.

## Стек
- **Monorepo pnpm** в `artifacts/`
- **API:** `artifacts/api-server/` — Express 5, TypeScript, Drizzle ORM + pg pool, порт 3000
- **Frontend:** `artifacts/edge-tracker/` — React 18 + Vite, TanStack Query, Tailwind, ShadcnUI, порт 5000
- **БД:** Replit PostgreSQL (встроенный). НЕ Supabase — он IPv6-only, не работает

## Запуск
```
Workflow "Start application":
cd artifacts/api-server && PORT=3000 node --enable-source-maps ./dist/index.mjs & cd artifacts/edge-tracker && PORT=5000 pnpm run dev
```
Перед перезапуском пересобрать API: `pnpm --filter @workspace/api-server run build`

## Критические правила
1. Raw SQL запросы → всегда camelCase псевдонимы (`setup_type AS "setupType"`, `parent_id AS "parentId"` и т.д.) иначе фронтенд не видит данные
2. НЕ переключать на Supabase
3. PATCH `/api/playbook/:id` обновляет только переданные поля — `parentId` не сбрасывается

## Авторизация (auth-context.tsx)
Только фронтенд, нет backend-auth. Сессия в `localStorage["ws_lexx_session"]`.

| Трейдер | Пароль | Роль |
|---------|--------|------|
| Закир | `0101` | trader |
| Антон | `61725` | **куратор** |
| Артур | `93547` | trader |
| Рахматулло | `5555` | trader |
| Умид | `15964` | trader |
| Максат | `82374` | trader |
| Тимур | `39156` | **куратор** |
| Ариф | `07770` | **куратор** |
| Admin | `0987` | — |

Роли: `trader` (полный доступ) / `guest` (только просмотр). `<WriteOnly>` скрывает UI для гостей.
Кураторы: определяются динамически из таблицы `users` (role='curator'). Могут оставлять ревью и еженедельные оценки.

## Динамическое управление пользователями
- Таблица `users` в БД: `id, name, password, role (trader|curator), active, created_at`
- API: `GET /api/users` (только active), `GET /api/users/all`, `POST /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id` (soft-delete)
- Все мутации требуют `adminPassword: "0987"` в body
- `auth-context.tsx` экспортирует: `useAuth` (возвращает `user, dbUsers, refreshUsers, isCurator`), `WriteOnly`, `AuthProvider`, `DbUser`
- Нет статических `TRADERS`/`CURATORS` — всё из `dbUsers`
- UI управления: в Настройках, секция «Управление пользователями» (требует пароль админа `0987`)

## Плейбук — ключевая логика
- `parent_id = NULL` → корневой сетап (показывается в списке)
- `parent_id = N` → дочерний (скрыт из главного списка, виден внутри родителя)
- `topLevel = entries.filter(e => !e.parentId)`
- `screenshotUrl` = URL через `\n`; `screenshotNotes` = JSON массив строк
- Порядок папок: `localStorage["playbook-folder-order"]`
- Запрос плейбука: `staleTime: 0, gcTime: 0` — всегда свежие данные
- После мутаций: инвалидировать `["playbook"]` и `["playbook-children"]`
- Лента действий: кнопка «Действия» раскрывает панель с последними событиями в плейбуке

## Система оценки трейдеров (ratings)
- Таблица `trader_ratings`: discipline, risk_management, execution, journaling, improvement, overall (1-10)
- API: `GET /api/ratings`, `GET /api/ratings/summary`, `POST /api/ratings`, `DELETE /api/ratings/:id`
- Только кураторы могут ставить оценки
- Страница `/ratings` — карточки со сводкой + понедельный список оценок

## Теги (tags.ts)
8 категорий: Сетап, Катализатор, Уровни, Профиль акции, Условия рынка, Исполнение, Ошибки/Уроки, Результат.
`TagChipEditor` используется в формах создания/редактирования (основной и дочерний).

## Радар (Big 7) — `/big7`
- Страница мониторинга ключевых тикеров (по умолчанию Mag7)
- **TradingView графики** — свечи + объем + MA, разворачиваемые
- **Market Context Bar** — SPY/QQQ bias, VIX уровень, gap direction, заметки
- **Per-ticker features**: In Play 🔥 toggle, Premarket Bias (bull/bear/neutral/watch), RS vs SPY (1-5), Gap & Range (gap%, open, expected range по ATR), Trade Plan (текстовые заметки-план)
- **Key Levels** — support/resistance/pivot/vwap/PM high-low/ATH/gap fill + action plan (buy/sell/watch/fade/breakout/breakdown)
- **Position Calculator** — risk $, entry, stop → shares + size
- **Session Scorecard** — 1-5 stars + review notes
- **Catalyst Calendar** — earnings, FOMC, product launch, sector events (БД таблица `big7_catalysts`)
- Данные: уровни + катализаторы в PostgreSQL; дневные данные (bias, RS, gap, in play, score) в localStorage (`big7_day_{ticker}_{date}`)
- Настройки тикеров в localStorage (`big7_custom_tickers`)
- Фильтр "In Play Only" + режим Compact/Full

## БД — главные таблицы
`playbook`, `trades`, `market_events`, `research`, `daily_feed`, `discussions`,
`comments`, `watchlist`, `activity_log`, `trade_reactions`, `trading_errors`,
`trade_reviews`, `playbook_trade_ideas`, `big7_levels`, `big7_catalysts`, `trader_ratings`

Миграции: `migrate.ts` — `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`
Seed: запускается только если `trades` таблица пустая

## Текущее состояние (апрель 2026)
- 47 записей в плейбуке: 20 SMB Capital стратегий (IDs 29-48) + 27 других
- Дочерние сетапы работают полностью (создание, редактирование, скрины)
- Теговая система: 8 категорий шаблонов + ручной ввод + drag-reorder
- Все API роуты возвращают camelCase
- Система рейтинга трейдеров с 6 категориями оценки

## Полный промт восстановления
Смотри файл `PROJECT_RECOVERY_PROMPT.md` — там всё детально.
