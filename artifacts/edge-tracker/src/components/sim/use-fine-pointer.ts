/**
 * True on devices with a mouse / trackpad (hover + fine pointer) — hotkey legends and the hotkeys switch only make
 * sense there; touch-only phones and tablets get buttons only.
 */
import * as React from "react";

const QUERY = "(hover: hover) and (pointer: fine)";

export function useFinePointer(): boolean {
  const [fine, setFine] = React.useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const on = () => setFine(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return fine;
}
