import * as React from "react";

/**
 * A horizontally scrolling bar (Segmented on a phone) keeps its active option in view — e.g. a deep link to the last
 * tab. Scrolls the bar itself only (never the page). The bar must be the offsetParent of its buttons (`relative`).
 */
export function useScrollActiveIntoView(ref: React.RefObject<HTMLElement | null>, value: unknown, selector = '[aria-pressed="true"]') {
  React.useEffect(() => {
    const box = ref.current;
    const btn = box?.querySelector<HTMLElement>(selector);
    if (!box || !btn || box.scrollWidth <= box.clientWidth) return;
    const left = btn.offsetLeft, right = left + btn.offsetWidth;
    if (left < box.scrollLeft) box.scrollLeft = Math.max(0, left - 4);
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 4;
  }, [ref, value, selector]);
}
