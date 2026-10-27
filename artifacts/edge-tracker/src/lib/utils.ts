import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge that knows the rhythm tokens (index.css): `gap-section` / `p-panel` / `gap-stack`… and
 * `leading-body` / `leading-ui`…, so `cn("p-panel", "p-3")` keeps only the later padding like any other class.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["section", "grid", "panel", "head", "stack", "inline", "field", "tile"],
      leading: ["body", "ui", "heading", "num"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Whether a page shortcut should be ignored: the key went to a field, an editable, a dialog, a list box or a menu. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!el.closest("[role=dialog],[role=listbox],[role=menu]");
}
