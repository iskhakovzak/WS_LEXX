# Binance Square → Telegram Monitor

Мониторит профиль **Binance News** на Binance Square и мгновенно пересылает в Telegram новые посты, **релевантные рынку** (US-акции, макро, Трамп/политика, сырьё, AI/полупроводники, крупные события по BTC/ETH). Остальное (спорт, крипто-мусор, промо Binance и т.п.) отсеивается фильтром — см. раздел «Фильтр».

## Endpoint

```
GET https://www.binanceuz.co/bapi/composite/v2/friendly/pgc/content/
    queryUserProfilePageContentsWithFilter
    ?targetSquareUid=RF5v7JH_6MiIJr-91F-aBA&timeOffset=-1&filterType=ALL
```

> ⚠️ Binance блокирует IP-адреса облачных провайдеров (Replit, AWS, GCP, Hetzner cloud).
> Запускать на домашнем VPS или машине с жилым IP.

## Структура

```
binance-monitor/
├── main.py            # точка входа, asyncio event loop
├── processing.py      # логика опроса: перечитывание фильтра, отсечка по возрасту, изоляция постов, алерт
├── binance_client.py  # запросы к Binance Square API
├── filter.py          # фильтр новостей: classify(post) → keep/drop + категория + причина
├── filters.json       # ключевые слова, веса и пороги фильтра (редактируется без кода)
├── formatter.py       # оформление сообщения (Telegram HTML)
├── telegram_client.py # отправка в Telegram Bot API
├── storage.py         # чтение/запись storage.json (дедупликация)
├── config.py          # все настройки в одном месте
├── review_filter.py   # прогон фильтра по сохранённым постам (для настройки)
├── tests/             # unit-тесты (без сети) + fixtures/posts.json — 200 реальных постов
├── requirements.txt
├── storage.json       # создаётся автоматически при первом запуске
└── filters.last-good.json  # копия последнего рабочего filters.json (создаётся автоматически)
```

## Запуск на VPS (Ubuntu/Debian)

### 1. Установка Python и зависимостей

```bash
sudo apt update && sudo apt install -y python3 python3-pip
cd /opt
git clone <repo> binance-monitor   # или скопируй файлы вручную
cd binance-monitor
pip3 install -r requirements.txt
```

### 2. Переменные окружения

```bash
export TELEGRAM_BOT_TOKEN="<токен_от_BotFather>"
export TELEGRAM_CHAT_ID="<chat_id>"
```

Или создай файл `.env` и загружай через `source .env`.

### 3. Тест запуска

Пробный прогон без отправки в Telegram (сообщения печатаются в лог):

```bash
DRY_RUN=1 python3 main.py
```

Без фильтра (пересылать всё, как раньше):

```bash
FILTER_OFF=1 python3 main.py
```

Боевой запуск:

```bash
python3 main.py
```

Необязательные переменные:

```bash
MAX_POST_AGE_MINUTES=15   # посты старше N минут на момент, когда бот их впервые увидел, не отправляются (0 — без отсечки)
POLL_ALERT_MINUTES=10     # опрос Binance падает N минут подряд → алерт
```

Если опрос Binance не работает `POLL_ALERT_MINUTES` минут подряд, в логе появляется строка `🚨 ALERT: Binance polling has failed for N min`, а в канал (`TELEGRAM_CHAT_ID`, кроме `DRY_RUN=1`) уходит одно короткое сообщение — не чаще раза в час. После восстановления в логе: `Binance API recovered after N error(s)`.

Ожидаемый вывод при успехе:
```
2026-06-16 12:00:00 [INFO] monitor — Binance Square Monitor — starting
2026-06-16 12:00:00 [INFO] monitor — Loaded filters.json: enabled=True, min_score=5, crypto_major=True, categories=…
2026-06-16 12:00:00 [INFO] monitor — Age cutoff: posts older than 15 min when first seen are not sent; polling alert after 10 min of errors
2026-06-16 12:00:00 [INFO] monitor — No usable storage.json — running bootstrap (skip history)
2026-06-16 12:00:00 [INFO] monitor — Bootstrap: 20 existing posts marked seen | newest='...'
2026-06-16 12:00:00 [INFO] monitor — ✅ Polling every 1.0s  |  Ctrl+C to stop
```

### 4. Автозапуск через systemd

Создай файл `/etc/systemd/system/binance-monitor.service`:

```ini
[Unit]
Description=Binance Square → Telegram Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/binance-monitor
Environment=TELEGRAM_BOT_TOKEN=<токен_от_BotFather>
Environment=TELEGRAM_CHAT_ID=<chat_id>
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable binance-monitor
sudo systemctl start binance-monitor
sudo journalctl -u binance-monitor -f   # логи в реальном времени
```

### 5. Запуск через screen (альтернатива без systemd)

```bash
screen -S binance
python3 main.py
# Ctrl+A, D — отсоединиться
screen -r binance  # вернуться
```

## Настройка (config.py)

| Параметр | По умолчанию | Описание |
|---|---|---|
| `BINANCE_API_URL` | подтверждённый endpoint | Менять если Binance изменит путь |
| `BINANCE_UID` | `RF5v7JH_6MiIJr-91F-aBA` | targetSquareUid профиля Binance News |
| `POLL_INTERVAL` | `1.0` | Интервал опроса в секундах |
| `REQUEST_TIMEOUT` | `10` | HTTP timeout |
| `RETRY_DELAY_BASE` | `5` | Базовая задержка при ошибке (×N, cap 60s) |
| `MAX_POST_AGE_MINUTES` | `15` (env) | Пост старше N минут на момент первого появления — только помечается, не отправляется; `0` — без отсечки |
| `POLL_ALERT_MINUTES` | `10` (env) | Через сколько минут непрерывных ошибок опроса писать алерт |
| `POLL_ALERT_REPEAT_S` | `3600` | Алерт в Telegram — не чаще раза в N секунд |
| `FILTERS_LAST_GOOD_FILE` | `filters.last-good.json` (env) | Куда сохраняется последний рабочий filters.json |

## Логика дедупликации

- `storage.json` хранит последние 500 `id` уже обработанных постов и время самого нового (`last_time`). Запись атомарная.
- При первом запуске (или если файла нет / старый формат): все видимые посты помечаются как просмотренные — история не отправляется. Если API недоступен, bootstrap повторяется, пока не получится, чтобы не отправить всю страницу разом.
- При каждом опросе: отправляются посты, чьих `id` нет в `storage.json`, от старых к новым. Пост старше `MAX_POST_AGE_MINUTES` (15 мин) на момент, когда бот его впервые увидел, только помечается (`⏳ OLD` в логе): после простоя бота в канал не уходит пачка старых новостей, всплывший после правки старый пост — тоже.
- Каждый пост обрабатывается отдельно: «битый» пост (неожиданная структура) пишется в лог `Malformed post id=… skipped` и помечается — бот не падает и не зацикливается на нём.
- Ошибка Telegram: до 3 попыток (с учётом `retry_after` при 429), затем пост помечается, чтобы не зациклиться.

## Логи на Replit VM

`scripts/start-vm.sh` запускает монитор в фоне с автоперезапуском и пишет лог в `/tmp/binance-monitor.log` (ротация по 2 MB). Последние 200 строк доступны админу через `GET /api/monitor-log`.

## Формат сообщений в Telegram

Отправляются с `parse_mode=HTML` (весь текст экранируется; если Telegram всё же отвергнет разметку — сообщение уходит обычным текстом). Длина ≤ 4096 символов.

```
📈 Акции · #Downgrade #iPhone · $AAPL         ← категория, ключевые слова из заголовка, тикеры
Apple Gets Loop Capital Downgrade on Slow…     ← жирный заголовок = ссылка на исходный пост
Loop Capital downgraded Apple to hold from buy.   ← одно короткое предложение (≤ 180 символов)
```

- первая строка: эмодзи и категория по-русски, до 4 ключевых слов, из-за которых пост прошёл фильтр (хэштеги, как в заголовке), и кэштеги;
- кэштеги US-тикеров: из текста (`AAPL.O`, `(NASDAQ: NVDA)`), по названию компании (`company_tickers` в filters.json) и из торговых пар поста — пара берётся, только если тикер/компания упомянуты в тексте (Binance часто прикрепляет лишние пары);
- превью ссылки выключено — лента компактная.

## Фильтр

Задача — пропускать в канал только то, что важно трейдеру US-акций: рынок, макро, Трамп/политика/геополитика, сырьё, AI/полупроводники и крупные события по BTC/ETH. Всё отброшенное **пишется в лог одной строкой с причиной**:

```
[INFO] monitor — ⛔ DROP id=3793… score=-100 | deny:binance_promo('binance wallet') | 'Binance Wallet Launches …'
[INFO] monitor — 🆕 SEND id=3793… 📈 stocks score=15 | stocks 15≥5: 'downgrade*', 'apple', 'price target' | 'Apple Gets …'
```

Категории (эмодзи в начале сообщения):

| | Категория | Примеры |
|---|---|---|
| 🇺🇸 | `macro` — макро / ФРС / данные | ADP, CPI, Fed, ставки, доходности, рецессия |
| 🏛 | `policy` — Трамп / политика / тарифы / геополитика | тарифы, санкции, Белый дом, Ормузский пролив, танкеры |
| 📈 | `stocks` — акции | отчёты, гайденс, M&A, рейтинги/таргеты, премаркет, фьючерсы, индексы |
| 🛢 | `commodities` — сырьё | нефть, газ, золото, серебро, медь |
| 🤖 | `ai` — AI / полупроводники | Nvidia, Micron, TSMC, CoreWeave, дата-центры |
| ₿ | `crypto` — только крупное по BTC/ETH | ETF, SEC/регулирование, крупные институционалы, сильные движения |

### Как считается

1. У каждой категории — ключевые слова с весами. Слово в **заголовке** даёт `вес × title_weight` (2), только в **тексте** — `вес × body_weight` (1); смотрятся первые `body_chars` символов текста и хэштеги. При `require_title_hit: true` категория засчитывается, только если хотя бы одно её слово есть в заголовке.
2. Торговые пары поста дают бонус: US-акции (`AAPLB`, `RTX.US`) → `stocks`, фьючерсы на сырьё (`CL`, `XAU`…) → `commodities`, `BTC`/`ETH` → `crypto` (по `ticker_bonus`, не больше `ticker_bonus_cap`).
3. Группы `deny` вычитают штраф `penalty`. 100 = жёсткий запрет (Binance-промо, альткоины/мемкоины/киты, ТА-колонки, спорт, криминал/местные новости). Мягкие: финансирование стартапов (5), цитаты официальных представителей (5), «AI TRENDS |» (4), «Bitcoin News |» (3), второстепенные страны/UK (3), комментарии CEO (2). Если у поста только «мелкие» крипто-пары — ещё `minor_crypto_penalty`.
4. **score = лучшая категория − штрафы**; пост проходит, если `score ≥ min_score` (сейчас 5).
5. Слово из `allow` в заголовке (FOMC, Powell, CPI…) пропускает пост при любом счёте — кроме жёсткого запрета (штраф ≥ `hard_penalty`).

### Как настраивать filters.json

Файл перечитывается автоматически при изменении — перезапуск не нужен (в логе будет `Reloaded filters.json`). Если файл удалён, в нём ошибка JSON, неверное значение (например, `"weight": null`) или нет категорий — бот **оставляет последние рабочие правила** и пишет в лог ошибку `filters.json is broken (…) — keeping the last working rules`; после исправления файл подхватится сам. Последний рабочий файл сохраняется в `filters.last-good.json`, поэтому и перезапуск с битым filters.json фильтрует по нему. Только если рабочих правил нет вовсе (ни файла, ни копии), фильтр выключается и в лог пишется ошибка. Выключить фильтр намеренно: `"enabled": false` в файле или `FILTER_OFF=1`.

- **Слишком много шума** → поднять `min_score` (6–7) или добавить слово в подходящую группу `deny`.
- **Пропускается нужное** → снизить `min_score`, добавить слово/поднять вес в категории или добавить слово в `allow`.
- **Крипта совсем не нужна** → `"crypto_major": false`.
- **UK/Европа/Азия нужны** → убрать страну из `deny.non_us_local` или уменьшить его `penalty`.
- Синтаксис слов: `"oil"` — целое слово, любой регистр; `"tariff*"` — начало слова (tariff, tariffs); `"^stocks |"` — только в начале заголовка; слово с **заглавными буквами** (`"SEC"`, `"US"`, `"Fed"`) ищется с учётом регистра.

Проверить изменения до выкладки — прогнать фильтр по сохранённым постам (сеть не нужна):

```bash
python3 review_filter.py tests/fixtures/posts.json            # все посты: KEEP/drop, категория, счёт, причина
python3 review_filter.py tests/fixtures/posts.json --drop     # только отброшенные
python3 review_filter.py tests/fixtures/posts.json --keep -v  # пропущенные + детали подсчёта
python3 -m unittest discover -s tests                          # тесты (размеченные keep/drop посты + форматирование)
```

Подходит и сырой ответ API (`{"data": {"contents": [...]}}`) или список постов.

Переменные окружения: `FILTER_OFF=1` — пересылать всё без фильтра; `FILTERS_FILE=/path/filters.json` — другой файл правил.
