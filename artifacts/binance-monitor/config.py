import json
import logging
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


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


# Posts older than this (minutes) when first seen are marked seen but NOT forwarded — after a
# downtime the channel is not flooded with stale news. 0 = no age limit. Env: MAX_POST_AGE_MINUTES.
MAX_POST_AGE_MINUTES = _env_float("MAX_POST_AGE_MINUTES", 15)

# Polling has failed for this many minutes in a row → an ALERT line in the log and (with
# TELEGRAM_CHAT_ID set, not DRY_RUN) one message to the channel, at most once per POLL_ALERT_REPEAT_S.
# Env: POLL_ALERT_MINUTES.
POLL_ALERT_MINUTES = _env_float("POLL_ALERT_MINUTES", 10)
POLL_ALERT_REPEAT_S = 3600
POLL_ALERT_TEXT = "⚠️ Новости Binance: опрос не работает уже {minutes:.0f} мин — бот пытается переподключиться."

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

# ─── News filter ──────────────────────────────────────────────────────────────
# Keywords / weights / thresholds live in filters.json (see README «Фильтр»).
# FILTER_OFF=1 — forward every post, as before the filter existed.
FILTERS_FILE = os.environ.get("FILTERS_FILE") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "filters.json"
)
FILTER_OFF = os.environ.get("FILTER_OFF") == "1"
# A copy of the last filters.json that loaded fine: used when filters.json is broken at start-up.
FILTERS_LAST_GOOD_FILE = os.environ.get("FILTERS_LAST_GOOD_FILE") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "filters.last-good.json"
)

# Used for keys missing from filters.json. Without any keyword lists nothing would
# match: load_filters (review_filter.py, tests) turns a missing/broken file into
# "filter disabled"; the running monitor uses read_filters and keeps its last working
# rules instead (processing.FilterRules).
FILTER_DEFAULTS = {
    "enabled": True,
    "crypto_major": True,
    "min_score": 4,
    "title_weight": 2,
    "body_weight": 1,
    "body_chars": 400,
    "ticker_bonus": 1,
    "ticker_bonus_cap": 2,
    "minor_crypto_penalty": 3,
    "hard_penalty": 100,
    "max_cashtags": 6,
    "default_emoji": "📰",
    "allow": [],
    "categories": {},
    "deny": {},
    "pairs": {},
}


def read_filters(path: str = FILTERS_FILE) -> dict:
    """Strict read: filters.json merged over FILTER_DEFAULTS; raises on a missing / unreadable file,
    a non-object top level, or no categories while enabled (that would drop or pass everything)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("top level must be a JSON object")
    cfg = {**FILTER_DEFAULTS, **data}
    if cfg.get("enabled", True) and not cfg.get("categories"):
        raise ValueError("no categories")
    return cfg


def load_filters(path: str = FILTERS_FILE) -> dict:
    """Read filters.json merged over FILTER_DEFAULTS; on any problem → filter disabled."""
    log = logging.getLogger("config")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("top level must be a JSON object")
    except FileNotFoundError:
        log.warning(f"{path} not found — news filter disabled, forwarding everything")
        return {**FILTER_DEFAULTS, "enabled": False}
    except Exception as e:
        log.error(f"Cannot read {path}: {e} — news filter disabled, forwarding everything")
        return {**FILTER_DEFAULTS, "enabled": False}
    cfg = {**FILTER_DEFAULTS, **data}
    if not cfg.get("categories"):
        log.warning(f"{path} has no categories — news filter disabled, forwarding everything")
        cfg["enabled"] = False
    return cfg


# ─── Logging ──────────────────────────────────────────────────────────────────
# If set, logs also go to this file with rotation (read by /api/monitor-log)
LOG_FILE = os.environ.get("BINANCE_MONITOR_LOG", "")
LOG_MAX_BYTES = 2 * 1024 * 1024
