# Binance Square → Telegram Monitor

Мониторит профиль **Binance News** на Binance Square и мгновенно пересылает новые посты в Telegram.

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
├── binance_client.py  # запросы к Binance Square API
├── telegram_client.py # отправка в Telegram Bot API
├── storage.py         # чтение/запись storage.json (дедупликация)
├── config.py          # все настройки в одном месте
├── requirements.txt
└── storage.json       # создаётся автоматически при первом запуске
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

Боевой запуск:

```bash
python3 main.py
```

Ожидаемый вывод при успехе:
```
2026-06-16 12:00:00 [INFO] monitor — Binance Square Monitor — starting
2026-06-16 12:00:00 [INFO] monitor — No storage.json found — running bootstrap (skip history)
2026-06-16 12:00:00 [INFO] monitor — Bootstrap: baseline set to id=XXX | title='...'
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

## Логика дедупликации

- `storage.json` хранит последние 500 `id` уже обработанных постов и время самого нового (`last_time`). Запись атомарная.
- При первом запуске (или если файла нет / старый формат): все видимые посты помечаются как просмотренные — история не отправляется. Если API недоступен, bootstrap повторяется, пока не получится, чтобы не отправить всю страницу разом.
- При каждом опросе: отправляются посты, чьих `id` нет в `storage.json`, от старых к новым. Посты, опубликованные больше чем на час раньше `last_time` (старый пост всплыл после правки), только помечаются.
- Ошибка Telegram: до 3 попыток (с учётом `retry_after` при 429), затем пост помечается, чтобы не зациклиться.

## Логи на Replit VM

`scripts/start-vm.sh` запускает монитор в фоне с автоперезапуском и пишет лог в `/tmp/binance-monitor.log` (ротация по 2 MB). Последние 200 строк доступны админу через `GET /api/monitor-log`.

## Формат сообщений в Telegram

```
🚨 Binance News

{title}

{bodyTextOnly}

🕒 {firstReleaseTime}

🔗 {webLink}
```
