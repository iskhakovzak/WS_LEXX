"""
Rule-based relevance filter for Binance News posts.

    classify(post) -> {"keep", "keywords", "category", "emoji", "score", "reason", "reasons", "tickers", "scores"}

Everything tunable (keywords, weights, penalties, thresholds) lives in filters.json.
The scoring is deliberately simple so every decision can be explained in one log line:

  1. Each category (macro, policy, stocks, commodities, ai, crypto) has keywords with
     weights. A keyword found in the title scores weight × title_weight, found only in
     the body (first body_chars chars + hashtags) scores weight × body_weight.
     Each keyword counts once. With require_title_hit a category scores only if at
     least one of its keywords is in the title (body-only mentions are incidental).
  2. Trading pairs attached to the post add a small bonus: US stock tickers → stocks,
     commodity futures (CL, XAU, …) → commodities, BTC/ETH → crypto.
  3. Deny groups subtract a penalty when one of their keywords matches
     (penalty 100 = hard drop). Posts tagged only with non-major crypto tokens get
     minor_crypto_penalty.
  4. score = best category score − penalties; keep if score ≥ min_score.
     An "allow" keyword in the title keeps the post regardless of the score,
     unless a hard deny (penalty ≥ hard_penalty, default 100) matched.

Keyword syntax (filters.json):
  "oil"        — whole word, any case
  "tariff*"    — prefix: tariff, tariffs, tariffed…
  "^stocks |"  — only at the very start of the title
  "SEC", "US"  — a keyword with capital letters is case-sensitive (so "us" ≠ "US")
"""

from __future__ import annotations

import re
from typing import Any, Iterable

DEFAULT_EMOJI = "📰"

_PUNCT = str.maketrans({
    "’": "'", "‘": "'", "“": '"', "”": '"',
    " ": " ", "–": "-", "—": "-",
})

# Ticker patterns in the text: "Apple (AAPL.O)", "CRWV.O", "(NASDAQ: NVDA)"
_TICKER_PAREN = re.compile(r"\(\s*([A-Z]{1,5})\.(?:O|N|OQ|A|K|US)\s*\)")
_TICKER_BARE = re.compile(r"(?<![A-Za-z0-9.$])([A-Z]{2,5})\.(?:O|N|OQ)(?![A-Za-z0-9])")
_TICKER_EXCH = re.compile(
    r"\(\s*(?:NASDAQ|Nasdaq|NasdaqGS|NasdaqGM|NYSE|NYSE American|NYSE Arca|AMEX)\s*:\s*([A-Z]{1,5})\s*\)"
)


def _norm(text: Any) -> str:
    return str(text or "").translate(_PUNCT)


def compile_phrase(phrase: str) -> tuple[re.Pattern, bool]:
    """Return (regex, anchored) for a keyword written in filters.json syntax."""
    anchored = phrase.startswith("^")
    p = phrase[1:] if anchored else phrase
    wildcard = p.endswith("*")
    if wildcard:
        p = p[:-1]
    p = _norm(p)
    case_sensitive = any(c.isupper() for c in p)
    pat = re.escape(p)
    if p[:1].isalnum() and not anchored:
        pat = r"(?<![A-Za-z0-9])" + pat
    if wildcard:
        pat += r"[A-Za-z0-9'-]*"
    elif p[-1:].isalnum():
        pat += r"(?![A-Za-z0-9])"
    if anchored:
        pat = r"^\s*" + pat
    return re.compile(pat, 0 if case_sensitive else re.IGNORECASE), anchored


def _compile_list(items: Iterable[str]) -> list[tuple[str, re.Pattern, bool]]:
    out = []
    for phrase in items or []:
        if isinstance(phrase, str) and phrase.strip("^* "):
            rx, anchored = compile_phrase(phrase)
            out.append((phrase, rx, anchored))
    return out


class Rules:
    """Compiled filters.json."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.enabled = bool(cfg.get("enabled", True))
        self.crypto_major = bool(cfg.get("crypto_major", True))
        self.min_score = float(cfg.get("min_score", 4))
        self.title_weight = float(cfg.get("title_weight", 2))
        self.body_weight = float(cfg.get("body_weight", 1))
        self.body_chars = int(cfg.get("body_chars", 400))
        self.ticker_bonus = float(cfg.get("ticker_bonus", 1))
        self.ticker_bonus_cap = float(cfg.get("ticker_bonus_cap", 2))
        self.minor_crypto_penalty = float(cfg.get("minor_crypto_penalty", 3))
        self.hard_penalty = float(cfg.get("hard_penalty", 100))   # ≥ this: even "allow" can't save it
        self.require_title_hit = bool(cfg.get("require_title_hit", True))
        self.max_cashtags = int(cfg.get("max_cashtags", 6))
        self.default_emoji = cfg.get("default_emoji", DEFAULT_EMOJI)

        pairs = cfg.get("pairs") or {}
        self.crypto_major_codes = {c.upper() for c in pairs.get("crypto_major_codes", ["BTC", "ETH"])}
        self.commodity_codes = {c.upper() for c in pairs.get("commodity_codes", [])}
        self.not_stock_codes = {c.upper() for c in pairs.get("not_stock_codes", ["BNB"])}

        self.categories: dict[str, dict] = {}
        for name, c in (cfg.get("categories") or {}).items():
            if not isinstance(c, dict):
                continue
            kws = []
            for phrase, weight in (c.get("keywords") or {}).items():
                if phrase.strip("^* "):
                    rx, anchored = compile_phrase(phrase)
                    kws.append((phrase, float(weight), rx, anchored))
            self.categories[name] = {
                "emoji": c.get("emoji", self.default_emoji),
                "label": c.get("label", name),
                "requires": _compile_list(c.get("requires_any")),
                "keywords": kws,
            }

        self.deny = []
        for name, g in (cfg.get("deny") or {}).items():
            if not isinstance(g, dict):
                continue
            self.deny.append({
                "name": name,
                "penalty": float(g.get("penalty", 100)),
                "where": g.get("where", "title"),
                "matchers": _compile_list(g.get("keywords")),
            })
        self.allow = _compile_list(cfg.get("allow"))
        # company name → ticker, used for cashtags ("Apple" → $AAPL)
        self.company_tickers = []
        for name, tk in (cfg.get("company_tickers") or {}).items():
            if isinstance(tk, str) and tk.strip() and name.strip("^* "):
                self.company_tickers.append((compile_phrase(name)[0], tk.strip().upper()))

    def emoji(self, category: str | None) -> str:
        if category and category in self.categories:
            return self.categories[category]["emoji"]
        return self.default_emoji


# ── Post normalisation (raw API objects and slimmed samples) ──────────────────

def post_text(post: dict) -> tuple[str, str]:
    """(title, body) — body is bodyTextOnly, or a plain-text 'body' (slim samples)."""
    title = _norm(post.get("title")).strip()
    body = post.get("bodyTextOnly")
    if body is None:
        b = post.get("body") or post.get("content") or ""
        body = b if isinstance(b, str) and not b.lstrip().startswith("{") else ""
    return title, _norm(body).strip()


def _hashtags(post: dict) -> list[str]:
    out = []
    for key in ("hashtags", "hashtagIdentifyList", "hashtagList"):
        for h in post.get(key) or []:
            name = h if isinstance(h, str) else (h or {}).get("name") or (h or {}).get("hashtag") or ""
            name = str(name).lstrip("#").strip()
            if name and name not in out:
                out.append(name)
    return out


def _pairs(post: dict) -> list[dict | str]:
    seen, out = set(), []
    for key in ("tradingPairsV2", "tradingPairs"):
        for p in post.get(key) or []:
            code = p if isinstance(p, str) else (p or {}).get("code")
            if code and code not in seen:
                seen.add(code)
                out.append(p)
    return out


def classify_pairs(post: dict, rules: Rules) -> dict[str, list[str]]:
    """Split attached trading pairs into stocks / commodities / crypto_major / crypto_other."""
    res: dict[str, list[str]] = {"stocks": [], "commodities": [], "crypto_major": [], "crypto_other": []}

    def add(kind: str, code: str) -> None:
        if code and code not in res[kind]:
            res[kind].append(code)

    for p in _pairs(post):
        if isinstance(p, str):
            code, market, fut, spot, sym = p.upper(), "", "", "", ""
        else:
            code = str(p.get("code") or "").upper()
            market = str(p.get("marketV2") or "")
            fut = str(p.get("futuresSymbol") or "").upper()
            spot = str(p.get("spotSymbol") or "").upper()
            sym = str(p.get("symbol") or "").upper()

        if market in ("STOCK_US", "ETF_US") or code.endswith((".US", ".ETF")):
            add("stocks", sym if sym and "." not in sym and not sym.endswith("USDT") else code.split(".")[0])
        elif code in rules.commodity_codes:
            add("commodities", code)
        elif code in rules.crypto_major_codes:
            add("crypto_major", code)
        elif isinstance(p, dict) and code.endswith("B") and fut == code[:-1] + "USDT":
            add("stocks", code[:-1])          # tokenised stock spot, e.g. AAPLB ↔ AAPLUSDT
        elif isinstance(p, dict) and spot and spot == code + "BUSDT":
            add("stocks", code)               # stock perp, e.g. AAPL ↔ AAPLBUSDT
        elif isinstance(p, str) and len(code) >= 3 and code.endswith("B") and code not in rules.not_stock_codes:
            add("stocks", code[:-1])          # slim samples carry only the code
        else:
            add("crypto_other", code)
    return res


def _ordered_unique(found: list[tuple[int, str]]) -> list[str]:
    out: list[str] = []
    for _, t in sorted(found):
        if t not in out:
            out.append(t)
    return out


def text_tickers(text: str) -> list[str]:
    """US tickers written in the text: 'Apple (AAPL.O)', 'CRWV.O', '(NASDAQ: NVDA)'."""
    found: list[tuple[int, str]] = []
    for rx in (_TICKER_PAREN, _TICKER_BARE, _TICKER_EXCH):
        found += [(m.start(), m.group(1)) for m in rx.finditer(text)]
    return _ordered_unique(found)


def find_tickers(title: str, body: str, pair_stocks: list[str], rules: Rules) -> list[str]:
    """
    Tickers for cashtags, in order of appearance (title first):
      • explicit tickers in the text ("AAPL.O", "(NASDAQ: NVDA)");
      • known company names from company_tickers ("Apple" → AAPL);
      • stock pairs Binance attached to the post — only when the text confirms them
        (the ticker or its company is mentioned), because Binance's auto-tagging is noisy.
    """
    found: list[tuple[int, str]] = []
    for offset, text in ((0, title), (100_000, body)):
        for rx in (_TICKER_PAREN, _TICKER_BARE, _TICKER_EXCH):
            found += [(offset + m.start(), m.group(1)) for m in rx.finditer(text)]
        for rx, tk in rules.company_tickers:
            m = rx.search(text)
            if m:
                found.append((offset + m.start(), tk))
        for tk in pair_stocks:
            if len(tk) >= 2:
                m = re.search(r"(?<![A-Za-z0-9$])" + re.escape(tk) + r"(?![A-Za-z0-9])", text)
                if m:
                    found.append((offset + m.start(), tk))
    return _ordered_unique(found)


# ── Classification ────────────────────────────────────────────────────────────

_DEFAULT_RULES: Rules | None = None


def set_default_rules(rules: Rules | dict) -> None:
    global _DEFAULT_RULES
    _DEFAULT_RULES = rules if isinstance(rules, Rules) else Rules(rules)


def _get_rules(rules: Rules | dict | None) -> Rules:
    if isinstance(rules, Rules):
        return rules
    if isinstance(rules, dict):
        return Rules(rules)
    if _DEFAULT_RULES is None:
        from config import load_filters  # lazy: keeps this module importable standalone
        set_default_rules(load_filters())
    return _DEFAULT_RULES  # type: ignore[return-value]


def _fmt(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def headline_keywords(title: str, r: Rules, categories: list, limit: int = 4) -> list[str]:
    """The words that made the post relevant, as written in the headline («tariffs», «Fed», «price target»):
    strongest first, best category first; anchored section prefixes («STOCKS |») and weight-1 noise skipped."""
    found: list[tuple[float, str]] = []
    for name in categories:
        cat = r.categories.get(name) if name else None
        if not cat:
            continue
        for _phrase, w, rx, anchored in cat["keywords"]:
            if anchored or w < 2:
                continue
            m = rx.search(title)
            if m and m.group(0).strip():
                found.append((w, m.group(0).strip()))
    out: list[str] = []
    for _w, word in sorted(found, key=lambda x: -x[0]):
        if not any(word.lower() == o.lower() or word.lower() in o.lower() or o.lower() in word.lower() for o in out):
            out.append(word)
        if len(out) >= limit:
            break
    return out


def classify(post: dict, rules: Rules | dict | None = None) -> dict:
    r = _get_rules(rules)
    title, body = post_text(post)
    body_scan = (body[: r.body_chars] + " " + " ".join(_hashtags(post))).strip()
    title_body = title + "\n" + body

    pairs = classify_pairs(post, r)
    title_tickers = text_tickers(title)
    stock_signals = text_tickers(title_body)            # for the scoring bonus: any stock signal
    for t in pairs["stocks"]:
        if t not in stock_signals:
            stock_signals.append(t)
    tickers = find_tickers(title, body, pairs["stocks"], r)  # for cashtags: confirmed by the text

    reasons: list[str] = []
    scores: dict[str, float] = {}
    hits: dict[str, list[tuple[float, str, str]]] = {}

    for name, cat in r.categories.items():
        if name == "crypto" and not r.crypto_major:
            continue
        if cat["requires"]:
            subject = any(rx.search(title) or rx.search(body_scan) for _, rx, _a in cat["requires"])
            if name == "crypto" and pairs["crypto_major"]:
                subject = True
            if not subject:
                continue
        total, h, in_title = 0.0, [], False
        for phrase, w, rx, anchored in cat["keywords"]:
            if rx.search(title):
                pts, where, in_title = w * r.title_weight, "title", True
            elif not anchored and rx.search(body_scan):
                pts, where = w * r.body_weight, "body"
            else:
                continue
            total += pts
            h.append((pts, phrase, where))
        if name == "stocks" and title_tickers:
            in_title = True  # "… (AAPL.O) …" in the headline
        if r.require_title_hit and not in_title:
            continue  # body-only mentions are incidental — the headline must be on topic
        # pair / ticker bonuses
        bonus_src = {"stocks": stock_signals, "commodities": pairs["commodities"], "crypto": pairs["crypto_major"]}.get(name)
        if bonus_src:
            b = min(len(bonus_src) * r.ticker_bonus, r.ticker_bonus_cap)
            total += b
            h.append((b, "tickers:" + ",".join(bonus_src[:3]), "pairs"))
        if total > 0:
            scores[name] = total
            hits[name] = sorted(h, key=lambda x: -x[0])

    # Penalties
    penalties: list[tuple[float, str]] = []
    for g in r.deny:
        text = title if g["where"] == "title" else title_body
        for phrase, rx, _a in g["matchers"]:
            if rx.search(text):
                penalties.append((g["penalty"], f"deny:{g['name']}('{phrase}')"))
                break
    if pairs["crypto_other"] and not (pairs["crypto_major"] or stock_signals or pairs["commodities"]):
        penalties.append((r.minor_crypto_penalty, f"minor-crypto-pairs({','.join(pairs['crypto_other'][:3])})"))
    penalty = sum(p for p, _ in penalties)

    hard_deny = any(p >= r.hard_penalty for p, _ in penalties)
    allow_hit = None if hard_deny else next((phrase for phrase, rx, _a in r.allow if rx.search(title)), None)

    best = max(scores, key=lambda k: scores[k]) if scores else None   # ties → first in filters.json
    best_score = scores.get(best, 0.0) if best else 0.0
    net = best_score - penalty

    for name in sorted(scores, key=lambda k: -scores[k]):
        top = ", ".join(f"'{p}'{'' if w == 'title' else '/' + w}+{_fmt(s)}" for s, p, w in hits[name][:4])
        reasons.append(f"{name}={_fmt(scores[name])} [{top}]")
    reasons += [f"{why} -{_fmt(p)}" for p, why in penalties]

    if allow_hit:
        keep = True
        reason = f"allow('{allow_hit}')"
        reasons.insert(0, reason)
        if best is None:
            best = next(iter(r.categories), None)
    elif best is None:
        keep = False
        reason = penalties[0][1] if penalties else "no market keywords"
    else:
        keep = net >= r.min_score
        if keep:
            reason = f"{best} {_fmt(net)}≥{_fmt(r.min_score)}: " + ", ".join(f"'{p}'" for _, p, _w in hits[best][:3])
        elif penalties:
            reason = max(penalties)[1] + f" (score {_fmt(best_score)}-{_fmt(penalty)})"
        else:
            reason = f"low score {_fmt(net)}<{_fmt(r.min_score)} (best: {best})"

    return {
        "keep": keep,
        "keywords": headline_keywords(title, r, [best] + sorted((k for k in scores if k != best), key=lambda k: -scores[k])),
        "category": best,
        "emoji": r.emoji(best),
        "score": net,
        "reason": reason,
        "reasons": reasons,
        "tickers": tickers[: r.max_cashtags],
        "scores": scores,
    }
