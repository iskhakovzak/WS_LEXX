/**
 * Live numbers: a polled value (risk desk P&L, «left to the stop», dashboard today, team view, office KPIs) rolls to
 * its new value and its cell briefly tints green / red by the direction of the move.
 *
 *   <LiveNumber value={pnl} format={(n) => fmtUsd(n, { signed: true })} />      // tween + self flash
 *   const f = useFlashOnChange(pnl);  <td className={f.className}>…<LiveNumber value={pnl} flash={false} /></td>
 *
 * Rules (lib/live-flash): no flash on the first value, on a refetch with the same value, on sub-cent noise or after a
 * context switch (`resetKey`: scope, period, unit). Reduced motion: the value changes instantly and the flash is a
 * static thin underline for a moment instead of a fade. Screen readers get the final value only (the tween is
 * aria-hidden); `announce` adds a polite live region — use it for one key number per screen, never on table cells.
 */
import * as React from "react";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { fmtCount } from "@/lib/format";
import { FLASH_MS, FLASH_STATIC_MS, INITIAL_FLASH, flashClassName, reduceFlash, type FlashDir } from "@/lib/live-flash";
import { AnimatedNumber } from "./motion";

export type FlashOnChange = { dir: FlashDir | null; tick: number; className: string };

/**
 * Watches a number and reports a short-lived flash when it moves (see lib/live-flash for the rules). The flash clears
 * itself after the fade (700 ms) or, under reduced motion, after the static marker's hold.
 */
export function useFlashOnChange(
  value: number | null | undefined,
  opts: { resetKey?: unknown; epsilon?: number; disabled?: boolean } = {},
): FlashOnChange {
  const { resetKey, epsilon, disabled = false } = opts;
  const reduce = useReducedMotion();
  const stateRef = React.useRef(INITIAL_FLASH);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flash, setFlash] = React.useState<{ dir: FlashDir; tick: number } | null>(null);

  React.useEffect(() => {
    const prev = stateRef.current;
    const next = reduceFlash(prev, value, resetKey, epsilon);
    stateRef.current = next;
    if (next === prev) return;
    if (next.tick === prev.tick || !next.dir || disabled) {
      // A context switch or a gap: drop a flash that belongs to the old value.
      if (!next.dir) setFlash(null);
      return;
    }
    const tick = next.tick;
    setFlash({ dir: next.dir, tick });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFlash((f) => (f && f.tick === tick ? null : f)), reduce ? FLASH_STATIC_MS : FLASH_MS);
  }, [value, resetKey, epsilon, disabled, reduce]);

  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { dir: flash?.dir ?? null, tick: flash?.tick ?? 0, className: flash ? flashClassName(flash.dir, flash.tick) : "" };
}

/**
 * A live number: tabular figures, a 400 ms tween to the new value (instant under reduced motion) and, unless
 * `flash={false}` (the parent cell flashes instead via useFlashOnChange), a soft tint on itself. The flash is a CSS
 * animation: keep other animations (e.g. `reveal`) on a wrapper, not in `className`.
 */
export function LiveNumber({
  value,
  format = (n) => fmtCount(n),
  resetKey,
  epsilon,
  flash = true,
  announce = false,
  countIn = false,
  countInDuration,
  duration = 400,
  className,
  title,
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  /** Context of the value (scope / period / unit): a change re-bases without a flash. */
  resetKey?: unknown;
  /** Smallest move that counts (default one cent). */
  epsilon?: number;
  flash?: boolean;
  /** Polite live region with the final value. One key number per screen at most. */
  announce?: boolean;
  /** The first value counts up from 0 (the dashboard's day number). */
  countIn?: boolean;
  /** Duration of that first count-up (the tween of later changes stays `duration`). */
  countInDuration?: number;
  duration?: number;
  className?: string;
  title?: string;
}) {
  const f = useFlashOnChange(value, { resetKey, epsilon, disabled: !flash });
  const finite = typeof value === "number" && Number.isFinite(value);
  return (
    <span
      className={cn("inline-block w-fit tabular-nums", flash && "-mx-[0.2em] rounded-[0.25em] px-[0.2em]", flash && f.className, className)}
      title={title}
      data-live={f.dir ?? undefined}
    >
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={format} duration={duration} countIn={countIn} countInDuration={countInDuration} />
      </span>
      <span className="sr-only select-none" aria-live={announce ? "polite" : undefined} aria-atomic={announce ? true : undefined}>
        {finite ? format(value) : "—"}
      </span>
    </span>
  );
}
