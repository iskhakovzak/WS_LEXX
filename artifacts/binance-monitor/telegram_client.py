import asyncio
import logging

import aiohttp

from config import (
    REQUEST_TIMEOUT,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    TELEGRAM_MAX_ATTEMPTS,
)
from formatter import MAX_LEN, build_message, html_to_plain  # noqa: F401  (build_message re-exported)

logger = logging.getLogger(__name__)

_SEND_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"


async def send_message(session: aiohttp.ClientSession, text: str, parse_mode: str | None = "HTML") -> None:
    """
    Send a message (HTML by default, see formatter.build_message).
    Retries on 429 and network/5xx errors. If Telegram rejects the markup
    ("can't parse entities"), resends once as plain text.
    """
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text[:MAX_LEN],
        "disable_web_page_preview": True,   # compact: no Binance card under every post
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode

    last_err = "unknown"
    for attempt in range(1, TELEGRAM_MAX_ATTEMPTS + 1):
        delay = 2 * attempt
        try:
            async with session.post(
                _SEND_URL,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
            ) as resp:
                try:
                    body = await resp.json(content_type=None)
                except Exception:
                    body = {"description": (await resp.text())[:200]}

            if body.get("ok"):
                logger.info("✅ Telegram message sent")
                return

            last_err = f"{resp.status}: {body.get('description', 'unknown')}"
            retry_after = (body.get("parameters") or {}).get("retry_after")
            if resp.status == 429 and retry_after:
                delay = int(retry_after) + 1
            elif resp.status == 400 and "parse_mode" in payload and "parse" in str(body.get("description", "")).lower():
                logger.warning(f"Telegram rejected HTML ({last_err}) — resending as plain text")
                payload.pop("parse_mode")
                payload["text"] = html_to_plain(payload["text"])[:MAX_LEN]
                continue
            elif resp.status < 500 and resp.status != 429:
                break  # bad request / bad token — retrying won't help
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            last_err = f"network: {e!r}"

        if attempt < TELEGRAM_MAX_ATTEMPTS:
            logger.warning(f"Telegram attempt {attempt} failed ({last_err}) — retry in {delay}s")
            await asyncio.sleep(delay)

    logger.error(f"Telegram error {last_err}")
    raise RuntimeError(f"Telegram send failed: {last_err}")
