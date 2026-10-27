/**
 * The lock screen's face: the date, a large local clock in the intro's italic serif, and New York time with the
 * market phase. No trading data. The block drifts with --dx / --dy (./ambient.ts) and has a breathing halo behind it.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { lockI18n } from "@/i18n/ns/lock";

export type MarketPhase = "pre" | "regular" | "after" | "closed";

const PHASE_DOT: Record<MarketPhase, string> = {
  pre: "bg-warn",
  regular: "bg-up",
  after: "bg-purple",
  closed: "bg-white/45",
};

/** Italic serif: the app's accent stack (index.css --app-font-serif), the same as the intro's name. */
const SERIF = "var(--app-font-serif)";

function useNow(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    // Tick on the second boundary so the minute flips exactly on time.
    let timer = 0;
    const loop = () => {
      setNow(new Date());
      timer = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    };
    timer = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

export function LockClock({
  nyTime, phase, phaseLabel, glowRef,
}: {
  /** NY time «HH:MM». */
  nyTime: string;
  phase: MarketPhase;
  phaseLabel: string;
  glowRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = lockI18n.useT();
  const now = useNow();
  return (
    <div
      className="relative flex flex-col items-center text-center"
      style={{ transform: "translate3d(calc(var(--dx, 0) * 18px), calc(var(--dy, 0) * 12px), 0)" }}
    >
      {/* A still dark halo keeps the type readable over the brightest photo; the light one above it breathes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[160%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(0,0,0,0.42), rgba(0,0,0,0.2) 60%, transparent 80%)", filter: "blur(28px)" }}
      />
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[150%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.1), rgba(255,255,255,0.03) 55%, transparent 75%)", filter: "blur(24px)" }}
      />
      <p className="relative text-[clamp(0.7rem,1.1vw,0.85rem)] font-medium uppercase tracking-[0.32em] text-white/65">
        {fmtDate(now, "weekdayDayMonthLong")}
      </p>
      <time
        dateTime={now.toISOString()}
        className="relative mt-1 font-normal italic leading-[0.95] text-white tabular-nums [font-variant-numeric:lining-nums]"
        style={{ fontFamily: SERIF, fontSize: "clamp(5rem, 16vw, 13rem)", letterSpacing: "-0.02em", textShadow: "0 0 48px rgba(0,0,0,0.45), 0 0 2px rgba(0,0,0,0.3)" }}
      >
        {fmtDate(now, "time")}
      </time>
      <p className="relative mt-4 flex items-center gap-2 text-[clamp(0.8rem,1.2vw,0.95rem)] text-white/75 tabular-nums">
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full shadow-[0_0_10px_currentColor]", PHASE_DOT[phase])} />
        {t("screen.marketPhase", { time: nyTime, phase: phaseLabel })}
      </p>
    </div>
  );
}
