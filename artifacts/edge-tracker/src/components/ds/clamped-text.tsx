import * as React from "react";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";

/**
 * Description under a page title: one line on phones / two from `sm`, with «ещё» when it does not fit (the full text
 * opens in place; «свернуть» folds it back). Measured, so a short line never shows the button.
 */
export function ClampedText({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = React.useState(false);
  const [over, setOver] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [open, children]);
  return (
    // «ещё» sits at the end of the clamped line (no extra row on a phone).
    <div className={cn("flex min-w-0 max-w-3xl items-end gap-2", className)}>
      <p ref={ref} className={cn("min-w-0 flex-1 text-sm text-muted-foreground", !open && "line-clamp-1 sm:line-clamp-2")}>{children}</p>
      {(over || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-sm text-sm font-medium leading-5 text-foreground/80 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? commonI18n.t("ds.less") : commonI18n.t("ds.more")}
        </button>
      )}
    </div>
  );
}
