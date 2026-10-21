"""
Show what the news filter would do with a file of saved posts — for tuning filters.json.

    python review_filter.py samples.json               # every post: KEEP/DROP, category, score, reason
    python review_filter.py samples.json --drop        # only dropped posts
    python review_filter.py samples.json --keep -v     # only kept posts, with full scoring details
    python review_filter.py samples.json --filters my-filters.json

The file may be a JSON list of posts (raw API objects or slimmed {title, body, …})
or a raw API response {"data": {"contents": [...]}}. No network access.
"""

import argparse
import json
import sys
from collections import Counter

import filter as news_filter
from config import FILTERS_FILE, load_filters


def load_posts(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = (data.get("data") or {}).get("contents") or data.get("posts") or []
    return [p for p in data if isinstance(p, dict)]


def _reason_group(reason: str) -> str:
    """'deny:binance_promo('binance wallet') (…)' → 'deny:binance_promo', 'low score 3<5 …' → 'low score'."""
    if reason.startswith("low score"):
        return "low score"
    return reason.split("(")[0].strip()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="JSON file(s) with posts")
    ap.add_argument("--filters", default=FILTERS_FILE, help="filters.json to use (default: next to the bot)")
    only = ap.add_mutually_exclusive_group()
    only.add_argument("--keep", action="store_true", help="show only kept posts")
    only.add_argument("--drop", action="store_true", help="show only dropped posts")
    ap.add_argument("-v", "--verbose", action="store_true", help="print all scoring details")
    args = ap.parse_args(argv)

    cfg = load_filters(args.filters)
    if not cfg.get("enabled", True):
        print(f"!! {args.filters} missing or invalid — the bot would forward everything")
    rules = news_filter.Rules(cfg)

    totals, cats, drops = Counter(), Counter(), Counter()
    for path in args.files:
        for post in load_posts(path):
            v = news_filter.classify(post, rules)
            title, _ = news_filter.post_text(post)
            totals["keep" if v["keep"] else "drop"] += 1
            if v["keep"]:
                cats[v["category"]] += 1
            else:
                drops[_reason_group(v["reason"])] += 1
            if (args.keep and not v["keep"]) or (args.drop and v["keep"]):
                continue
            tag = "KEEP" if v["keep"] else "drop"
            cat = f"{v['emoji']} {v['category'] or '-'}"
            print(f"{tag} {cat:<14} {v['score']:>6g}  {title[:90]}")
            print(f"       ↳ {v['reason']}" + (f"   ${' $'.join(v['tickers'])}" if v["tickers"] and v["keep"] else ""))
            if args.verbose:
                for r in v["reasons"]:
                    print(f"         · {r}")

    n = totals["keep"] + totals["drop"]
    print()
    print(f"Total {n}: KEEP {totals['keep']} / DROP {totals['drop']}")
    if cats:
        print("Kept by category: " + ", ".join(f"{rules.emoji(c)} {c} {k}" for c, k in cats.most_common()))
    if drops:
        print("Drop reasons:     " + ", ".join(f"{r} {k}" for r, k in drops.most_common()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
