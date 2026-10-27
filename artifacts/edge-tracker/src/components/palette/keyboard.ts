/**
 * Tab / Shift+Tab inside the palette jump to the first row of the next / previous group (cmdk itself only moves row
 * by row). Reads the rendered groups, so it follows whatever order the groups are drawn in.
 */
import * as React from "react";
import { nextGroupValue } from "./rank";

/** Keys that move the selection by hand (after one, the palette stops pinning the first row). */
export const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "Tab", "Home", "End", "PageUp", "PageDown"]);

/**
 * Keeps the first row selected while results stream in (recents, quick actions, server hits, deferred renders) until
 * the user moves the selection; `resetKey` (query, mode…) starts pinning again. Returns the "user moved" marker.
 */
export function usePinFirst(listRef: React.RefObject<HTMLElement | null>, value: string, setValue: (v: string) => void, resetKey: string, enabled: boolean) {
  const moved = React.useRef(false);
  React.useEffect(() => { moved.current = false; }, [resetKey]);
  React.useEffect(() => {
    if (!enabled || moved.current) return;
    const list = listRef.current;
    const first = list?.querySelector("[cmdk-item]")?.getAttribute("data-value");
    if (!list || !first || first === value) return;
    setValue(first);
    // The first row with its group heading: back to the top (cmdk only scrolls for its own key moves).
    list.scrollTop = 0;
  });
  return React.useCallback(() => { moved.current = true; }, []);
}

export function useGroupTab(listRef: React.RefObject<HTMLElement | null>, setValue: (v: string) => void) {
  return React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
      const list = listRef.current;
      if (!list) return;
      const groups = Array.from(list.querySelectorAll<HTMLElement>("[cmdk-group]")).map((g) =>
        Array.from(g.querySelectorAll<HTMLElement>("[cmdk-item]:not([aria-disabled='true'])")).map((i) => i.getAttribute("data-value") ?? ""),
      );
      const current = list.querySelector<HTMLElement>("[cmdk-item][data-selected='true']")?.getAttribute("data-value");
      const next = nextGroupValue(groups, current, e.shiftKey ? -1 : 1);
      if (next == null) return;
      e.preventDefault();
      setValue(next);
      requestAnimationFrame(() => {
        const el = Array.from(list.querySelectorAll<HTMLElement>("[cmdk-item]")).find((i) => i.getAttribute("data-value") === next);
        // The group heading comes into view with its first row.
        el?.closest<HTMLElement>("[cmdk-group]")?.querySelector<HTMLElement>("[cmdk-group-heading]")?.scrollIntoView({ block: "nearest" });
        el?.scrollIntoView({ block: "nearest" });
      });
    },
    [listRef, setValue],
  );
}
