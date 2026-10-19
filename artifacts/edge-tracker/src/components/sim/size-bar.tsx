/**
 * Size in bases: four always-visible buttons ½ · 1 · 2 · 3 (base = the game's defaultQty ≈ a $10k position) and one
 * line saying what the size is — «2 базы = 340 акций · $8,500». With «размер по риску» on the server sizes the entry
 * from 1R and the stop, so the buttons step back and the line shows the R preview instead. Shift+1..4 are the keys.
 */
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import { BASE_MULTS, baseQty, multOf } from "./model";

const noFocus = (e: React.PointerEvent) => e.preventDefault();
const MULT_LABEL: Record<number, string> = { 0.5: "½", 1: "1", 2: "2", 3: "3" };

export function SizeBar({
  base, qty, setQty, price, risk, compact = false, keys = false,
}: {
  base: number;
  qty: number;
  setQty: (q: number) => void;
  price: number;
  /** «Размер по риску» on: the R preview (shares null = no usable stop yet). */
  risk?: { oneR: number; shares: number | null } | null;
  /** Phone row under the chart: no summary line wrap, smaller buttons. */
  compact?: boolean;
  /** Show Shift+N on the buttons' tooltips. */
  keys?: boolean;
}) {
  const { t } = simI18n.useT();
  const active = multOf(qty, base);
  const basesText = (m: number) => (m === 0.5 ? t("size.basesHalf") : t("size.bases", { count: m }));
  const sharesText = (n: number) => t("size.shares", { count: n });
  const summary = risk
    ? risk.shares != null ? t("size.riskOn", { oneR: fmtUsd(risk.oneR, { decimals: 0 }), shares: sharesText(risk.shares) }) : t("size.riskNoStop")
    : active != null
      ? t("size.summary", { bases: basesText(active), shares: sharesText(qty), usd: fmtUsd(qty * price, { decimals: 0 }) })
      : t("size.custom", { shares: sharesText(qty), usd: fmtUsd(qty * price, { decimals: 0 }) });
  return (
    <div className={cn("flex min-w-0 items-center gap-2", compact ? "" : "flex-wrap")}>
      <div role="group" aria-label={t("size.label")} title={t("size.baseHint", { shares: sharesText(base) })} className="flex shrink-0 gap-1">
        {BASE_MULTS.map((m, i) => (
          <Button
            key={m} type="button" size="sm" onPointerDown={noFocus}
            variant={!risk && active === m ? "default" : "outline"}
            disabled={!!risk}
            aria-pressed={!risk && active === m}
            aria-label={basesText(m)}
            aria-keyshortcuts={`Shift+${i + 1}`}
            title={keys ? `${basesText(m)} (Shift+${i + 1})` : basesText(m)}
            className={cn("px-0 tabular-nums", compact ? "h-9 w-9" : "h-8 w-9")}
            onClick={() => setQty(baseQty(base, m))}
          >
            {MULT_LABEL[m]}
          </Button>
        ))}
      </div>
      <span className={cn("min-w-0 text-xs tabular-nums text-muted-foreground", compact ? "truncate" : "")} aria-live="polite" data-testid="sim-size-summary">{summary}</span>
    </div>
  );
}
