/**
 * The NY day map: premarket / open 9:30–10:30 / trend 10:30–15:00 / close 15:00–16:00 as one bar with «now» marked.
 * Segments grow with their length (a floor keeps the short ones readable); a segment jumps to its window's setups.
 */
import type { DayWindow } from "@/lib/playbook-today/types";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { hm, hmText, minutesToOpen, nowMarker, windowPhases } from "./today-model";
import { windowLabel } from "./today-text";

export function DayMap({ windows, now, onPick }: { windows: DayWindow[]; now: number; onPick?: (key: DayWindow["key"]) => void }) {
  const { t } = playbookTodayI18n.useT();
  const phases = windowPhases(windows, now);
  const marker = nowMarker(windows, now);
  const toOpen = minutesToOpen(windows, now);
  const status =
    marker?.state === "after" ? t("dayMap.closed", { time: hmText(now) })
    : toOpen != null ? t("dayMap.toOpen", { time: toOpen >= 60 ? `${Math.floor(toOpen / 60)}:${String(toOpen % 60).padStart(2, "0")}` : commonI18n.t("units.minutes", { count: toOpen }) })
    : t("dayMap.now", { time: hmText(now) });
  return (
    <section aria-label={t("dayMap.aria")} className="glass-panel min-w-0 rounded-2xl p-[var(--panel-p)]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-[15px] font-semibold text-foreground">{t("dayMap.title")}</h3>
        <span role="status" className="rounded-full bg-primary/12 px-2.5 py-1 text-sm font-semibold tabular-nums text-accent-soft">{status}</span>
      </div>
      <ol className="mt-3 grid min-w-0 grid-cols-2 gap-1 sm:flex">
        {windows.map((w) => {
          const phase = phases[w.key];
          // The premarket counts as one hour: the bar is about the session, not the 04:00 start.
          const len = w.key === "premarket" ? 60 : Math.max(30, (hm(w.to) ?? 0) - (hm(w.from) ?? 0));
          const here = marker && marker.key === w.key && marker.state === "in";
          return (
            <li key={w.key} className="relative min-w-0 sm:min-w-[17%]" style={{ flexGrow: len, flexBasis: 0 }}>
              <button
                type="button"
                onClick={() => onPick?.(w.key)}
                aria-current={phase === "now" ? "time" : undefined}
                className={cn(
                  "flex h-full w-full flex-col items-start gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  phase === "now" ? "border-primary/60 bg-primary/12" : phase === "next" ? "border-primary/30 bg-[var(--glass-bg)]" : "border-[var(--glass-border)] bg-[var(--glass-bg)]",
                  phase === "past" && "opacity-60",
                  "hover:bg-[var(--glass-hover-bg)]",
                )}
              >
                <span className="w-full text-sm font-semibold leading-tight text-foreground [overflow-wrap:anywhere]">{windowLabel(w.key)}</span>
                <span className="w-full text-xs tabular-nums text-foreground/70">{t("dayMap.range", { from: w.from, to: w.to })}</span>
              </button>
              {here && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 rounded-full bg-primary shadow-[0_0_0_2px_hsl(var(--background))]"
                  style={{ left: `${Math.round(marker.frac * 100)}%` }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
