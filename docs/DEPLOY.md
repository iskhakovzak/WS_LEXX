# Выкладка WS_LEXX на собственный сервер

Единственная инструкция выкладки (решение владельца от 20.10.2026: свой сервер в офисе, планировщик внутри API,
Replit / Supabase / Vercel не используются). Всё, что ниже, проверено по коду: `artifacts/api-server/src/config.ts`,
`src/index.ts`, `scripts/build-prod.sh`, `src/jobs/definitions.ts`.

## 0. Как это устроено

```
 Интернет ──443──▶ Caddy (TLS, сжатие) ──▶ 127.0.0.1:8080  ws-lexx-api.service (Node 24)
                                              ├─ сайт (собранный React из dist/public)
                                              ├─ /api/* (Express)
                                              └─ фоновые задачи (утро/вечер в Telegram, награды, квесты,
                                                 синхронизация PropReports, бэкап базы …)
                                                        │
                                                        ▼
                                              PostgreSQL 16 (только localhost)

 ws-news.service (Python) ── опрашивает Binance Square ──▶ канал WS News в Telegram
 /var/backups/ws-lexx      ── ежедневные pg_dump от задачи db.backup (+ копия вне сервера)
```

- **Один процесс Node** отдаёт и сайт, и API (заголовки безопасности и CSP одни на всё). Caddy только принимает
  HTTPS и проксирует всё на порт 8080.
- **Фоновые задачи** живут в том же процессе (`JOBS_ENABLED=true`). Каждая берёт advisory-lock в базе, поэтому
  второй случайно запущенный экземпляр ничего не задвоит, но держите один экземпляр API на одну базу.
- **Миграции** применяются сами при старте API. Если миграция падает, API на проде **не стартует** — это сигнал
  откатить код (раздел 9).

## 1. Сервер

- Ubuntu 24.04 LTS, 2 vCPU, 4 ГБ RAM, 40 ГБ SSD — с запасом на 50 трейдеров.
- Часовой пояс сервера не важен (код сам считает торговый день по Нью-Йорку); оставьте UTC.
- **Домен** (например `desk.example.com`) с A-записью на внешний IP офиса и проброшенными портами 80 и 443 на
  сервер. Публичный HTTPS обязателен для Telegram: бот получает нажатия кнопок и привязку аккаунтов через вебхук.
  Если пробросить порты нельзя — Cloudflare Tunnel (раздел 5.3), порты тогда не открываются.
- IP офиса должен быть «жилым/офисным», не облачным: Binance блокирует IP облачных провайдеров (бот WS News).

## 2. Пакеты

```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y git curl ca-certificates gnupg ufw postgresql-16 postgresql-client-16 python3-venv

# Node 24 (NodeSource) и pnpm (версию берёт corepack из package.json → packageManager)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable

# Caddy (официальный репозиторий)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Брандмауэр: снаружи только SSH и веб. PostgreSQL слушает только localhost (так по умолчанию).
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

Проверка: `node -v` → `v24.x`, `pg_dump --version` → `16.x` (pg_dump не старше сервера базы, иначе бэкап
откажется работать и напишет об этом в лог).

## 3. Пользователь, каталоги, база

```bash
# Системный пользователь, под которым работают API и бот; ему принадлежат код и бэкапы
sudo adduser --system --group --home /opt/ws-lexx --shell /bin/bash wslexx
sudo install -d -o wslexx -g wslexx -m 700 /var/backups/ws-lexx
sudo install -d -o root -g wslexx -m 750 /etc/ws-lexx

# База и роль (пароль придумайте длинный, он пойдёт в DATABASE_URL)
sudo -u postgres createuser --pwprompt wslexx
sudo -u postgres createdb -O wslexx ws_lexx
```

**Перенос данных с ПК** (сейчас всё живёт на ПК владельца в локальной базе `edge_tracker`):

```bash
# на ПК (Postgres из `pnpm --filter @workspace/scripts run local-db` должен быть запущен)
pg_dump -Fc --no-owner --no-privileges -d postgresql://postgres:postgres@localhost:5432/edge_tracker -f ws-lexx.dump
scp ws-lexx.dump admin@<сервер>:/tmp/

# на сервере
sudo -u postgres pg_restore --no-owner --role=wslexx -d ws_lexx /tmp/ws-lexx.dump && rm /tmp/ws-lexx.dump
```

Без переноса база создаётся с нуля миграциями при первом старте, а первые учётки задаёт `SEED_USERS` (раздел 4).

## 4. Код, переменные окружения, сборка

```bash
sudo -u wslexx -H bash -lc '
  cd /opt/ws-lexx
  git clone <адрес приватного репозитория WS_LEXX> app   # доступ: deploy key только на чтение
  cd app
  pnpm install --frozen-lockfile
  bash scripts/build-prod.sh
'
```

`scripts/build-prod.sh` делает ровно три вещи: `vite build` сайта (`pnpm --filter @workspace/edge-tracker run build`,
`BASE_PATH=/`), сборку API (`pnpm --filter @workspace/api-server run build` → `artifacts/api-server/dist/index.mjs`)
и копирует сайт в `artifacts/api-server/dist/public`, откуда его отдаёт API.

### 4.1 `/etc/ws-lexx/api.env`

Единственный файл с секретами сервера (`sudo install -o root -g wslexx -m 640 /dev/null /etc/ws-lexx/api.env`, затем
отредактировать). Полный список переменных с пояснениями — `artifacts/api-server/.env.example`; сервер читает их только
в `src/config.ts`. Секреты генерируйте так: `openssl rand -hex 32` (каждый свой).

**Обязательные — без них сервер на проде не стартует** (одна понятная ошибка со списком всего, чего не хватает):

| Переменная | Значение |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `DATABASE_URL` | `postgresql://wslexx:<пароль>@127.0.0.1:5432/ws_lexx` |
| `JWT_SECRET` | подпись сессий |
| `MEDIA_TOKEN_SECRET` | отдельный секрет ссылок на голосовые заметки; не равен `JWT_SECRET` |
| `TELEGRAM_WEBHOOK_SECRET` | отдельный секрет вебхука Telegram; не равен `JWT_SECRET` |

**Сервер и фоновые задачи:**

| Переменная | Значение |
|---|---|
| `JOBS_ENABLED` | `true` — планировщик в процессе API (утро/вечер, награды, квесты, PropReports, бэкап) |
| `BACKUP_DIR` | `/var/backups/ws-lexx` — куда задача `db.backup` пишет дампы (раздел 7) |
| `BACKUP_CRON` | `15 3 * * *` — время бэкапа по Нью-Йорку (по умолчанию так) |
| `SITE_URL` | `https://desk.example.com` — ссылки в Telegram |
| `TRUST_PROXY` | `loopback` — доверять только Caddy на этом же сервере (`req.ip` = адрес клиента) |
| `LOG_LEVEL` | `info` |
| `GUEST_MODE` | не задавать: на проде гостевой вход выключен |

**Telegram (бот уведомлений и карточек):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`TELEGRAM_WEBHOOK_URL=https://desk.example.com/api/telegram/webhook` (регистрируется при каждом старте на проде),
`TELEGRAM_GROUP_CHAT_ID` — только если включены посты достижений в группу.

**PropReports (сделки):** `PROPREPORTS_DOMAIN`, `PROPREPORTS_TOKEN`, `PROPREPORTS_GROUP_ID`, `PROPREPORTS_ACCOUNT_IDS`,
`PROPREPORTS_SYNC_MINUTES=10` (≥ 5 включает синхронизацию в течение дня), при необходимости `PROPREPORTS_ACCESS_LEVEL`.
`CRON_SECRET` не нужен: синхронизацию запускает планировщик API, а не внешний cron.

**Рынок и канал WS News (утренние/дневные сводки из API):** `FINVIZ_AUTH`, `NEWS_CHANNEL_BOT_TOKEN`,
`NEWS_CHANNEL_CHAT_ID` (плюс переключатель «Канал WS News» в «Админка → Настройки деска», по умолчанию выключен).

**ИИ и расшифровка голоса (по желанию):** `AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com` и
`AI_INTEGRATIONS_ANTHROPIC_API_KEY` (ключ своего аккаунта Anthropic), `ANTHROPIC_MODEL`, `AI_DAILY_COST_BUDGET_USD`;
`AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1` и `AI_INTEGRATIONS_OPENAI_API_KEY` для расшифровки, либо
`TRANSCRIBE_PROVIDER=local` + `WHISPER_URL` (свой whisper-server рядом).

**Первый запуск на пустой базе:** `SEED_USERS='[{"name":"…","password":"…","role":"admin"}]'` — учётки создаются, только
если таблица `users` пуста; после первого входа уберите переменную. `ADMIN_PASSWORD` / `INIT_PASSWORDS` и
`PLAYBOOK_PASSWORD` — по желанию (см. `.env.example`).

**Не используются на своём сервере:** `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`,
`PRIVATE_OBJECT_DIR` (хранилище Replit). Без них не работают голосовые заметки (сейчас 0 записей); бэкапы идут в
`BACKUP_DIR`.

### 4.2 `/etc/ws-lexx/news.env` (бот WS News)

```
TELEGRAM_BOT_TOKEN=<токен бота канала WS News>
TELEGRAM_CHAT_ID=<id канала WS News>
MAX_POST_AGE_MINUTES=15
POLL_ALERT_MINUTES=10
```

## 5. Сервисы

### 5.1 API: `/etc/systemd/system/ws-lexx-api.service`

```ini
[Unit]
Description=WS_LEXX: сайт, API и фоновые задачи
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=wslexx
Group=wslexx
WorkingDirectory=/opt/ws-lexx/app
EnvironmentFile=/etc/ws-lexx/api.env
# RELEASE_SHA для трекера ошибок пишет процедура обновления (раздел 8)
EnvironmentFile=-/opt/ws-lexx/release.env
ExecStart=/usr/bin/node --enable-source-maps artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5
# SIGTERM: API перестаёт принимать запросы, дожидается текущих, останавливает задачи (жёстко — через 10 с)
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/ws-lexx /var/backups/ws-lexx

[Install]
WantedBy=multi-user.target
```

### 5.2 Бот WS News: `/etc/systemd/system/ws-news.service`

```bash
sudo -u wslexx -H bash -lc 'python3 -m venv /opt/ws-lexx/news-venv && /opt/ws-lexx/news-venv/bin/pip install -r /opt/ws-lexx/app/artifacts/binance-monitor/requirements.txt'
```

```ini
[Unit]
Description=WS News: Binance Square → Telegram
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wslexx
Group=wslexx
WorkingDirectory=/opt/ws-lexx/app/artifacts/binance-monitor
EnvironmentFile=/etc/ws-lexx/news.env
ExecStart=/opt/ws-lexx/news-venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Состояние бота (`storage.json`, `filters.last-good.json`) лежит рядом с кодом и в git не попадает. Правила фильтра —
`filters.json`, перечитываются без перезапуска (подробности: `artifacts/binance-monitor/README.md`).

**Один отправитель.** Пока всё работает на ПК, отправитель WS News — ПК. При переезде сначала остановите бота и API
на ПК (или уберите там токены Telegram), потом запускайте их на сервере: два отправителя — двойные посты, два API с
одним токеном бота — отнимают друг у друга вебхук.

### 5.3 Caddy: `/etc/caddy/Caddyfile`

```
desk.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
	log {
		output file /var/log/caddy/ws-lexx.log {
			roll_size 50MiB
			roll_keep 10
		}
	}
}
```

Caddy сам получает и продлевает сертификат Let's Encrypt (нужны открытые 80 и 443).
**Без проброса портов:** поставьте `cloudflared`, создайте туннель на `http://127.0.0.1:80` для `desk.example.com`, в
Caddyfile замените адрес сайта на `http://desk.example.com` и добавьте в начало глобальный блок
`{ servers { trusted_proxies static 127.0.0.1/32 } }` — тогда адрес клиента дойдёт до API.

### 5.4 Включить

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ws-lexx-api ws-news
sudo systemctl reload caddy
```

## 6. Проверка после первого запуска

```bash
journalctl -u ws-lexx-api -n 80 --no-pager | grep -E "migrations|Server listening|jobs|config"
curl -fsS https://desk.example.com/api/healthz          # {"status":"ok"} (база здесь не проверяется)
journalctl -u ws-news -n 20 --no-pager                  # «Polling every 1.0s»
```

Затем на сайте под админом: вход работает; «Админка → Данные → Задачи» — задачи с ближайшим запуском; «Данные →
Бэкапы» — после первого ночного запуска (или кнопки «Создать сейчас») появляется файл; «Интеграции» — свежая
синхронизация PropReports; в Telegram бот отвечает на `/start`.

## 7. Бэкапы

- **Задача `db.backup`** (в API): ежедневно в `BACKUP_CRON` по Нью-Йорку `pg_dump -Fc` пишет файл
  `/var/backups/ws-lexx/<время>.dump` (данные таблиц `*_cache` не сохраняются — они перекачиваются сами). Файл
  появляется под окончательным именем, только если pg_dump завершился успешно. Хранятся последние 14 дневных и
  8 недельных. После перезапуска задача догоняет пропуск, если последнему бэкапу больше 20 часов. Каждый бэкап
  пишется в журнал аудита; «нет свежего бэкапа» горит в «Админке → Обзор».
- **Копия вне сервера** — обязательна (сервер может умереть вместе с диском). Например, внешний диск или NAS,
  смонтированный в `/mnt/offsite`, и ежедневный таймер:

  ```ini
  # /etc/systemd/system/ws-lexx-offsite.service
  [Service]
  Type=oneshot
  ExecStart=/usr/bin/rsync -a --delete /var/backups/ws-lexx/ /mnt/offsite/ws-lexx/

  # /etc/systemd/system/ws-lexx-offsite.timer
  [Timer]
  OnCalendar=*-*-* 09:00 UTC
  Persistent=true
  [Install]
  WantedBy=timers.target
  ```

  `sudo systemctl enable --now ws-lexx-offsite.timer`.
- **Проверка восстановления раз в месяц** (на той же машине, в отдельную базу):

  ```bash
  F=$(ls -t /var/backups/ws-lexx/*.dump | head -1)
  sudo -u postgres createdb -O wslexx ws_lexx_restore_check
  sudo -u postgres pg_restore --no-owner --role=wslexx -d ws_lexx_restore_check "$F"
  sudo -u postgres psql -d ws_lexx_restore_check -c "select count(*) from trades"
  sudo -u postgres dropdb ws_lexx_restore_check
  ```

- **Восстановление рабочей базы:**

  ```bash
  sudo systemctl stop ws-lexx-api
  sudo -u postgres dropdb ws_lexx && sudo -u postgres createdb -O wslexx ws_lexx
  sudo -u postgres pg_restore --no-owner --role=wslexx -d ws_lexx /var/backups/ws-lexx/<файл>.dump
  sudo systemctl start ws-lexx-api
  ```

## 8. Обновление

Обновлять вечером или в выходные (не во время сессии: планировщик синхронизации и Telegram-сигналы на минуту
прерываются).

```bash
sudo -u wslexx -H bash -lc '
  set -e
  cd /opt/ws-lexx/app
  git rev-parse HEAD > ../previous-release                         # для отката
  mkdir -p /var/backups/ws-lexx/pre-update
  pg_dump -Fc --exclude-table-data="public.*_cache" -d "$(grep ^DATABASE_URL= /etc/ws-lexx/api.env | cut -d= -f2-)" \
    -f /var/backups/ws-lexx/pre-update/$(date -u +%Y%m%dT%H%M)-$(git rev-parse --short HEAD).dump
  git pull --ff-only origin main
  pnpm install --frozen-lockfile
  bash scripts/build-prod.sh
  echo "RELEASE_SHA=$(git rev-parse --short HEAD)" > ../release.env
'
sudo systemctl restart ws-lexx-api
journalctl -u ws-lexx-api -n 50 --no-pager | grep -E "migrations|Server listening"
curl -fsS https://desk.example.com/api/healthz
```

Миграции применяются сами при старте. Если в обновлении менялся бот (`artifacts/binance-monitor`):
`sudo systemctl restart ws-news` (и `pip install -r requirements.txt` в venv, если менялись зависимости).
Дампы из `pre-update/` не участвуют в ротации — удаляйте старые вручную.

## 9. Откат

1. **Код** (миграции аддитивные — старый код работает с новой схемой):

   ```bash
   sudo -u wslexx -H bash -lc '
     set -e
     cd /opt/ws-lexx/app
     git checkout --detach "$(cat ../previous-release)"
     pnpm install --frozen-lockfile
     bash scripts/build-prod.sh
     echo "RELEASE_SHA=$(git rev-parse --short HEAD)" > ../release.env
   '
   sudo systemctl restart ws-lexx-api
   ```

   Вернуться на ветку после исправления: `git checkout main` и обычное обновление.
2. **Данные** — только если обновление испортило данные: остановить API и восстановить дамп из
   `/var/backups/ws-lexx/pre-update/` (раздел 7, «Восстановление»), затем откатить код (шаг 1).
3. **API не стартует после обновления** («migrations FAILED — refusing to start» в журнале): откат кода (шаг 1);
   ошибку миграции исправить в репозитории и выкатить заново.

## 10. Логи

- API и бот пишут в journald: `journalctl -u ws-lexx-api -f`, `journalctl -u ws-news -f`. Ограничить объём:

  ```ini
  # /etc/systemd/journald.conf.d/ws-lexx.conf
  [Journal]
  SystemMaxUse=1G
  MaxRetentionSec=30day
  ```

  `sudo systemctl restart systemd-journald`.
- Caddy крутит свой журнал сам (`roll_size` / `roll_keep` в Caddyfile), PostgreSQL — через logrotate Ubuntu.
- Ошибки приложения дополнительно собираются в базе: «Админка → Ошибки» (и оповещение админам в Telegram).

## 11. Частые проблемы

| Симптом | Причина и что сделать |
|---|---|
| `Invalid server configuration: … MEDIA_TOKEN_SECRET is required in production` | не хватает переменной в `/etc/ws-lexx/api.env`; ошибка перечисляет всё недостающее разом |
| `migrations FAILED — refusing to start` | откат кода (раздел 9), миграцию чинить в репозитории |
| `TELEGRAM_WEBHOOK_URL is not set — Telegram webhook NOT registered` | задать адрес вебхука; без него бот только отправляет, кнопки и `/start` не работают |
| в «Бэкапах» пусто, в журнале `pg_dump major … is older than the server major` | поставить `postgresql-client` той же версии, что сервер базы |
| все запросы с одного IP, срабатывают лимиты входа | проверить `TRUST_PROXY=loopback`; за Cloudflare Tunnel — `trusted_proxies` в Caddy (раздел 5.3) |
| двойные посты в канале WS News | бот запущен и на ПК, и на сервере — оставить один (раздел 5.2) |

## 12. Разработка на ПК (не прод)

Локально: `pnpm --filter @workspace/scripts run local-db` (Postgres на 5432, база `edge_tracker`), затем API
(`cd artifacts/api-server && pnpm run build && set -a && . ../../.env.local && set +a && NODE_ENV=development PORT=8080
node --enable-source-maps dist/index.mjs`) и сайт (`pnpm --filter @workspace/edge-tracker run dev`). Переменные — в
`.env.local` в корне (образец `artifacts/api-server/.env.example`); сам сервер файлы `.env` не читает. Второй API на той
же базе запускайте с `JOBS_ENABLED=false`. Подробнее — `README.md`.

## 13. Локальный Whisper (бесплатная расшифровка голоса, по желанию)

По умолчанию голос расшифровывает OpenAI (`gpt-4o-mini-transcribe`, ≈ $0.003 за минуту). Вместо него можно поднять
[whisper.cpp](https://github.com/ggml-org/whisper.cpp): браузер сам переводит запись в WAV 16 кГц, ffmpeg не нужен. При
`TRANSCRIBE_PROVIDER=local` API идёт в `WHISPER_URL` (`POST /inference`), а если сервер не отвечает — в OpenAI
(выключается `TRANSCRIBE_FALLBACK=off`). Необязательно: `WHISPER_LANGUAGE` (по умолчанию `ru`), `WHISPER_PROMPT`
(подсказка со сленгом деска; пустая строка — без подсказки).

- **На ПК с NVIDIA (разработка).** В `%LOCALAPPDATA%\whisper`: `bin-cuda\` — распакованный
  `whisper-bin-win-cuda-11.8.0-x64.zip` из [релизов whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases)
  (без видеокарты — `whisper-bin-x64.zip` в `bin-cpu\`); рядом с `whisper-server.exe` положить `cublas64_11.dll` и
  `cublasLt64_11.dll` из [libcublas 11.11](https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/),
  иначе сервер молча работает на CPU; `models\ggml-large-v3-turbo-q5_0.bin` —
  [модель](https://huggingface.co/ggerganov/whisper.cpp/tree/main) (≈ 550 МБ). Запуск:
  `pnpm --filter @workspace/scripts run local-whisper` (порт 8178).
- **На сервере без видеокарты.** `whisper-server` под Linux и модель поменьше (`ggml-small.bin`, ≈ 470 МБ; turbo —
  если хватает ~2 ГБ RAM) отдельным systemd-сервисом:
  `whisper-server -m <модель> --host 127.0.0.1 --port 8178 -l ru -t <ядра>`, затем `TRANSCRIBE_PROVIDER=local` и
  `WHISPER_URL=http://127.0.0.1:8178` в `api.env`. На CPU минута речи — около минуты расшифровки.
