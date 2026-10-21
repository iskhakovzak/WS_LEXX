"""
The monitor's per-poll logic, kept apart from main.py so it is testable without the network:

  FilterRules       filters.json, re-read when it changes. A broken file (bad JSON, a bad value such as
                    "weight": null, no categories, deleted) keeps the LAST WORKING rules and logs an error —
                    it never switches the filter off. The last working file is also saved next to it
                    (FILTERS_LAST_GOOD_FILE), so a restart with a broken filters.json still filters.
  handle_new_posts  one batch of new posts, oldest first: every post is wrapped in try/except (a malformed
                    post is logged and marked seen, never an endless crash loop); posts older than
                    MAX_POST_AGE_MINUTES when first seen are marked seen but not forwarded (no flood after
                    downtime); every handled post is marked seen.
  PollHealth        consecutive polling failures: back-off counter, and an alert once polling has failed for
                    POLL_ALERT_MINUTES in a row (log line always; Telegram at most once per POLL_ALERT_REPEAT_S).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import time
from typing import Awaitable, Callable

import binance_client as bc
import filter as news_filter
from config import (
    FILTER_OFF,
    FILTERS_FILE,
    FILTERS_LAST_GOOD_FILE,
    MAX_POST_AGE_MINUTES,
    POLL_ALERT_MINUTES,
    POLL_ALERT_REPEAT_S,
    read_filters,
)
from storage import State, save_state

logger = logging.getLogger("monitor")


class FilterRules:
    """filters.json, re-read automatically when the file changes (no restart needed)."""

    def __init__(self, path: str = FILTERS_FILE, last_good_path: str | None = FILTERS_LAST_GOOD_FILE):
        self.path = path
        self.last_good_path = last_good_path
        self.stamp: tuple[int, int] | None = None   # (mtime_ns, size): two writes within one mtime tick still differ
        self.rules = news_filter.Rules({"enabled": False})
        self.loaded = False   # True once any working rules were loaded
        self.refresh()
        if not self.loaded:
            self._load_last_good()

    def _build(self, path: str) -> news_filter.Rules:
        """Strict: raises on anything that would not filter (bad JSON / values, no categories)."""
        return news_filter.Rules(read_filters(path))

    def refresh(self) -> None:
        try:
            st = os.stat(self.path)
            stamp = (st.st_mtime_ns, st.st_size)
        except OSError:
            stamp = (-1, -1)
        if stamp == self.stamp:
            return
        first = self.stamp is None
        self.stamp = stamp
        name = os.path.basename(self.path)
        try:
            rules = self._build(self.path)
        except Exception as e:
            if self.loaded:
                logger.error(f"{name} is broken ({e!r}) — keeping the last working rules")
            else:
                logger.error(f"{name} is broken ({e!r}) — no working rules loaded yet")
            return
        self.rules = rules
        self.loaded = True
        self._save_last_good()
        logger.info(
            f"{'Loaded' if first else 'Reloaded'} {name}: enabled={rules.enabled}, "
            f"min_score={rules.min_score:g}, crypto_major={rules.crypto_major}, "
            f"categories={', '.join(rules.categories)}"
        )

    def _save_last_good(self) -> None:
        if not self.last_good_path:
            return
        try:
            tmp = self.last_good_path + ".tmp"
            shutil.copyfile(self.path, tmp)
            os.replace(tmp, self.last_good_path)
        except Exception as e:
            logger.warning(f"Cannot save {self.last_good_path}: {e!r}")

    def _load_last_good(self) -> None:
        if not self.last_good_path or not os.path.exists(self.last_good_path):
            logger.error("No working filters.json and no saved copy — the news filter is OFF, forwarding everything")
            return
        try:
            self.rules = self._build(self.last_good_path)
            self.loaded = True
            logger.error(f"Using the last working rules from {os.path.basename(self.last_good_path)} until filters.json is fixed")
        except Exception as e:
            logger.error(f"Saved copy {self.last_good_path} is broken too ({e!r}) — the news filter is OFF, forwarding everything")

    @property
    def active(self) -> bool:
        return self.rules.enabled and not FILTER_OFF


def now_ms() -> int:
    return int(time.time() * 1000)


Deliver = Callable[[dict, dict], Awaitable[None]]


async def handle_new_posts(
    posts: list[dict],
    state: State,
    filters: FilterRules,
    deliver: Deliver,
    now: int | None = None,
    max_age_minutes: float = MAX_POST_AGE_MINUTES,
    persist: Callable[[State], None] = save_state,
) -> dict[str, int]:
    """Handle the not-yet-seen posts of one poll, oldest first. Returns counters (sent/dropped/old/errors)."""
    now = now_ms() if now is None else now
    max_age_ms = max_age_minutes * 60_000
    counts = {"sent": 0, "dropped": 0, "old": 0, "errors": 0}
    new_posts = [p for p in posts if not state.is_seen(bc.post_id(p))]
    if not new_posts:
        return counts
    filters.refresh()

    # Oldest first so the Telegram thread reads chronologically
    for post in reversed(new_posts):
        pid = bc.post_id(post)
        ts = bc.post_release_ms(post)
        try:
            if ts and max_age_ms > 0 and now - ts > max_age_ms:
                counts["old"] += 1
                logger.info(f"⏳ OLD id={pid} released {(now - ts) / 60_000:.0f} min ago (> {max_age_minutes:g}) — marked seen, not sent")
            else:
                verdict = news_filter.classify(post, filters.rules)
                title = bc.post_title(post)[:90]
                if filters.active and not verdict["keep"]:
                    counts["dropped"] += 1
                    logger.info(f"⛔ DROP id={pid} score={verdict['score']:g} | {verdict['reason']} | {title!r}")
                else:
                    why = verdict["reason"] if filters.active else "filter off"
                    logger.info(f"🆕 SEND id={pid} {verdict['emoji']} {verdict['category'] or '-'} "
                                f"score={verdict['score']:g} | {why} | {title!r}")
                    try:
                        await deliver(post, verdict)
                        counts["sent"] += 1
                    except Exception as e:
                        counts["errors"] += 1
                        logger.error(f"Telegram send failed for id={pid}: {e}")
        except Exception as e:
            counts["errors"] += 1
            logger.error(f"Malformed post id={pid} skipped: {e!r} | {json.dumps(post, ensure_ascii=False, default=str)[:300]}")

        # Always advance — a bad post or a Telegram error never loops
        state.mark(pid, ts)
        persist(state)
    return counts


class PollHealth:
    """Consecutive polling failures → back-off counter and the «polling is down» alert."""

    def __init__(self, alert_minutes: float = POLL_ALERT_MINUTES, repeat_s: float = POLL_ALERT_REPEAT_S):
        self.errors = 0
        self.failing_since: float | None = None
        self.last_alert: float | None = None
        self.alert_s = alert_minutes * 60
        self.repeat_s = repeat_s

    def failed(self, now: float | None = None) -> bool:
        """Record one failure; True when an alert is due now (N minutes down, ≤ 1 alert per repeat_s)."""
        now = time.time() if now is None else now
        self.errors += 1
        if self.failing_since is None:
            self.failing_since = now
        if now - self.failing_since < self.alert_s:
            return False
        if self.last_alert is not None and now - self.last_alert < self.repeat_s:
            return False
        self.last_alert = now
        return True

    def down_minutes(self, now: float | None = None) -> float:
        now = time.time() if now is None else now
        return 0.0 if self.failing_since is None else (now - self.failing_since) / 60

    def ok(self) -> int:
        """Record a success; returns how many failures it ended."""
        n = self.errors
        self.errors = 0
        self.failing_since = None
        return n
