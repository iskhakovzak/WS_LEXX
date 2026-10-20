"""
Binance Square → Telegram monitor
==================================
Polls the confirmed Binance News endpoint every second.
Sends only NEW posts to Telegram. Deduplicates across restarts via storage.json.
Per-poll logic (filter reload, age cutoff, per-post error isolation, polling alert) lives in processing.py.

Run:
    python3 main.py

Env:
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — required (unless DRY_RUN=1)
    DRY_RUN=1            — print messages to the log instead of sending
    FILTER_OFF=1         — forward every post (disable the news filter, see filters.json)
    MAX_POST_AGE_MINUTES — older posts are marked seen, not sent (default 15, see config.py)
    POLL_ALERT_MINUTES   — alert after this many minutes of failed polling (default 10)
    BINANCE_MONITOR_LOG  — also write logs to this file (rotated)
"""

import asyncio
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

import aiohttp

import binance_client as bc
import filter as news_filter
import telegram_client as tc
from config import (
    FILTER_OFF,
    LOG_FILE,
    LOG_MAX_BYTES,
    MAX_POST_AGE_MINUTES,
    POLL_ALERT_MINUTES,
    POLL_ALERT_TEXT,
    POLL_INTERVAL,
    RETRY_DELAY_BASE,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
)
from processing import FilterRules, PollHealth, handle_new_posts
from storage import State, load_state, save_state

DRY_RUN = os.environ.get("DRY_RUN") == "1"

# Emoji in logs must not crash on consoles with a non-UTF-8 encoding (e.g. Windows)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
if LOG_FILE:
    _handlers.append(RotatingFileHandler(LOG_FILE, maxBytes=LOG_MAX_BYTES, backupCount=1, encoding="utf-8"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=_handlers,
    force=True,
)
logger = logging.getLogger("monitor")


async def poll_alert(session: aiohttp.ClientSession, health: PollHealth) -> None:
    minutes = health.down_minutes()
    logger.error(f"🚨 ALERT: Binance polling has failed for {minutes:.0f} min ({health.errors} errors in a row)")
    if DRY_RUN or not (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID):
        return
    try:
        await tc.send_message(session, POLL_ALERT_TEXT.format(minutes=minutes), parse_mode=None)
    except Exception as e:
        logger.error(f"Could not send the polling alert to Telegram: {e}")


async def fetch_with_backoff(session: aiohttp.ClientSession, health: PollHealth) -> list[dict] | None:
    """Fetch posts; on failure sleep with linear back-off (cap 60s) and return None."""
    try:
        posts = await bc.fetch_posts(session)
    except Exception as e:
        alert = health.failed()
        delay = min(RETRY_DELAY_BASE * health.errors, 60)
        logger.error(f"Binance API error #{health.errors}: {e!r} — retrying in {delay}s")
        if alert:
            await poll_alert(session, health)
        await asyncio.sleep(delay)
        return None
    recovered = health.ok()
    if recovered:
        logger.info(f"Binance API recovered after {recovered} error(s)")
    return posts


async def bootstrap(session: aiohttp.ClientSession, health: PollHealth) -> State:
    """
    On first launch: mark every currently visible post as seen so we don't
    spam Telegram with historical content. Retries until the API answers —
    otherwise the first successful poll would forward the whole page.
    """
    while True:
        posts = await fetch_with_backoff(session, health)
        if posts is not None:
            break

    state = State()
    for post in reversed(posts):
        state.mark(bc.post_id(post), bc.post_release_ms(post))
    save_state(state)
    if posts:
        logger.info(f"Bootstrap: {len(posts)} existing posts marked seen | newest={bc.post_title(posts[0])!r}")
    else:
        logger.info("Bootstrap: no posts found, will watch from scratch")
    return state


async def deliver(session: aiohttp.ClientSession, post: dict, verdict: dict) -> None:
    text = tc.build_message(
        title   = bc.post_title(post),
        body    = bc.post_body(post),
        link    = bc.post_link(post),
        emoji   = verdict.get("emoji") or news_filter.DEFAULT_EMOJI,
        tickers = verdict.get("tickers") or (),
        keywords = verdict.get("keywords") or (),
        category = verdict.get("category"),
    )
    if DRY_RUN:
        logger.info("DRY_RUN — message not sent:\n" + text)
        return
    await tc.send_message(session, text)


async def run() -> None:
    logger.info("═══════════════════════════════════════")
    logger.info("  Binance Square Monitor — starting" + ("  [DRY_RUN]" if DRY_RUN else ""))
    logger.info("═══════════════════════════════════════")

    if not DRY_RUN and not (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID):
        logger.critical("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or use DRY_RUN=1)")
        sys.exit(1)

    filters = FilterRules()
    if FILTER_OFF:
        logger.info("FILTER_OFF=1 — news filter disabled, forwarding every post")
    logger.info(f"Age cutoff: posts older than {MAX_POST_AGE_MINUTES:g} min when first seen are not sent; "
                f"polling alert after {POLL_ALERT_MINUTES:g} min of errors")

    health = PollHealth()
    connector = aiohttp.TCPConnector(limit=4)
    async with aiohttp.ClientSession(connector=connector) as session:

        # ── Load or set baseline ─────────────────────────────────────────────
        state = load_state()
        if state is None:
            logger.info("No usable storage.json — running bootstrap (skip history)")
            state = await bootstrap(session, health)
        else:
            logger.info(f"Resuming — {len(state.seen)} known ids, last_time={state.last_time}")

        logger.info(f"✅ Polling every {POLL_INTERVAL}s  |  Ctrl+C to stop")

        # ── Main loop ────────────────────────────────────────────────────────
        while True:
            await asyncio.sleep(POLL_INTERVAL)

            posts = await fetch_with_backoff(session, health)
            if not posts:
                continue

            # New = not seen before; each post is isolated (a malformed one is logged and
            # marked seen), too-old ones are marked silently — see processing.handle_new_posts
            await handle_new_posts(posts, state, filters, lambda post, verdict: deliver(session, post, verdict))


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Stopped (Ctrl+C)")
    except Exception as e:
        logger.critical(f"Fatal: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
