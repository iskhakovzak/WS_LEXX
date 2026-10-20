"""
Binance Square API client.

Confirmed endpoint (captured via DevTools):
  GET https://www.binanceuz.co/bapi/composite/v2/friendly/pgc/content/
      queryUserProfilePageContentsWithFilter
      ?targetSquareUid=RF5v7JH_6MiIJr-91F-aBA&timeOffset=-1&filterType=ALL

Response shape (relevant slice):
  {
    "code": "000000",
    "data": {
      "contents": [
        {
          "id": "...",
          "title": "...",
          "bodyTextOnly": "...",
          "firstReleaseTime": 1718500000000,   # ms timestamp
          "webLink": "https://..."
        },
        ...
      ]
    }
  }
"""

import logging
from datetime import datetime, timezone
from typing import Any

import aiohttp

from config import (
    BINANCE_API_URL,
    BINANCE_FILTER,
    BINANCE_HEADERS,
    BINANCE_UID,
    REQUEST_TIMEOUT,
)

logger = logging.getLogger(__name__)


# ── Fetch ──────────────────────────────────────────────────────────────────────

async def fetch_posts(session: aiohttp.ClientSession) -> list[dict[str, Any]]:
    """
    Fetch the latest posts for Binance News profile.
    Returns list of post dicts sorted newest-first.
    Raises on HTTP / API error (caller retries).
    """
    params = {
        "targetSquareUid": BINANCE_UID,
        "timeOffset": "-1",
        "filterType": BINANCE_FILTER,
    }

    async with session.get(
        BINANCE_API_URL,
        params=params,
        headers=BINANCE_HEADERS,
        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
    ) as resp:
        if resp.status != 200:
            text = await resp.text()
            logger.error(f"Binance API HTTP {resp.status}: {text[:200]}")
            resp.raise_for_status()

        data = await resp.json(content_type=None)

    code = data.get("code", "")
    if code != "000000":
        msg = data.get("message") or data.get("msg") or "unknown"
        logger.error(f"Binance API error code={code} message={msg}")
        raise RuntimeError(f"Binance API code={code}: {msg}")

    # The response wraps posts under data.contents (confirmed) or similar keys
    payload  = data.get("data") or {}
    posts = (
        payload.get("contents")
        or payload.get("list")
        or payload.get("feeds")
        or []
    )
    if not isinstance(posts, list):
        raise RuntimeError(f"Unexpected response shape: data keys={list(payload)[:10]}")
    posts = [p for p in posts if isinstance(p, dict) and post_id(p)]

    # Sort newest-first by firstReleaseTime (ms epoch); pinned posts don't come first
    posts.sort(key=post_release_ms, reverse=True)
    logger.debug(f"Fetched {len(posts)} posts")
    return posts


# ── Field accessors ────────────────────────────────────────────────────────────

def post_id(post: dict) -> str:
    return str(post.get("id") or "")


def post_title(post: dict) -> str:
    return (post.get("title") or "").strip()


def post_body(post: dict) -> str:
    # Length is trimmed in telegram_client.build_message
    return (post.get("bodyTextOnly") or post.get("content") or "").strip()


def post_release_ms(post: dict) -> int:
    try:
        return int(post.get("firstReleaseTime") or 0)
    except (TypeError, ValueError):
        return 0


def post_time(post: dict) -> str:
    ts = post.get("firstReleaseTime")
    if ts:
        try:
            dt = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc)
            return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception:
            return str(ts)
    return "—"


def post_link(post: dict) -> str:
    return (post.get("webLink") or "").strip()
