"""Message formatting tests (Telegram HTML) — no network."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import filter as nf  # noqa: E402
import formatter as fm  # noqa: E402

LINK = "https://www.binance.com/en/square/post/379300567738538"


class TestBuildMessage(unittest.TestCase):
    def test_layout(self):
        msg = fm.build_message(
            "Apple Gets Loop Capital Downgrade",
            "According to CNBC, Loop Capital downgraded Apple to hold. Analyst Ananda Baruah said sales may slow.",
            LINK, "📈", ["AAPL"],
        )
        self.assertEqual(
            msg,
            "📈 <b>Apple Gets Loop Capital Downgrade</b>\n\n"
            "Loop Capital downgraded Apple to hold. Analyst Ananda Baruah said sales may slow.\n\n"
            "$AAPL\n"
            f'🔗 <a href="{LINK}">Binance Square</a>',
        )

    def test_html_escaping(self):
        msg = fm.build_message("AT&T <b>beats</b> > estimates", "Q3 EPS <$1 & revenue > $30B.", LINK, "📈")
        self.assertIn("<b>AT&amp;T &lt;b&gt;beats&lt;/b&gt; &gt; estimates</b>", msg)
        self.assertIn("Q3 EPS &lt;$1 &amp; revenue &gt; $30B.", msg)
        self.assertEqual(msg.count("<b>"), 1)

    def test_link_escaping_and_scheme(self):
        msg = fm.build_message("T", "", 'https://x.com/a?b=1&c="2"', "📰")
        self.assertIn('href="https://x.com/a?b=1&amp;c=&quot;2&quot;"', msg)
        msg = fm.build_message("T", "", "javascript:alert(1)<x>", "📰")
        self.assertNotIn("<a ", msg)
        self.assertIn("javascript:alert(1)&lt;x&gt;", msg)

    def test_no_body_no_tickers_no_link(self):
        self.assertEqual(fm.build_message("Gold Dips", "", "", "🛢"), "🛢 <b>Gold Dips</b>")

    def test_body_equal_to_title_is_skipped(self):
        msg = fm.build_message("Gold dips below $4,000", "Gold dips below $4,000.", "", "🛢")
        self.assertEqual(msg, "🛢 <b>Gold dips below $4,000</b>")

    def test_4096_limit(self):
        msg = fm.build_message("A&B " * 2000, "Body. " * 500, LINK, "📈", ["AAPL"])
        self.assertLessEqual(len(msg), fm.MAX_LEN)
        self.assertTrue(msg.startswith("📈 <b>"))
        self.assertIn("</b>", msg)
        self.assertTrue(msg.endswith("Binance Square</a>"))
        self.assertNotRegex(msg, r"&[a-z]*…")  # never cut inside an entity

    def test_plain_fallback(self):
        msg = fm.build_message("AT&T <up>", "Body.", LINK, "📈")
        plain = fm.html_to_plain(msg)
        self.assertIn("AT&T <up>", plain)
        self.assertIn(LINK, plain)
        self.assertNotIn("<b>", plain)


class TestShortBody(unittest.TestCase):
    def test_one_or_two_sentences(self):
        body = "First sentence here. Second one is short. Third should not appear."
        self.assertEqual(fm.short_body(body), "First sentence here. Second one is short.")

    def test_long_first_sentence_alone(self):
        first = "Word " * 50 + "end."
        body = first + " Second sentence."
        self.assertEqual(fm.short_body(body), first.strip())

    def test_limit_400_with_ellipsis(self):
        out = fm.short_body("word " * 300)
        self.assertLessEqual(len(out), 400)
        self.assertTrue(out.endswith("…"))

    def test_abbreviations_do_not_split(self):
        body = "U.S. President Donald Trump met Apple Inc. executives on Monday. Shares rose 2%. Ignored."
        self.assertEqual(fm.short_body(body),
                         "U.S. President Donald Trump met Apple Inc. executives on Monday. Shares rose 2%.")

    def test_numbers_end_sentences(self):
        body = "Claims were 18,500 for the week through October 3. The previous reading was 24,750. More."
        self.assertEqual(fm.short_body(body),
                         "Claims were 18,500 for the week through October 3. The previous reading was 24,750.")

    def test_attribution_prefix_removed(self):
        self.assertEqual(fm.short_body("According to Jin10, apple says glass will be made in Kentucky."),
                         "Apple says glass will be made in Kentucky.")
        self.assertEqual(fm.short_body("Approval fell. According to NS3.AI, the rating was 34%."),
                         "Approval fell. The rating was 34%.")


class TestCashtags(unittest.TestCase):
    def setUp(self):
        self.rules = nf.Rules({"company_tickers": {"apple": "AAPL", "nvidia": "NVDA"}})

    def test_text_patterns(self):
        self.assertEqual(nf.text_tickers("Apple (AAPL.O) and 3M (MMM.N) rose; CRWV.O fell"), ["AAPL", "MMM", "CRWV"])
        self.assertEqual(nf.text_tickers("Shares of (NASDAQ: NVDA) and (NYSE: KO)"), ["NVDA", "KO"])
        self.assertEqual(nf.text_tickers("The U.S. and U.N. met in the U.K."), [])

    def test_names_and_confirmed_pairs(self):
        tickers = nf.find_tickers("Apple beats", "RTX gained 1%, Nvidia (NASDAQ: NVDA) flat.", ["RTX", "TSLA"], self.rules)
        self.assertEqual(tickers, ["AAPL", "RTX", "NVDA"])  # TSLA pair is not mentioned → no cashtag

    def test_cashtag_line(self):
        self.assertEqual(fm.cashtags(["AAPL", "aapl", "BRK.B", "", "1INCH"]), "$AAPL $BRK.B")

    def test_pairs_classification_from_codes(self):
        rules = nf.Rules({"pairs": {"crypto_major_codes": ["BTC"], "commodity_codes": ["XAU"], "not_stock_codes": ["BNB"]}})
        res = nf.classify_pairs({"tradingPairs": ["AAPLB", "MUB", "BNB", "BTC", "XAU", "SOL", "RTX.US"]}, rules)
        self.assertEqual(res["stocks"], ["AAPL", "MU", "RTX"])
        self.assertEqual(res["crypto_major"], ["BTC"])
        self.assertEqual(res["commodities"], ["XAU"])
        self.assertEqual(res["crypto_other"], ["BNB", "SOL"])


if __name__ == "__main__":
    unittest.main()
