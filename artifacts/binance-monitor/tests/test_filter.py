"""
News filter tests — no network.

tests/fixtures/posts.json holds 200 real Binance News posts (title, first 600 chars of
the body, hashtags, trading-pair codes). "expect" is a hand label: "keep" / "drop" for
clear cases, null for borderline posts that the tests do not pin down.

Run from the bot folder:  python -m unittest discover -s tests -v
"""

import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import filter as nf  # noqa: E402
from config import load_filters  # noqa: E402

FILTERS_JSON = os.path.join(ROOT, "filters.json")


def load_fixture():
    with open(os.path.join(HERE, "fixtures", "posts.json"), encoding="utf-8") as f:
        return json.load(f)


class TestCuratedSamples(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = nf.Rules(load_filters(FILTERS_JSON))
        cls.posts = load_fixture()

    def test_fixture_has_enough_labels(self):
        keeps = [p for p in self.posts if p["expect"] == "keep"]
        drops = [p for p in self.posts if p["expect"] == "drop"]
        self.assertGreaterEqual(len(keeps), 25)
        self.assertGreaterEqual(len(drops), 25)

    def test_clear_keeps_are_kept(self):
        wrong = []
        for p in self.posts:
            if p["expect"] == "keep":
                v = nf.classify(p, self.rules)
                if not v["keep"]:
                    wrong.append(f"{p['title'][:80]} → {v['reason']}")
        self.assertEqual(wrong, [], "market news was dropped")

    def test_clear_drops_are_dropped(self):
        wrong = []
        for p in self.posts:
            if p["expect"] == "drop":
                v = nf.classify(p, self.rules)
                if v["keep"]:
                    wrong.append(f"{p['title'][:80]} → {v['reason']}")
        self.assertEqual(wrong, [], "junk was kept")

    def test_every_post_has_a_reason(self):
        for p in self.posts:
            v = nf.classify(p, self.rules)
            self.assertTrue(v["reason"], p["title"])
            self.assertIn("keep", v)
            self.assertIsInstance(v["score"], float)

    def _verdict(self, title_start):
        p = next(p for p in self.posts if p["title"].startswith(title_start))
        return nf.classify(p, self.rules)

    def test_categories(self):
        cases = {
            "U.S. ADP Weekly Employment": "macro",
            "GEOPOLITICS | Rubio Says": "policy",
            "Iran's Revolutionary Guards: Two Tankers": "policy",
            "European Gas Climbs": "commodities",
            "WTI and Brent Crude Slip": "commodities",
            "Micron Technology Plans to Invest": "ai",
            "Apple Gets Loop Capital Downgrade": "stocks",
            "PREMARKET MOVES |": "stocks",
            "Switzerland Approves Its First Bitcoin ETF": "crypto",
            "SEC Closes Public Comment Period": "crypto",
        }
        for start, cat in cases.items():
            v = self._verdict(start)
            self.assertTrue(v["keep"], start)
            self.assertEqual(v["category"], cat, start)

    def test_drop_reasons_name_the_rule(self):
        cases = {
            "Binance Wallet Launches Paris": "deny:binance_promo",
            "Draymond Green": "deny:sports_celebrity",
            "Technical Liu Pro": "deny:ta_opinion",
            "Trader 0x666": "deny:altcoins_onchain",
            "Otter.ai Secures": "deny:startup_funding",
            "New York Arrests 16": "deny:local_crime",
        }
        for start, rule in cases.items():
            v = self._verdict(start)
            self.assertFalse(v["keep"], start)
            self.assertTrue(v["reason"].startswith(rule), f"{start}: {v['reason']}")

    def test_cashtags_from_text_and_pairs(self):
        self.assertEqual(self._verdict("STOCKS | NeoCloud-Related CoreWeave")["tickers"][:2], ["CRWV", "NBIS"])
        self.assertIn("AAPL", self._verdict("Apple (AAPL.O)")["tickers"])
        self.assertIn("MMM", self._verdict("STOCKS | 3M Shares Rise")["tickers"])


class TestSwitches(unittest.TestCase):
    def setUp(self):
        self.cfg = load_filters(FILTERS_JSON)

    def test_crypto_major_off_drops_bitcoin_etf(self):
        post = {"title": "Switzerland Approves Its First Bitcoin ETF",
                "body": "FINMA approved the country's first Bitcoin ETF.", "tradingPairs": ["BTC"]}
        self.assertTrue(nf.classify(post, nf.Rules(self.cfg))["keep"])
        self.assertFalse(nf.classify(post, nf.Rules({**self.cfg, "crypto_major": False}))["keep"])

    def test_min_score_threshold(self):
        post = {"title": "Apple Partners With Perryman to Supply Titanium", "body": "", "tradingPairs": ["AAPLB"]}
        self.assertTrue(nf.classify(post, nf.Rules(self.cfg))["keep"])
        self.assertFalse(nf.classify(post, nf.Rules({**self.cfg, "min_score": 50}))["keep"])

    def test_allow_beats_soft_penalty_but_not_hard_deny(self):
        soft = {"title": "UK Rate Outlook Shifts After Powell Remarks", "body": ""}
        self.assertTrue(nf.classify(soft, nf.Rules(self.cfg))["keep"])
        hard = {"title": "Powell Meme Coin Surges 300% on Hyperliquid", "body": ""}
        self.assertFalse(nf.classify(hard, nf.Rules(self.cfg))["keep"])

    def test_minor_crypto_pairs_penalised(self):
        post = {"title": "XYZ Surges as Nasdaq Futures Rise", "body": "", "tradingPairs": ["XYZ"]}
        v = nf.classify(post, nf.Rules(self.cfg))
        self.assertTrue(any(r.startswith("minor-crypto-pairs(XYZ)") for r in v["reasons"]), v["reasons"])
        clean = nf.classify({**post, "tradingPairs": []}, nf.Rules(self.cfg))
        self.assertEqual(clean["score"] - v["score"], self.cfg["minor_crypto_penalty"])

    def test_raw_api_post_shape(self):
        raw = {
            "id": "1", "title": "Nvidia (NVDA.O) Shares Rise 3% Premarket After Earnings Beat",
            "body": '{"layout": {}}', "bodyTextOnly": "Nvidia shares rose in premarket trading.",
            "hashtagList": [], "tradingPairsV2": [
                {"code": "NVDAB", "futuresSymbol": "NVDAUSDT", "marketV2": "SPOT"},
                {"code": "AAPL", "futuresSymbol": "AAPLUSDT", "spotSymbol": "AAPLBUSDT", "marketV2": "FUTURES_UM"},
            ],
        }
        v = nf.classify(raw, nf.Rules(self.cfg))
        self.assertTrue(v["keep"])
        self.assertEqual(v["tickers"], ["NVDA"])  # AAPL pair is noise: not mentioned in the text


class TestKeywordSyntax(unittest.TestCase):
    def test_whole_word_any_case(self):
        rx, _ = nf.compile_phrase("oil")
        self.assertTrue(rx.search("Crude OIL rises"))
        self.assertFalse(rx.search("Toil and spoil"))

    def test_prefix_wildcard(self):
        rx, _ = nf.compile_phrase("tariff*")
        self.assertTrue(rx.search("New tariffs on China"))
        self.assertFalse(rx.search("antitariff"))

    def test_anchor(self):
        rx, anchored = nf.compile_phrase("^stocks |")
        self.assertTrue(anchored)
        self.assertTrue(rx.search("STOCKS | US futures fall"))
        self.assertFalse(rx.search("Chinese STOCKS | rally"))

    def test_uppercase_is_case_sensitive(self):
        rx, _ = nf.compile_phrase("US")
        self.assertTrue(rx.search("US futures fall"))
        self.assertFalse(rx.search("tell us more"))

    def test_symbol_phrases(self):
        rx, _ = nf.compile_phrase("raises $")
        self.assertTrue(rx.search("Meow Raises $31.6 Million"))
        self.assertFalse(rx.search("BMO Raises Alphabet Price Target"))
        rx, _ = nf.compile_phrase("S&P 500")
        self.assertTrue(rx.search("S&P 500 futures"))


class TestLoadFilters(unittest.TestCase):
    def test_missing_file_disables_filter(self):
        with self.assertLogs("config", level="WARNING"):
            cfg = load_filters(os.path.join(tempfile.gettempdir(), "no-such-filters-file.json"))
        self.assertFalse(cfg["enabled"])

    def test_broken_file_disables_filter(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            f.write("{ not json")
        try:
            with self.assertLogs("config", level="ERROR"):
                self.assertFalse(load_filters(f.name)["enabled"])
        finally:
            os.unlink(f.name)

    def test_partial_file_gets_defaults(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({"categories": {"macro": {"keywords": {"CPI": 3}}}, "min_score": 2}, f)
        try:
            cfg = load_filters(f.name)
            self.assertTrue(cfg["enabled"])
            self.assertEqual(cfg["min_score"], 2)
            self.assertTrue(cfg["crypto_major"])
            v = nf.classify({"title": "US CPI Rises 0.3%", "body": ""}, nf.Rules(cfg))
            self.assertTrue(v["keep"])
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
