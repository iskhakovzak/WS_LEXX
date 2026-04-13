# WS_LEXX Database Backup

**Дата:** 2026-04-13 09:49 UTC  
**БД:** Replit PostgreSQL (local, `DATABASE_URL`)

## Файлы

| Файл | Описание |
|------|----------|
| `full_dump.sql` | Полный SQL дамп — CREATE TABLE + INSERT для всех данных. Используй для полного восстановления |
| `*.csv` | Каждая таблица отдельным CSV файлом с заголовками |

## Строк в таблицах

| Таблица | Строк |
|---------|-------|
| trades | 92 |
| playbook | 127 |
| playbook_trade_ideas | 0 |
| research | 4 |
| daily_feed | 5 |
| market_events | 10 |
| discussions | 7 |
| comments | 7 |
| watchlist | 4 |
| activity_log | 125 |
| trade_reactions | 1 |
| trade_reviews | 0 |
| trader_ratings | 0 |
| trading_errors | 0 |
| users | 8 |
| war_room_sessions | 1 |
| war_room_levels | 0 |
| big7_levels | 1 |
| big7_catalysts | 0 |

## Как восстановить

### Полное восстановление из SQL дампа:
```bash
psql $DATABASE_URL < db-backup/full_dump.sql
```

### Восстановить одну таблицу из CSV:
```bash
psql $DATABASE_URL -c "\COPY trades FROM 'db-backup/trades.csv' WITH CSV HEADER"
```
