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
    FILTER_OFF=1         — forward every post (disable the news filter, see filters.json)
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
    FILTERS_FILE,
    LOG_FILE,
    LOG_MAX_BYTES,
    POLL_INTERVAL,
    RETRY_DELAY_BASE,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    load_filters,
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


class FilterRules:
    """filters.json, re-read automatically when the file changes (no restart needed)."""

    def __init__(self, path: str = FILTERS_FILE):
        self.path = path
        self.mtime: float | None = None
        self.rules = news_filter.Rules({"enabled": False})
        self.refresh()

    def refresh(self) -> None:
        try:
            mtime = os.path.getmtime(self.path)
        except OSError:
            mtime = -1.0
        if mtime == self.mtime:
            return
        first = self.mtime is None
        self.mtime = mtime
        self.rules = news_filter.Rules(load_filters(self.path))
        if self.rules.enabled:
            logger.info(
                f"{'Loaded' if first else 'Reloaded'} {os.path.basename(self.path)}: "
                f"min_score={self.rules.min_score:g}, crypto_major={self.rules.crypto_major}, "
                f"categories={', '.join(self.rules.categories)}"
            )

    @property
    def active(self) -> bool:
        return self.rules.enabled and not FILTER_OFF


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

            filters.refresh()

            # Send oldest-first so Telegram thread reads chronologically
            for post in reversed(new_posts):
                pid = bc.post_id(post)
                ts  = bc.post_release_ms(post)

                if ts and ts < cutoff:
                    logger.info(f"Skipping old post id={pid} (released before last handled)")
                else:
                    verdict = news_filter.classify(post, filters.rules)
                    title = bc.post_title(post)[:90]
                    if filters.active and not verdict["keep"]:
                        logger.info(f"⛔ DROP id={pid} score={verdict['score']:g} | {verdict['reason']} | {title!r}")
                    else:
                        why = verdict["reason"] if filters.active else "filter off"
                        logger.info(f"🆕 SEND id={pid} {verdict['emoji']} {verdict['category'] or '-'} "
                                    f"score={verdict['score']:g} | {why} | {title!r}")
                        try:
                            await deliver(session, post, verdict)
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
