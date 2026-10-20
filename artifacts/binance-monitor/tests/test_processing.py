"""
Monitor loop logic (processing.py) — no network, no Telegram:
  * a malformed post is logged and marked seen, the rest of the batch still goes out;
  * a broken filters.json keeps the last working rules (and a restart uses the saved copy);
  * posts older than the age cutoff when first seen are marked seen, not sent;
  * the polling alert fires after N minutes of consecutive failures, at most once per hour.

Run from the bot folder:  python -m unittest discover -s tests -v
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import processing as pr  # noqa: E402
from storage import State  # noqa: E402

FILTERS_JSON = os.path.join(ROOT, "filters.json")
NOW = 1_800_000_000_000  # ms
MIN = 60_000


def read_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def post(pid: str, title: str, age_min: float = 1, **extra) -> dict:
    return {"id": pid, "title": title, "bodyTextOnly": "", "firstReleaseTime": NOW - int(age_min * MIN), **extra}


class Sink:
    def __init__(self, fail_ids=()):
        self.sent: list[str] = []
        self.fail_ids = set(fail_ids)

    async def __call__(self, p: dict, verdict: dict) -> None:
        if p["id"] in self.fail_ids:
            raise RuntimeError("Telegram send failed: 502")
        self.sent.append(p["id"])


class TmpDir(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "filters.json")
        self.last_good = os.path.join(self.dir, "filters.last-good.json")
        shutil.copyfile(FILTERS_JSON, self.path)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, text: str) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(text)
        # a new mtime even on coarse file systems
        st = os.stat(self.path)
        os.utime(self.path, (st.st_atime, st.st_mtime + 5))

    def handle(self, posts, filters, sink, state=None, **kw):
        state = state or State()
        counts = asyncio.run(pr.handle_new_posts(posts, state, filters, sink, now=NOW, persist=lambda s: None, **kw))
        return state, counts


class TestPerPostIsolation(TmpDir):
    def test_malformed_post_is_logged_and_marked_seen(self):
        filters = pr.FilterRules(self.path, self.last_good)
        good = post("2", "Fed cuts rates by 50 bps, Powell says inflation is cooling")
        bad = post("1", "Nvidia earnings beat", hashtags=[1])  # the audit's crash: a non-string hashtag
        bad2 = post("3", "Apple stock jumps", tradingPairsV2=[{"code": 5}])  # another odd shape
        with self.assertLogs("monitor", "ERROR") as log:
            state, counts = self.handle([bad2, good, bad], filters, sink := Sink())
        self.assertIn("2", sink.sent)
        self.assertTrue(state.is_seen("1") and state.is_seen("2") and state.is_seen("3"))
        self.assertGreaterEqual(counts["errors"], 1)
        self.assertTrue(any("Malformed post id=1" in line for line in log.output))
        # the next poll does not retry it (no crash loop)
        _, again = self.handle([bad2, good, bad], filters, Sink(), state=state)
        self.assertEqual(again, {"sent": 0, "dropped": 0, "old": 0, "errors": 0})

    def test_telegram_failure_does_not_stop_the_batch(self):
        filters = pr.FilterRules(self.path, self.last_good)
        a = post("1", "Fed cuts rates by 50 bps, Powell says inflation is cooling", age_min=2)
        b = post("2", "Oil prices surge as OPEC cuts output", age_min=1)
        with self.assertLogs("monitor", "ERROR"):
            state, counts = self.handle([b, a], filters, sink := Sink(fail_ids={"1"}))
        self.assertEqual(sink.sent, ["2"])
        self.assertEqual(counts["errors"], 1)
        self.assertTrue(state.is_seen("1"))


class TestAgeCutoff(TmpDir):
    def test_old_posts_are_marked_not_sent(self):
        filters = pr.FilterRules(self.path, self.last_good)
        old = post("1", "Fed cuts rates by 50 bps, Powell says inflation is cooling", age_min=16)
        fresh = post("2", "Fed cuts rates by 50 bps, Powell says inflation is cooling", age_min=14)
        state, counts = self.handle([fresh, old], filters, sink := Sink(), max_age_minutes=15)
        self.assertEqual(sink.sent, ["2"])
        self.assertEqual(counts["old"], 1)
        self.assertTrue(state.is_seen("1"))

    def test_zero_disables_the_cutoff_and_unknown_time_is_sent(self):
        filters = pr.FilterRules(self.path, self.last_good)
        old = post("1", "Fed cuts rates by 50 bps, Powell says inflation is cooling", age_min=600)
        no_time = {"id": "2", "title": "Fed cuts rates by 50 bps, Powell says inflation is cooling"}
        _, counts = self.handle([no_time, old], filters, sink := Sink(), max_age_minutes=0)
        self.assertEqual(sorted(sink.sent), ["1", "2"])
        self.assertEqual(counts["old"], 0)


class TestFilterReload(TmpDir):
    def test_broken_json_keeps_the_last_working_rules(self):
        filters = pr.FilterRules(self.path, self.last_good)
        self.assertTrue(filters.active)
        rules = filters.rules
        self.write("{ not json")
        with self.assertLogs("monitor", "ERROR") as log:
            filters.refresh()
        self.assertIs(filters.rules, rules)
        self.assertTrue(filters.active)
        self.assertTrue(any("keeping the last working rules" in line for line in log.output))

    def test_bad_value_and_deleted_file_keep_the_rules(self):
        filters = pr.FilterRules(self.path, self.last_good)
        rules = filters.rules
        cfg = read_json(self.path)
        first = next(iter(cfg["categories"].values()))
        first["keywords"][next(iter(first["keywords"]))] = None  # the audit's "weight": null
        self.write(json.dumps(cfg))
        with self.assertLogs("monitor", "ERROR"):
            filters.refresh()
        self.assertIs(filters.rules, rules)
        os.remove(self.path)
        with self.assertLogs("monitor", "ERROR"):
            filters.refresh()
        self.assertIs(filters.rules, rules)
        self.assertTrue(filters.active)

    def test_a_fixed_file_is_picked_up(self):
        filters = pr.FilterRules(self.path, self.last_good)
        self.write("{ not json")
        with self.assertLogs("monitor", "ERROR"):
            filters.refresh()
        cfg = read_json(FILTERS_JSON)
        cfg["min_score"] = 9
        self.write(json.dumps(cfg))
        filters.refresh()
        self.assertEqual(filters.rules.min_score, 9)

    def test_restart_with_a_broken_file_uses_the_saved_copy(self):
        pr.FilterRules(self.path, self.last_good)  # saves filters.last-good.json
        self.assertTrue(os.path.exists(self.last_good))
        self.write("{ not json")
        with self.assertLogs("monitor", "ERROR"):
            filters = pr.FilterRules(self.path, self.last_good)
        self.assertTrue(filters.loaded)
        self.assertTrue(filters.active)

    def test_nothing_working_at_all_means_filter_off(self):
        self.write("{ not json")
        with self.assertLogs("monitor", "ERROR"):
            filters = pr.FilterRules(self.path, self.last_good)
        self.assertFalse(filters.active)

    def test_enabled_false_is_respected(self):
        cfg = read_json(FILTERS_JSON)
        cfg["enabled"] = False
        self.write(json.dumps(cfg))
        self.assertFalse(pr.FilterRules(self.path, self.last_good).active)


class TestPollHealth(unittest.TestCase):
    def test_alert_after_n_minutes_then_at_most_hourly(self):
        h = pr.PollHealth(alert_minutes=10, repeat_s=3600)
        t0 = 1000.0
        self.assertFalse(h.failed(t0))
        self.assertFalse(h.failed(t0 + 9 * 60))
        self.assertTrue(h.failed(t0 + 10 * 60))          # 10 minutes down
        self.assertEqual(h.errors, 3)
        self.assertFalse(h.failed(t0 + 30 * 60))         # within the hour
        self.assertTrue(h.failed(t0 + 10 * 60 + 3600))   # an hour after the first alert
        self.assertEqual(h.ok(), 5)
        self.assertEqual(h.errors, 0)
        # a new outage: needs 10 minutes again, and still ≤ 1 alert per hour
        self.assertFalse(h.failed(t0 + 10 * 60 + 3600 + 60))
        self.assertFalse(h.failed(t0 + 10 * 60 + 3600 + 12 * 60))
        self.assertTrue(h.failed(t0 + 10 * 60 + 7200 + 60))

    def test_a_success_resets_the_streak(self):
        h = pr.PollHealth(alert_minutes=10)
        h.failed(0)
        h.ok()
        self.assertFalse(h.failed(9 * 60))
        self.assertAlmostEqual(h.down_minutes(9 * 60), 0)


if __name__ == "__main__":
    unittest.main()
