/**
 * The sign-in page's clock, a calmer sibling of the lock screen's: the date, the local time in the app's italic serif
 * and New York time with the US session phase. It drifts with the page's --dx / --dy (hooks/use-ambient-drift), a
 * little less than the lock clock. No trading data (nobody is signed in).
 */
import * as React from "react";
import { authI18n } from "@/i18n/ns/auth";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type SessionKey = "weekend" | "premarket" | "regular" | "postmarket" | "closed";
const SESSION_DOT: Record<SessionKey, string> = {
  weekend: "bg-muted-foreground/60", premarket: "bg-warn", regular: "bg-up", postmarket: "bg-purple", closed: "bg-muted-foreground/60",
};

function nyParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), h: Number(get("hour")) % 24, m: Number(get("minute")) };
}

export function sessionOf(weekday: string, h: number, m: number): SessionKey {
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  const t = h * 60 + m;
  if (t >= 4 * 60 && t < 9 * 60 + 30) return "premarket";
  if (t >= 9 * 60 + 30 && t < 16 * 60) return "regular";
  if (t >= 16 * 60 && t < 20 * 60) return "postmarket";
  return "closed";
}

/** Ticks on the second boundary, so the minute flips exactly on time. */
function useNow(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    let timer = 0;
    const loop = () => { setNow(new Date()); timer = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5); };
    timer = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

export const LoginClock = React.forwardRef<HTMLDivElement, { className?: string; style?: React.CSSProperties }>(function LoginClock({ className, style }, ref) {
  const { t } = authI18n.useT();
  const now = useNow();
  const { weekday, h, m } = nyParts(now);
  const session = sessionOf(weekday, h, m);
  return (
    <div ref={ref} className={cn("flex flex-col items-center text-center", className)} style={style}>
      <div className="flex flex-col items-center" style={{ transform: "translate3d(calc(var(--dx, 0) * 10px), calc(var(--dy, 0) * 6px), 0)" }}>
        <p className="text-xs font-medium text-foreground/70">{fmtDate(now, "weekdayDayMonthLong")}</p>
        <time
          dateTime={now.toISOString()}
          className="mt-0.5 font-normal italic leading-[0.95] text-foreground tabular-nums [font-variant-numeric:lining-nums]"
          style={{ fontFamily: "var(--app-font-serif)", fontSize: "clamp(3rem, min(11vw, 10vh), 5.75rem)", letterSpacing: "-0.02em", textShadow: "0 0 36px hsl(var(--background) / 0.55)" }}
        >
          {fmtDate(now, "time")}
        </time>
        <p className="mt-2 flex items-center gap-2 text-xs text-foreground/75 tabular-nums">
          <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor]", SESSION_DOT[session])} />
          {t("clock.ny", { time: `${pad(h)}:${pad(m)}`, phase: t(`clock.${session}`) })}
        </p>
      </div>
    </div>
  );
});
