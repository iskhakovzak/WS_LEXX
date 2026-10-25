/**
 * Top of the trade sheet: the hero (net P&L and R large in the result colour, setup / event / session chips, the
 * chart with its Entry / Exit markers right away) and the key facts row (entry, exit, size, hold, MAE / MFE, fees).
 * Values owned by other features (hold and session labels, MAE / MFE, the redacted hint) come in as props.
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtCount, fmtPrice, fmtR, fmtUsd } from "@/lib/format";
import { tradesI18n } from "@/i18n/ns/trades";
import { commonI18n } from "@/i18n/ns/common";
import { daysHeld, effectiveR, eventLabel, netPnl, resultKey, sessionLabel } from "./trade-utils";
import { feeShareText, stopIsEstimate } from "./sheet-model";
import { SheetChart } from "./SheetChart";

/** Result-coloured wash behind the hero (figure on the sheet's ground). Literal classes for Tailwind. */
const HERO_WASH = { up: "from-up/10", down: "from-down/10", neutral: "from-[var(--glass-bg)]" } as const;

export function SheetHero({ trade: t, ideaTarget, chartHeight, exitOutside, redactedText }: {
  trade: Trade;
  ideaTarget: string | null;
  chartHeight: number;
  /** «выход в постмаркете» when the position closed outside the session it opened in. */
  exitOutside: string | null;
  /** Hint for $ hidden on another trader's trade. */
  redactedText?: string;
}) {
  const { t: tt } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const net = netPnl(t);
  const r = effectiveR(t);
  const tone = net == null ? "neutral" : toneOf(net);
  const wash = tone === "up" || tone === "down" ? HERO_WASH[tone] : HERO_WASH.neutral;
  const perShare = t.pnl != null && t.qty ? t.pnl / t.qty : null;
  const rEstimate = stopIsEstimate(t) && r.derived;
  const rLabel = rEstimate ? tt("sheet.kpi.rEstimate") : r.derived ? tt("sheet.kpi.rDerived") : "R";
  const grossFees = t.fees && t.pnl != null
    ? tt("sheet.kpi.grossFees", { gross: fmtUsd(t.pnl, { signed: true, decimals: "auto" }), fees: fmtUsd(-Math.abs(t.fees), { signed: true, decimals: "auto" }) })
    : null;
  return (
    <section aria-label={tt("sheet.hero")} className={cn("-mx-2 space-y-3 rounded-2xl bg-gradient-to-b to-transparent px-2 py-3 sm:mx-0 sm:p-4", wash)}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <div className="min-w-0" title={redactedText ?? grossFees ?? undefined}>
          <p className="micro-label">{t.fees ? tc("trading.net") : "P&L"}</p>
          <p className={cn("text-4xl font-semibold leading-none tracking-tight tabular-nums sm:text-5xl", net == null ? "text-muted-foreground" : toneText(tone))}>
            {fmtUsd(net, { signed: true, decimals: "auto" })}
          </p>
        </div>
        {r.value != null ? (
          <div className="min-w-0" title={rEstimate ? tt("sheet.kpi.rEstimateHint") : undefined}>
            <p className="micro-label">{rLabel}</p>
            <p className={cn("text-2xl font-semibold leading-none tabular-nums sm:text-3xl", toneText(toneOf(r.value)))}>{fmtR(r.value)}</p>
          </div>
        ) : perShare != null && (
          <div className="min-w-0" title={redactedText ?? tt("sheet.kpi.perShareHint")}>
            <p className="micro-label">{tt("sheet.kpi.perShare")}</p>
            <p className={cn("text-2xl font-semibold leading-none tabular-nums sm:text-3xl", toneText(toneOf(perShare)))}>{fmtUsd(perShare, { signed: true })}</p>
          </div>
        )}
        {grossFees && <p className="w-full text-xs tabular-nums text-muted-foreground sm:ml-auto sm:w-auto sm:pb-1">{grossFees}</p>}
      </div>
      {(t.setup || t.eventType || t.session || exitOutside) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.setup && <Pill tone="accent" title={tc("trading.setup")}>{t.setup}</Pill>}
          {t.eventType && <Pill tone="purple" title={tt("sheet.context.event")}>{eventLabel(t.eventType)}</Pill>}
          {t.session && <Pill title={tc("trading.session")}>{sessionLabel(t.session, { full: true })}</Pill>}
          {exitOutside && <Pill tone="warn" title={tt("sheet.exitOutsideTitle")}>{exitOutside}</Pill>}
        </div>
      )}
      {/* The trade's own day with Entry / Exit markers; analysis / replay is a mode switch inside the chart. */}
      <SheetChart key={t.id} trade={t} ideaTarget={ideaTarget} height={chartHeight} showModes fallbackClassName="rounded-2xl" />
    </section>
  );
}

function Fact({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--glass-bg)] px-2.5 py-1.5" title={hint ?? (typeof value === "string" ? value : undefined)}>
      <p className="truncate text-2xs text-muted-foreground">{label}</p>
      <p className={cn("break-words text-sm font-semibold leading-snug tabular-nums", className)}>{value}</p>
    </div>
  );
}

export type ExcursionFacts = {
  mae: { text: string; adverse: boolean; explain: string } | null;
  mfe: { text: string; explain: string } | null;
};

/** Compact stat tiles under the hero. */
export function KeyFacts({ trade: t, holdText, excursions, redactedText }: {
  trade: Trade;
  /** Exact hold from the fills, else the broker's text, formatted. */
  holdText: string | null;
  excursions: ExcursionFacts;
  redactedText?: string;
}) {
  const { t: tt } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const open = resultKey(t.result) === "open";
  const held = daysHeld(t);
  const fees = t.fees ? feeShareText(Math.abs(t.fees), t.pnl) : null;
  const { mae, mfe } = excursions;
  const muted = "text-muted-foreground";
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(5.75rem,1fr))] gap-1.5" role="group" aria-label={tt("sheet.facts")}>
      <Fact label={tc("trading.entry")} value={fmtPrice(t.entry)} className={t.entry == null ? muted : undefined} />
      <Fact label={tc("trading.exit")} value={open && t.exit == null ? "…" : fmtPrice(t.exit)} className={t.exit == null ? muted : undefined} />
      <Fact label={tc("trading.size")} value={t.qty != null ? tc("units.shares", { count: fmtCount(t.qty) }) : "—"} className={t.qty == null ? muted : undefined} hint={redactedText} />
      {open && t.exit == null
        ? <Fact label={tc("trading.inPosition")} value={held != null ? tt("sheet.kpi.daysShort", { count: held }) : "—"} className="text-primary" />
        : <Fact label={tc("trading.holdTime")} value={holdText || t.holdTime || "—"} className={!holdText && !t.holdTime ? muted : undefined} />}
      {mae && <Fact label="MAE" value={mae.text} className={mae.adverse ? "text-down" : muted} hint={mae.explain} />}
      {mfe && <Fact label="MFE" value={mfe.text} className="text-up" hint={mfe.explain} />}
      {t.fees ? (
        <Fact
          label={tc("trading.fees")}
          value={fmtUsd(-Math.abs(t.fees), { signed: true, decimals: "auto" })}
          hint={redactedText ?? (fees ? tt("sheet.feesShare", { share: fees.text }) : undefined)}
        />
      ) : null}
    </div>
  );
}
