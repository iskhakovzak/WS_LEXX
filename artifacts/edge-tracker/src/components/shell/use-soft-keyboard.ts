/**
 * Is the on-screen keyboard open (phones)? The phone dock hides while it is, so it never sits on top of the field
 * being typed into or squeezes the visible area.
 *
 * Two signals, either is enough:
 * - the visual viewport is much shorter than the layout viewport (iOS Safari, Chrome with `resizes-visual`);
 * - an editable field has focus on a touch device (Android Chrome resizes the layout viewport too, so the first
 *   signal never fires there).
 * Desktop (fine pointer, no visual-viewport gap) always reads «closed».
 */
import { useEffect, useState } from "react";

/** A keyboard takes ~260–350 px; browser chrome collapsing / expanding moves the viewport by < 100 px. */
const KEYBOARD_GAP = 140;

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

type FieldLike = { tagName?: string; type?: string; readOnly?: boolean; disabled?: boolean; isContentEditable?: boolean };

/** Does focusing this element bring up the soft keyboard? (Duck-typed: unit-tested without a DOM.) */
export function isTextEntry(el: FieldLike | Element | null | undefined): boolean {
  if (!el) return false;
  const f = el as FieldLike;
  if (f.isContentEditable) return true;
  const tag = f.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return !f.readOnly && !f.disabled;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((f.type ?? "text").toLowerCase()) && !f.readOnly && !f.disabled;
  return false;
}

/** Visual viewport this much shorter than the window = a keyboard (pure, unit-tested). */
export function keyboardFromViewport(windowHeight: number, visualHeight: number | null | undefined): boolean {
  return visualHeight != null && windowHeight - visualHeight > KEYBOARD_GAP;
}

export function useSoftKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia?.("(pointer: coarse)");
    const vv = window.visualViewport;
    const sync = () => {
      const byViewport = keyboardFromViewport(window.innerHeight, vv?.height);
      const byFocus = !!coarse?.matches && isTextEntry(document.activeElement);
      setOpen(byViewport || byFocus);
    };
    // focusout fires before the next element is focused: read activeElement after the focus has moved.
    const later = () => { window.setTimeout(sync, 0); };
    vv?.addEventListener("resize", sync);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", later);
    return () => {
      vv?.removeEventListener("resize", sync);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return open;
}
