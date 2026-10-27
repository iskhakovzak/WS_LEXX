/**
 * Fee-aware coaching UI (roadmap R2): the weekly «Комиссии» card (task-framed: what costs money + one rule to test)
 * and the «Винрейт и безубыточный» line (win rate vs the breakeven win rate of the trader's own payoff), shown in the
 * weekly review and on the dashboard. Data: weekly-review `feeCoaching`, GET /api/edge/breakeven.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Receipt, Scale } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { fmtNum, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { coachI18n } from "@/i18n/ns/coach";
import { feeCardOf, priceRuleHref, type EdgeMargin, type FeeCoaching } from "./fee-coaching-model";

const pct = (v: number) => `${fmtNum(v, { decimals: 1 })}%`;

/** The weekly fee card; renders nothing when fees are not a problem. */
export function FeeCoachingCard({ data, trader, className }: { data: FeeCoaching | null | undefined; trader?: string | null; className?: string }) {
  const { t } = coachI18n.useT();
  const card = feeCardOf(data);
  if (!card) return null;
  const head = card.share != null
    ? t("fees.share", { pct: `${Math.round(card.share * 100)}%`, days: card.days })
    : t("fees.noGross", { fees: fmtUsd(card.fees, { decimals: 0 }), gross: fmtUsd(card.gross, { decimals: 0, signed: true }), days: card.days });
  return (
    <Panel title={t("fees.title")} icon={Receipt} className={cn("min-w-0", className)}>
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-foreground">{head}</p>
        {card.band && (
          <p className="text-foreground">
            {card.band.loses ? t("fees.bandLoses", { band: card.band.label }) : t("fees.bandThin", { band: card.band.label, ratio: fmtNum(card.band.ratio, { decimals: 1 }) })}
          </p>
        )}
        {card.minPrice != null && (
          <div>
            <Button asChild variant="outline" size="sm" title={t("fees.actionTitle", { min: card.minPrice })}>
              <Link href={priceRuleHref(card.minPrice, trader)}><FlaskConical aria-hidden="true" /> {t("fees.action", { min: card.minPrice })}</Link>
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** One line: win rate · breakeven · margin; the hint explains it with the trader's own numbers. */
export function BreakevenLine({ breakeven, days, className }: { breakeven: EdgeMargin | null | undefined; days: number; className?: string }) {
  const { t } = coachI18n.useT();
  if (!breakeven) return <p className={cn("text-xs text-muted-foreground", className)}>{t("breakeven.few", { days })}</p>;
  const b = breakeven;
  return (
    <p
      className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}
      title={t("breakeven.hint", { avgWin: fmtUsd(b.avgWin), avgLoss: fmtUsd(b.avgLoss), be: pct(b.breakevenWr), days })}
    >
      <Scale className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("breakeven.title")}: </span>
      <span>
        {t("breakeven.line", { wr: pct(b.winRate), be: pct(b.breakevenWr), margin: `${b.marginPp > 0 ? "+" : b.marginPp < 0 ? "−" : ""}${fmtNum(Math.abs(b.marginPp), { decimals: 1 })}` })}
      </span>
    </p>
  );
}

type BreakevenResponse = { scope: string | null; window: { from: string | null; to: string; days: number } | null; breakeven: EdgeMargin | null };

/** The viewer's own breakeven line (dashboard). */
export function OwnBreakevenLine({ className }: { className?: string }) {
  const q = useQuery({
    queryKey: ["/api/edge/breakeven"],
    queryFn: ({ signal }) => http.get<BreakevenResponse>("/api/edge/breakeven", { signal }),
    staleTime: STALE.default,
  });
  if (!q.data?.window) return null;
  return <BreakevenLine breakeven={q.data.breakeven} days={q.data.window.days} className={className} />;
}
