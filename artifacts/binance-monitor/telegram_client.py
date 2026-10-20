import asyncio
import logging

import aiohttp

from config import (
    REQUEST_TIMEOUT,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    TELEGRAM_MAX_ATTEMPTS,
)

logger = logging.getLogger(__name__)

_SEND_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
_MAX_LEN = 4096


def build_message(title: str, body: str, time_str: str, link: str) -> str:
    """
    Format:

    🚨 Binance News

    {title}

    {bodyTextOnly}

    🕒 {firstReleaseTime}

    🔗 {webLink}
    """
    head = ["🚨 Binance News", ""]
    if title:
        head += [title, ""]
    tail = [f"🕒 {time_str}"]
    if link:
        tail += ["", f"🔗 {link}"]

    # Trim the body so the whole message fits Telegram's 4096-char limit
    if body:
        budget = _MAX_LEN - len("\n".join(head + tail)) - 2
        if len(body) > budget:
            body = body[: max(budget - 1, 0)] + "…"
        head += [body, ""]
    return "\n".join(head + tail)[:_MAX_LEN]


async def send_message(session: aiohttp.ClientSession, text: str) -> None:
    """Send plain-text message; retries on 429 and network errors."""
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "disable_web_page_preview": False,
    }

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
            elif resp.status < 500 and resp.status != 429:
                break  # bad request / bad token — retrying won't help
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            last_err = f"network: {e!r}"

        if attempt < TELEGRAM_MAX_ATTEMPTS:
            logger.warning(f"Telegram attempt {attempt} failed ({last_err}) — retry in {delay}s")
            await asyncio.sleep(delay)

    logger.error(f"Telegram error {last_err}")
    raise RuntimeError(f"Telegram send failed: {last_err}")
