/** Advisor building blocks: a recommended-strategy card and the ATM scenario table (used by ChainAdvisor). */
import { useState } from "react";
import { Calculator, ChevronDown, Layers } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { calculatorI18n } from "@/i18n/ns/calculator";
import { fmtStrike } from "./lib";
import { fsFind, type AdvisorGoal, type ChainData, type Strategy } from "./strategies";

export function StrategyCard({ s, spot, top, onUseInBs, onToBuilder }: {
  s: Strategy; spot: number; top: boolean; onUseInBs: (s: Strategy) => void; onToBuilder: (s: Strategy) => void;
}) {
  const { t, tryT } = calculatorI18n.useT();
  const [open, setOpen] = useState(top);
  const isDebit = s.netDebit >= 0;
  const scoreTone = s.score >= 70 ? "up" : s.score >= 45 ? "warn" : "neutral";
  const detailsId = `strat-${s.id}`;
  return (
    <article className={cn("glass-panel flex flex-col rounded-2xl", top && "ring-1 ring-primary/60")}>
      <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}
        className="flex flex-col gap-3 rounded-2xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{s.name}</span>
              {top && <Pill tone="accent">{t("advisor.best")}</Pill>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Pill tone={isDebit ? "neutral" : "up"}>{isDebit ? t("advisor.debitPerContract", { amount: fmtUsd(s.netDebit * 100, { decimals: 0 }) }) : t("advisor.creditPerContract", { amount: fmtUsd(Math.abs(s.netDebit) * 100, { decimals: 0 }) })}</Pill>
              <Pill tone={s.ivSensitivity === "positive" ? "purple" : s.ivSensitivity === "negative" ? "warn" : "neutral"}>
                Vega {s.ivSensitivity === "positive" ? "+" : s.ivSensitivity === "negative" ? "−" : "≈0"}
              </Pill>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Pill tone={scoreTone}><span className="sr-only">{t("advisor.score")} </span>{s.score}</Pill>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><div className="text-2xs text-muted-foreground">{t("shared.maxProfit")}</div><div className="text-sm font-semibold tabular-nums text-up">{s.maxProfit === null ? "∞" : fmtUsd(s.maxProfit, { decimals: 0 })}</div></div>
          <div><div className="text-2xs text-muted-foreground">{t("shared.maxLoss")}</div><div className="text-sm font-semibold tabular-nums text-down">{s.maxLoss === null ? "∞" : fmtUsd(-s.maxLoss, { signed: true, decimals: 0 })}</div></div>
          <div><div className="text-2xs text-muted-foreground">{t("advisor.probProfitShort")}</div><div className="text-sm font-semibold tabular-nums text-primary">{s.probProfit !== null ? `${fmtNum(s.probProfit, 0)}%` : "—"}</div></div>
        </div>
      </button>
      {open && (
        <div id={detailsId} className="flex flex-col gap-3 border-t border-border/60 px-4 pb-4 pt-3">
          <ul className="flex flex-col gap-1">
            {s.legs.map((l, i) => (
              <li key={i} className="flex items-center gap-2 text-sm tabular-nums">
                <Pill tone={l.action === "buy" ? "up" : "down"}>{l.action === "buy" ? "Buy" : "Sell"}</Pill>
                <span className={l.optType === "call" ? "text-up" : "text-down"}>{l.optType === "call" ? "Call" : "Put"}</span>
                <span className="font-semibold">{fmtStrike(l.strike)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{t("shared.perShareSuffix", { price: fmtUsd(l.premium) })}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="text-xs text-muted-foreground">{t("advisor.breakevensLabel", { count: s.breakevens.length })}</span>
            {s.breakevens.map((be, i) => (
              <span key={i} className="tabular-nums">
                <span className="font-medium text-primary">{fmtUsd(be)}</span>
                <span className="text-xs text-muted-foreground"> ({fmtPct(((be - spot) / spot) * 100, 1)})</span>
              </span>
            ))}
            {s.riskReward !== null && <span className="ml-auto text-xs text-muted-foreground">R:R <span className="font-medium text-foreground">{fmtNum(s.riskReward, 2)}</span></span>}
          </div>
          <p className="rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-sm text-muted-foreground">{tryT(`strategies.${s.id}.summary`, s.summaryParams)}</p>
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{t("advisor.bestWhen")} </span>{t(`strategies.${s.id}.bestWhen`)}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onToBuilder(s)}><Layers aria-hidden="true" /> {t("shared.toBuilder")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onUseInBs(s)}><Calculator aria-hidden="true" /> {t("advisor.firstLegToBs")}</Button>
          </div>
        </div>
      )}
    </article>
  );
}

export function ScenarioTable({ chain, goal }: { chain: ChainData; goal: AdvisorGoal }) {
  const { t } = calculatorI18n.useT();
  const steps = [-20, -10, -5, 0, 5, 10, 20];
  const atmC = fsFind(chain.calls, chain.spot);
  const atmP = fsFind(chain.puts, chain.spot);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">{t("advisor.atmCaption")}</caption>
        <thead>
          <tr className="border-b border-border/60 text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-2 text-left font-normal">{t("shared.move")}</th>
            <th scope="col" className="px-2 py-2 text-right font-normal">{t("shared.price")}</th>
            <th scope="col" className="px-2 py-2 text-right font-normal">Call {atmC ? fmtStrike(atmC.strike) : ""}</th>
            <th scope="col" className="py-2 pl-2 text-right font-normal">Put {atmP ? fmtStrike(atmP.strike) : ""}</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((pct) => {
            const x = chain.spot * (1 + pct / 100);
            const callPnl = atmC ? (Math.max(0, x - atmC.strike) - atmC.mid) * 100 : 0;
            const putPnl = atmP ? (Math.max(0, atmP.strike - x) - atmP.mid) * 100 : 0;
            const highlight = (goal === "bullish" && pct > 0) || (goal === "bearish" && pct < 0) || (goal === "big_move" && Math.abs(pct) >= 10);
            return (
              <tr key={pct} className={cn("border-b border-border/40 last:border-0", highlight && "bg-primary/5")}>
                <td className={cn("py-1.5 pr-2", pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-muted-foreground")}>{fmtPct(pct, 0)}</td>
                <td className="px-2 py-1.5 text-right">{fmtUsd(x)}</td>
                <td className={cn("px-2 py-1.5 text-right font-medium", callPnl >= 0 ? "text-up" : "text-down")}>{fmtUsd(callPnl, { signed: true, decimals: 0 })}</td>
                <td className={cn("py-1.5 pl-2 text-right font-medium", putPnl >= 0 ? "text-up" : "text-down")}>{fmtUsd(putPnl, { signed: true, decimals: 0 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
