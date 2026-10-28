import * as React from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/motion";

/** Where the bar settles while the answer is still on its way: it never claims «done» before the result arrives. */
const WAIT_CEILING = 0.9;

/**
 * Perceived progress for a long server wait (AI brief / debrief / review / critique, checklist generation): a thin bar
 * that starts fast and eases toward 90 % over about `expectedMs` (the --ease-out token), then holds there until the
 * caller unmounts it with the result. It is not a measurement, so assistive tech gets no value — the caller's pending
 * label («Генерирую…», aria-busy) stays the real status. With motion off (lib/motion) nothing moves: no bar.
 *
 * `inButton`: a 2px line along the bottom edge of a `relative` button; otherwise a full-width track.
 */
export function WaitProgress({ expectedMs = 8000, inButton = false, className }: { expectedMs?: number; inButton?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const [go, setGo] = React.useState(false);
  const fill = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    // Flush the start width (forced style read), then switch on the transition from it. No rAF: a background tab
    // pauses frames, and the wait must already be under way when the viewer comes back.
    fill.current?.getBoundingClientRect();
    setGo(true);
  }, []);
  if (reduced) return null;
  return (
    <span
      aria-hidden="true"
      data-slot="wait-progress"
      className={cn(
        "pointer-events-none block overflow-hidden rounded-full",
        inButton ? "absolute inset-x-3 bottom-[3px] h-[2px] bg-current/15" : "h-1 w-full bg-[hsl(var(--foreground)/0.08)]",
        className,
      )}
    >
      <span
        ref={fill}
        className={cn("block h-full w-full origin-left rounded-full", inButton ? "bg-current/70" : "bg-[hsl(var(--primary))]")}
        style={{
          transform: `scaleX(${go ? WAIT_CEILING : 0.06})`,
          transition: go ? `transform ${expectedMs}ms var(--ease-out)` : "none",
        }}
      />
    </span>
  );
}
