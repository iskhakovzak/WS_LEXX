/**
 * Edge fade for horizontally scrolling bars (Segmented, SectionTabs, chip rows): marks the element with
 * `data-fade="l"`, `"r"` or `"l r"` while content is hidden past that edge, and the `.edge-fade` class in index.css
 * masks that edge — so a phone-width bar shows there is more to swipe to. No fade when everything fits.
 */
import * as React from "react";

export function useEdgeFade(ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      const v = [left && "l", right && "r"].filter(Boolean).join(" ");
      if (el.dataset.fade !== v) el.dataset.fade = v;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [ref]);
}
