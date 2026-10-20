"""
Telegram message formatting (parse_mode=HTML).

    📈 <b>Apple Gets Loop Capital Downgrade on Slow iPhone Sales Fears</b>

    Loop Capital downgraded Apple to hold from buy, citing the risk that iPhone revenue
    will fall short of expectations.

    $AAPL
    🔗 Binance Square            ← link to the original post

Pure functions, no network — covered by tests/test_formatter.py.
"""

from __future__ import annotations

import html
import re

MAX_LEN = 4096          # Telegram hard limit for a text message
BODY_MAX = 400          # short body: first 1–2 sentences, at most this many chars
LINK_TEXT = "Binance Square"

# "According to Jin10, Apple says …" → "Apple says …"
_ATTRIBUTION = re.compile(r"^\s*According to [^,;:]{1,60},\s*", re.IGNORECASE)

# Tokens that end with a period but do not end a sentence
_ABBREV = {
    "u.s", "u.k", "u.n", "e.u", "inc", "corp", "co", "ltd", "plc", "jr", "sr", "dr", "mr", "mrs", "ms",
    "st", "no", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
    "sep", "sept", "oct", "nov", "dec", "approx", "est", "gov", "sen", "rep", "gen", "dept", "fig",
}
_SENT_END = re.compile(r"[.!?]+[\"'”’)]*\s+")


def escape(text: str) -> str:
    """Escape text for Telegram HTML (only &, <, > are special outside attributes)."""
    return html.escape(text or "", quote=False)


def split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text or "").strip()
    out, start = [], 0
    for m in _SENT_END.finditer(text):
        end = m.end()
        nxt = text[end:end + 1]
        if not nxt or not (nxt.isupper() or nxt.isdigit() or nxt in "\"'“‘($"):
            continue
        word = text[start:m.start() + 1].rsplit(" ", 1)[-1].rstrip(".!?").lower()
        if text[m.start()] == "." and (word in _ABBREV or (len(word) == 1 and word.isalpha())):
            continue  # "U.S. President", "Apple Inc. said", "John F. Kennedy"
        out.append(text[start:end].strip())
        start = end
    if start < len(text):
        out.append(text[start:].strip())
    return [s for s in out if s]


def _clean_sentence(s: str) -> str:
    s = _ATTRIBUTION.sub("", s, count=1)
    return s[:1].upper() + s[1:] if s else s


def _cut(text: str, limit: int) -> str:
    """Trim to `limit` chars at a word boundary, adding an ellipsis."""
    if len(text) <= limit:
        return text
    cut = text[: max(limit - 1, 0)]
    if " " in cut[limit // 2:]:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,;:-") + "…"


def short_body(body: str, title: str = "", limit: int = BODY_MAX) -> str:
    """First sentence (plus the second if both are short), ≤ limit chars."""
    sentences = [_clean_sentence(s) for s in split_sentences(body)]
    sentences = [s for s in sentences if s]
    if not sentences:
        return ""
    text = sentences[0]
    if len(sentences) > 1 and len(text) < 200 and len(text) + 1 + len(sentences[1]) <= limit:
        text += " " + sentences[1]
    text = _cut(text, limit)
    # Nothing new beyond the headline → skip the body
    norm = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    if title and norm(text) == norm(title):
        return ""
    return text


def cashtags(tickers) -> str:
    tags = []
    for t in tickers or []:
        t = re.sub(r"[^A-Z0-9.]", "", str(t).upper())
        if t and not t[0].isdigit() and f"${t}" not in tags:
            tags.append(f"${t}")
    return " ".join(tags)


def _link_html(link: str) -> str:
    link = (link or "").strip()
    if not link:
        return ""
    if re.match(r"^https?://", link, re.IGNORECASE):
        return f'🔗 <a href="{html.escape(link, quote=True)}">{LINK_TEXT}</a>'
    return f"🔗 {escape(link)}"


def build_message(title: str, body: str, link: str, emoji: str = "📰",
                  tickers=(), body_limit: int = BODY_MAX) -> str:
    """HTML message: emoji + bold title, short body, cashtags, source link. ≤ 4096 chars."""
    title = re.sub(r"\s+", " ", title or "").strip()
    summary = short_body(body, title, body_limit)
    tail = [x for x in (cashtags(tickers), _link_html(link)) if x]

    def assemble(t: str, b: str) -> str:
        head = f"{emoji} <b>{escape(t)}</b>" if t else emoji
        parts = [head]
        if b:
            parts.append(escape(b))
        if tail:
            parts.append("\n".join(tail))
        return "\n\n".join(parts)

    text = assemble(title, summary)
    if len(text) > MAX_LEN:
        summary = ""
        text = assemble(title, summary)
    if len(text) > MAX_LEN:
        # Shrink the raw title until the escaped message fits (never cuts inside an entity/tag)
        over = len(text) - MAX_LEN
        t = title
        while len(text) > MAX_LEN and t:
            t = _cut(t, max(len(t) - over - 1, 1))
            text = assemble(t, summary)
            over = max(len(text) - MAX_LEN, 1)
    return text


def html_to_plain(text: str) -> str:
    """Fallback if Telegram rejects the HTML: drop tags, unescape entities."""
    text = re.sub(r'<a href="([^"]*)">[^<]*</a>', lambda m: html.unescape(m.group(1)), text)
    text = re.sub(r"</?[a-zA-Z][^>]*>", "", text)
    return html.unescape(text)
