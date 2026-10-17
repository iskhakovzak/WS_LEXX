/**
 * Header market clock pill: NY time, US equities session state with a coloured dot, and a live
 * countdown to the next transition (премаркет 4:00 → основная 9:30 → постмаркет 16:00 → закрыто 20:00).
 * Weekends and full-day US market holidays (from /api/holidays) count as closed.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getSessionState, formatCountdown, type SessionPhase } from "@/components/dashboard/market-session";

const PREMARKET_TO_OPEN_MS = 5.5 * 3600 * 1000;

type Holiday = { date: string; name: string };

function isoPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Full-day market holidays for the next few weeks. Cheap, cached for hours, silent on failure. */
export function useMarketHolidays(): Holiday[] {
  const from = isoPlus(-1);
  const { data } = useQuery<Holiday[]>({
    queryKey: ["market-holidays", from],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/holidays?from=${from}&to=${isoPlus(30)}&types=holiday`);
      if (!r.ok) return [];
      const j = await r.json();
      const rows: any[] = Array.isArray(j?.events) ? j.events : [];
      return rows
        .filter((e) => String(e?.type ?? "").toLowerCase() === "holiday")
        .map((e) => ({ date: String(e.date).slice(0, 10), name: String(e.name ?? "Выходной биржи") }));
    },
    staleTime: 6 * 3600_000,
    gcTime: 12 * 3600_000,
    retry: false,
  });
  return data ?? [];
}

const PHASE: Record<SessionPhase, { label: string; short: string; dot: string; text: string }> = {
  pre: { label: "Премаркет", short: "Пре", dot: "bg-warn", text: "text-warn" },
  regular: { label: "Основная", short: "Осн", dot: "bg-up", text: "text-up" },
  after: { label: "Постмаркет", short: "Пост", dot: "bg-purple", text: "text-purple" },
  closed: { label: "Закрыто", short: "Закр", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/** Ticking session state (1 s). Exported so pages can share the same clock logic. */
export function useMarketClock() {
  const holidays = useMarketHolidays();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    const s = getSessionState(now, holidays);
    // When closed, the next transition is the premarket start (always 5.5 h before the open).
    let msToNext = s.msToNext;
    let nextLabel = s.nextLabel;
    if (s.phase === "closed" && msToNext > PREMARKET_TO_OPEN_MS) {
      msToNext -= PREMARKET_TO_OPEN_MS;
      nextLabel = "до премаркета";
    }
    return { ...s, msToNext, nextLabel };
  }, [now, holidays]);
}

export function MarketClock({ className }: { className?: string }) {
  const s = useMarketClock();
  const ph = PHASE[s.phase];
  const reason = s.phase === "closed" ? (s.holiday ? s.holiday : s.weekend ? "выходные" : null) : null;
  const hm = s.nyTime.slice(0, 5);
  const countdown = formatCountdown(s.msToNext);
  const local = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="timer"
          aria-live="off"
          aria-label={`Нью-Йорк ${hm}. ${ph.label}${reason ? ` (${reason})` : ""}. ${s.nextLabel} ${countdown}`}
          tabIndex={0}
          className={cn(
            "glass-field inline-flex h-10 min-w-0 items-center gap-2 px-3 text-xs tabular-nums text-muted-foreground",
            className,
          )}
        >
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            {s.phase === "regular" && (
              <span className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", ph.dot)} />
            )}
            <span className={cn("relative h-2 w-2 rounded-full", ph.dot)} />
          </span>
          <span className="font-semibold text-foreground">
            <span className="hidden text-muted-foreground sm:inline">NY </span>
            {hm}
            <span className="hidden text-muted-foreground lg:inline">{s.nyTime.slice(5)}</span>
          </span>
          <span className={cn("hidden font-medium md:inline", ph.text)}>{ph.label}</span>
          <span className={cn("font-medium md:hidden", ph.text)}>{ph.short}</span>
          <span className="hidden h-3.5 w-px bg-[var(--field-border)] sm:block" aria-hidden="true" />
          <span className="hidden whitespace-nowrap sm:inline">
            <span className="hidden 2xl:inline">{s.nextLabel} </span>
            <span className="text-foreground">{countdown}</span>
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <div className="font-medium">
          {ph.label}{reason ? ` · ${reason}` : ""}
        </div>
        <div className="text-muted-foreground">
          {s.nextLabel}: {countdown}
        </div>
        <div className="text-muted-foreground">
          Нью-Йорк {s.nyTime} · у вас {local}
        </div>
        <div className="mt-1 text-muted-foreground">Пре 4:00–9:30 · основная 9:30–16:00 · пост до 20:00 ET</div>
      </TooltipContent>
    </Tooltip>
  );
}
