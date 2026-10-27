/**
 * /discussions prefill (design audit wave 2): on a wide screen the reading pane is never an empty «pick a thread» while
 * the list has threads — open the first unread thread of the list as shown, else its top one. Once per visit (closing
 * it stays closed); a deep-linked thread wins. `ready` = threads and votes are in («Активные» / «Лучшие» order by votes,
 * and the pick must be the row shown first).
 */
import { useEffect, useRef } from "react";

export function useAutoOpenThread<T extends { id: number }>(opts: {
  ready: boolean;
  blocked: boolean;
  selectedId: number | null;
  list: readonly T[];
  isUnread: (id: number) => boolean;
  open: (id: number) => void;
}) {
  const done = useRef(false);
  const { ready, blocked, selectedId, list, isUnread, open } = opts;
  useEffect(() => {
    if (done.current || !ready || blocked) return;
    done.current = true;
    if (selectedId || typeof window === "undefined" || !window.matchMedia("(min-width: 1024px)").matches) return;
    const pick = list.find((t) => isUnread(t.id)) ?? list[0];
    if (pick) open(pick.id);
  }, [ready, blocked, selectedId, list, isUnread, open]);
}
