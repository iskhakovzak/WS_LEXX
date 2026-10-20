/**
 * Market breadth of the active board in its active column, one line above the table: «▲ 29 · ▼ 10», a thin up / down
 * proportion bar and the median move. Nothing when the column has no values.
 */
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { toneOf, toneText } from "@/components/ds";
import type { Breadth, BoardColumn } from "./model";

export function BreadthStrip({ b, col, className }: { b: Breadth; col: BoardColumn; className?: string }) {
  const { t } = themesI18n.useT();
  if (!b.total) return null;
  const pct = (n: number) => `${((n / b.total) * 100).toFixed(1)}%`;
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-xs tabular-nums", className)} aria-label={t("breadth.aria", { col: t(`cols.${col}`), up: b.up, down: b.down })}>
      <span className="shrink-0 text-muted-foreground">{t(`cols.${col}`)}</span>
      <span className="shrink-0 font-medium text-up">▲ {b.up}</span>
      <span className="shrink-0 text-muted-foreground">·</span>
      <span className="shrink-0 font-medium text-down">▼ {b.down}</span>
      <span className="flex h-1.5 min-w-12 max-w-48 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="h-full bg-up/80" style={{ width: pct(b.up) }} />
        <span className="h-full bg-muted-foreground/30" style={{ width: pct(b.flat) }} />
        <span className="h-full bg-down/80" style={{ width: pct(b.down) }} />
      </span>
      {b.median != null && (
        <span className="shrink-0 text-muted-foreground">
          {t("breadth.median")} <span className={toneText(toneOf(b.median))}>{fmtPct(b.median)}</span>
        </span>
      )}
    </div>
  );
}
