/**
 * Brief card at the start of an intraday game: what a trader checks before the open — the gap vs the previous close,
 * PDH / PDL / PMH / PML, ATR — and the daily picture (60 days + today). Over the chart for ~5 s or until any key / tap
 * (the game screen swallows that first key). Numbers only, no ticker (still hidden).
 */
import * as React from "react";
import { X } from "lucide-react";
import type { Candle } from "@/components/chart-engine";
import { Button } from "@/components/ui/button";
import { fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import type { GameContext } from "./api";
import { DailyMini } from "./daily-panel";

export const BRIEF_MS = 5000;

export function BriefCard({ levels, daily, today, onClose }: { levels: GameContext["levels"]; daily: readonly Candle[]; today: Candle | null; onClose: () => void }) {
  const { t } = simI18n.useT();
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const id = window.setTimeout(() => close.current(), BRIEF_MS);
    return () => window.clearTimeout(id);
  }, []);
  const gap = levels.gapPct;
  const rows: [string, number | null][] = [["PDH", levels.pdh], ["PDL", levels.pdl], ["PMH", levels.pmh], ["PML", levels.pml]];
  return (
    <div
      className="absolute inset-0 z-sticky flex items-center justify-center bg-background/55 p-3 backdrop-blur-[2px]"
      onPointerDown={(e) => { e.preventDefault(); onClose(); }}
      role="dialog" aria-modal="false" aria-label={t("brief.title")} data-testid="sim-brief"
    >
      <div className="glass-panel relative w-full max-w-sm overflow-hidden rounded-2xl p-4 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold">{t("brief.title")}</p>
          <Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-2 h-8 w-8" aria-label={t("brief.start")} onClick={onClose}><X aria-hidden="true" /></Button>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">{t("brief.gap")}</span>
          <span className={cn("text-2xl font-semibold tabular-nums", gap == null || Math.abs(gap) < 0.05 ? "text-foreground" : gap > 0 ? "text-up" : "text-down")}>
            {gap == null ? "—" : Math.abs(gap) < 0.05 ? t("brief.noGap") : fmtPct(gap, { decimals: 1 })}
          </span>
          {gap != null && Math.abs(gap) >= 0.05 && <span className="text-xs text-muted-foreground">{t("brief.gapVs")}</span>}
        </div>
        <dl className="mt-3 grid grid-cols-5 gap-2 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0"><dt className="text-2xs text-muted-foreground">{k}</dt><dd className="truncate tabular-nums">{v != null ? fmtPrice(v) : "—"}</dd></div>
          ))}
          <div className="min-w-0"><dt className="text-2xs text-muted-foreground">{t("brief.atr")}</dt><dd className="truncate tabular-nums">{levels.atr14 != null ? fmtPrice(levels.atr14) : "—"}</dd></div>
        </dl>
        {daily.length > 0 && (
          <div className="mt-3 h-24 rounded-lg bg-[var(--glass-bg)] p-1">
            <DailyMini daily={daily} today={today} levels={levels} label={simI18n.t("daily.title")} />
          </div>
        )}
        <p className="mt-3 text-2xs text-muted-foreground">{t("brief.dismiss")}</p>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--glass-bg)]" aria-hidden="true">
          <div className="h-full origin-left bg-primary motion-safe:animate-[sim-brief_5s_linear_forwards]" />
        </div>
        <style>{"@keyframes sim-brief{from{transform:scaleX(1)}to{transform:scaleX(0)}}"}</style>
      </div>
    </div>
  );
}
