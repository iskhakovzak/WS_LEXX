"""
Binance Square → Telegram monitor
==================================
Polls the confirmed Binance News endpoint every second.
Sends only NEW posts to Telegram. Deduplicates across restarts via storage.json.

Run:
    python3 main.py

Env:
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — required (unless DRY_RUN=1)
    DRY_RUN=1            — print messages to the log instead of sending
    BINANCE_MONITOR_LOG  — also write logs to this file (rotated)
"""

import asyncio
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

import aiohttp

import binance_client as bc
import telegram_client as tc
from config import (
    LOG_FILE,
    LOG_MAX_BYTES,
    POLL_INTERVAL,
    RETRY_DELAY_BASE,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
)
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


async def fetch_with_backoff(session: aiohttp.ClientSession, errors: list[int]) -> list[dict] | None:
    """Fetch posts; on failure sleep with linear back-off (cap 60s) and return None."""
    try:
        posts = await bc.fetch_posts(session)
    except Exception as e:
        errors[0] += 1
        delay = min(RETRY_DELAY_BASE * errors[0], 60)
        logger.error(f"Binance API error #{errors[0]}: {e!r} — retrying in {delay}s")
        await asyncio.sleep(delay)
        return None
    if errors[0]:
        logger.info(f"Binance API recovered after {errors[0]} error(s)")
    errors[0] = 0
    return posts


async def bootstrap(session: aiohttp.ClientSession, errors: list[int]) -> State:
    """
    On first launch: mark every currently visible post as seen so we don't
    spam Telegram with historical content. Retries until the API answers —
    otherwise the first successful poll would forward the whole page.
    """
    while True:
        posts = await fetch_with_backoff(session, errors)
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


async def deliver(session: aiohttp.ClientSession, post: dict) -> None:
    text = tc.build_message(
        title    = bc.post_title(post),
        body     = bc.post_body(post),
        time_str = bc.post_time(post),
        link     = bc.post_link(post),
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

    errors = [0]
    connector = aiohttp.TCPConnector(limit=4)
    async with aiohttp.ClientSession(connector=connector) as session:

        # ── Load or set baseline ─────────────────────────────────────────────
        state = load_state()
        if state is None:
            logger.info("No usable storage.json — running bootstrap (skip history)")
            state = await bootstrap(session, errors)
        else:
            logger.info(f"Resuming — {len(state.seen)} known ids, last_time={state.last_time}")

        logger.info(f"✅ Polling every {POLL_INTERVAL}s  |  Ctrl+C to stop")

        # ── Main loop ────────────────────────────────────────────────────────
        while True:
            await asyncio.sleep(POLL_INTERVAL)

            posts = await fetch_with_backoff(session, errors)
            if not posts:
                continue

            # New = not seen before. Posts much older than the newest handled one
            # (e.g. old posts resurfacing after an edit/unpin) are marked silently.
            cutoff = state.last_time - 3600_000
            new_posts = [p for p in posts if not state.is_seen(bc.post_id(p))]
            if not new_posts:
                continue

            # Send oldest-first so Telegram thread reads chronologically
            for post in reversed(new_posts):
                pid = bc.post_id(post)
                ts  = bc.post_release_ms(post)

                if ts and ts < cutoff:
                    logger.info(f"Skipping old post id={pid} (released before last handled)")
                else:
                    logger.info(f"🆕 New post — id={pid} | {bc.post_title(post)[:60]!r}")
                    try:
                        await deliver(session, post)
                    except Exception as e:
                        logger.error(f"Telegram send failed for id={pid}: {e}")

                # Always advance — prevents infinite retry on Telegram errors
                state.mark(pid, ts)
                save_state(state)


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
