import os

# ─── Binance Square API ────────────────────────────────────────────────────────
# Confirmed endpoint (captured via DevTools on binanceuz.co)
# To replace if Binance changes it — update BINANCE_API_URL and BINANCE_UID
BINANCE_API_URL = (
    "https://www.binanceuz.co/bapi/composite/v2/friendly/pgc/content"
    "/queryUserProfilePageContentsWithFilter"
)
BINANCE_UID = "RF5v7JH_6MiIJr-91F-aBA"   # targetSquareUid for Binance News
BINANCE_FILTER = "ALL"                      # filterType param

# Polling interval (seconds)
POLL_INTERVAL = 1.0

# HTTP timeout (seconds)
REQUEST_TIMEOUT = 10

# Retry back-off on error (seconds, capped at 60)
RETRY_DELAY_BASE = 5

# ─── Request headers (mimic browser on binanceuz.co) ─────────────────────────
BINANCE_HEADERS = {
    "clienttype": "web",
    "lang": "en",
    "bnc-location": "UZ",
    "accept": "*/*",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "referer": "https://www.binanceuz.co/en/square/profile/binance_news",
    "origin": "https://www.binanceuz.co",
}

# ─── Telegram ─────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

# Retries for a single Telegram message (429 / network errors)
TELEGRAM_MAX_ATTEMPTS = 3

# ─── Storage ──────────────────────────────────────────────────────────────────
# Resolved next to this file, so it doesn't depend on the working directory
STORAGE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "storage.json")

# How many recent post IDs to remember for deduplication
SEEN_IDS_LIMIT = 500

# ─── Logging ──────────────────────────────────────────────────────────────────
# If set, logs also go to this file with rotation (read by /api/monitor-log)
LOG_FILE = os.environ.get("BINANCE_MONITOR_LOG", "")
LOG_MAX_BYTES = 2 * 1024 * 1024
