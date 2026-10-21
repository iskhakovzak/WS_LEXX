import json
import logging
import os

from config import SEEN_IDS_LIMIT, STORAGE_FILE

logger = logging.getLogger(__name__)


class State:
    """
    Dedup state persisted in storage.json:
      seen      — recent post IDs already handled (newest last, capped)
      last_time — newest firstReleaseTime (ms) handled so far
    """

    def __init__(self, seen: list[str] | None = None, last_time: int = 0):
        self.seen: list[str] = list(seen or [])
        self._seen_set = set(self.seen)
        self.last_time = last_time

    def is_seen(self, post_id: str) -> bool:
        return post_id in self._seen_set

    def mark(self, post_id: str, release_time: int) -> None:
        if post_id and post_id not in self._seen_set:
            self.seen.append(post_id)
            self._seen_set.add(post_id)
            if len(self.seen) > SEEN_IDS_LIMIT:
                for old in self.seen[:-SEEN_IDS_LIMIT]:
                    self._seen_set.discard(old)
                self.seen = self.seen[-SEEN_IDS_LIMIT:]
        self.last_time = max(self.last_time, release_time)


def load_state() -> State | None:
    """Return saved state, or None if absent / unreadable / old format."""
    if not os.path.exists(STORAGE_FILE):
        return None
    try:
        with open(STORAGE_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        logger.warning(f"Cannot read {STORAGE_FILE}: {e}")
        return None
    if not isinstance(data, dict) or "seen" not in data:
        logger.warning(f"{STORAGE_FILE} has old format — will re-bootstrap")
        return None
    return State(seen=[str(x) for x in data.get("seen") or []],
                 last_time=int(data.get("last_time") or 0))


def save_state(state: State) -> None:
    """Write atomically so a crash mid-write can't corrupt the file."""
    tmp = STORAGE_FILE + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"seen": state.seen, "last_time": state.last_time}, f)
        os.replace(tmp, STORAGE_FILE)
    except Exception as e:
        logger.error(f"Cannot write {STORAGE_FILE}: {e}")
