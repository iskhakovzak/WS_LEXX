/**
 * Motion tokens for framer-motion + small animated primitives. CSS twins live in index.css
 * (--dur-1..4, --ease, utilities dur-1..4 / ease-smooth). Everything here respects prefers-reduced-motion.
 *
 *   <motion.div transition={MOTION.base} />            // 180 ms, desk easing
 *   <AnimatedNumber value={pnl} format={fmtUsd} />     // count to the new value, no layout shift
 *   <AnimatedNumber value={pnl} countIn duration={700} /> // hero number: also counts up from 0 when it first appears
 *   <h1 className="reveal">                            // CSS: blur-to-sharp + fade on mount (index.css `reveal`)
 *   <Reveal open={expanded}>…</Reveal>                 // height expand/collapse (grid-rows trick, no measuring)
 */
import * as React from "react";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { fmtCount } from "@/lib/format";

export const EASE = [0.2, 0.8, 0.2, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

/** Durations in seconds (framer-motion units): fast 120 / base 180 / slow 240 / sheet 320 ms. */
export const DURATION = { fast: 0.12, base: 0.18, slow: 0.24, sheet: 0.32 } as const;

export const MOTION = {
  fast: { duration: DURATION.fast, ease: EASE },
  base: { duration: DURATION.base, ease: EASE },
  slow: { duration: DURATION.slow, ease: EASE },
  sheet: { duration: DURATION.sheet, ease: EASE },
} as const;

/** Enter preset for lists/cards: fade + 4px rise. Spread on a motion element. */
export function fadeRise(reduce: boolean | null, delay = 0) {
  return reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { ...MOTION.base, delay } };
}

/**
 * Number that tweens to its new value (rAF, ~240 ms, ease-out). Tabular digits plus invisible copies of the final
 * text (and, while rolling, of the start text) stacked in one grid cell keep the box exactly as wide as the widest of
 * them, so the width never jumps mid-roll. Instant under reduced motion or on first render, unless `countIn`:
 * then the first value counts up from 0 (the dashboard's day number), later changes tween as usual.
 */
export function AnimatedNumber({
  value,
  format = (n) => fmtCount(n),
  duration = 240,
  countIn = false,
  countInDuration,
  className,
  title,
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  duration?: number;
  countIn?: boolean;
  /** Duration of the first count-up from 0 (defaults to `duration`); later changes use `duration`. */
  countInDuration?: number;
  className?: string;
  title?: string;
}) {
  const reduce = useReducedMotion();
  const target = typeof value === "number" && Number.isFinite(value) ? value : null;
  const countFromZero = countIn && !reduce && target != null && target !== 0;
  const [shown, setShown] = React.useState<number | null>(countFromZero ? 0 : target);
  const fromRef = React.useRef<number | null>(countFromZero ? 0 : target);
  // countIn: the first value to arrive (also after a loading state) starts from 0.
  const countedRef = React.useRef(!countIn);
  const formatRef = React.useRef(format);
  formatRef.current = format;
  // The start text while a tween runs: its invisible copy holds the width (1,050 → 950 must not shrink mid-roll).
  const [fromText, setFromText] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (target == null) { setShown(null); fromRef.current = null; return; }
    const from = fromRef.current == null && !countedRef.current ? 0 : fromRef.current;
    const ms = countedRef.current ? duration : (countInDuration ?? duration);
    countedRef.current = true;
    if (reduce || from == null || from === target || typeof requestAnimationFrame === "undefined") {
      setShown(target); fromRef.current = target; return;
    }
    let raf = 0;
    const start = performance.now();
    setFromText(formatRef.current(from));
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * k;
      setShown(t >= 1 ? target : v);
      fromRef.current = t >= 1 ? target : v;
      if (t < 1) raf = requestAnimationFrame(step);
      else setFromText(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce, duration, countInDuration]);

  if (shown == null) return <span className={cn("tabular-nums text-muted-foreground", className)}>—</span>;
  const finalText = target != null ? formatRef.current(target) : "";
  const ghost = "invisible col-start-1 row-start-1 whitespace-nowrap";
  return (
    <span className={cn("inline-grid tabular-nums", className)} title={title}>
      <span aria-hidden="true" className={ghost}>{finalText}</span>
      {fromText != null && <span aria-hidden="true" className={ghost}>{fromText}</span>}
      <span className="col-start-1 row-start-1 whitespace-nowrap">{format(shown)}</span>
    </span>
  );
}

/**
 * Expand/collapse without measuring: animates grid-template-rows 0fr ↔ 1fr (240 ms).
 * Collapsed content is `inert` (not focusable, hidden from AT) but stays mounted, so state is kept.
 */
export function Reveal({
  open,
  children,
  className,
  id,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [open]);
  return (
    <div
      id={id}
      ref={ref}
      aria-hidden={!open}
      data-state={open ? "open" : "closed"}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[var(--dur-3)] ease-smooth",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
