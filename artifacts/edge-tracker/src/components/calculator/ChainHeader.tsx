/**
 * Top of the chain tab: ticker → load, the underlying price, the expiration chips (nearest first, days to expiry)
 * and — once, in the panel description — where the quotes come from and their delay.
 */
import { useRef } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { useScrollActiveIntoView } from "@/components/ds/scroll-active";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDeskDate, fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { calculatorI18n } from "@/i18n/ns/calculator";
import { commonI18n } from "@/i18n/ns/common";
import { DEFAULT_DELAY_MIN, SOURCE_LABEL } from "./chainApi";
import type { OptionsChainState } from "./useOptionsChain";
import type { Expiration } from "./strategies";

export default function ChainHeader({ oc, atmIv }: { oc: OptionsChainState; atmIv: number | null }) {
  const { t } = calculatorI18n.useT();
  const { meta } = oc;
  const description = meta?.source
    ? t("advisor.sourceLine", { source: SOURCE_LABEL[meta.source], minutes: meta.delayMinutes ?? DEFAULT_DELAY_MIN })
    : t("advisor.chainSource");
  return (
    <Panel title={t("advisor.chainTitle")} icon={Search} description={description}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5 sm:w-80">
            <Label htmlFor="chain-ticker" className="text-xs font-normal text-muted-foreground">{t("shared.ticker")}</Label>
            <div className="flex gap-2">
              <Input id="chain-ticker" autoComplete="off" value={oc.ticker} placeholder="AAPL, SPY, QQQ…" className="h-9 uppercase"
                onChange={(e) => oc.setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") oc.load(); }} />
              <Button type="button" className="shrink-0" onClick={() => oc.load()} disabled={oc.loading || !oc.ticker.trim()}>
                {oc.loading ? <RefreshCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search aria-hidden="true" />} {t("advisor.load")}
              </Button>
            </div>
          </div>
          <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm" aria-live="polite">
            {meta && meta.price > 0 && (
              <>
                <span className="font-semibold">{meta.symbol}</span>
                <span className="font-semibold tabular-nums">{fmtUsd(meta.price)}</span>
                {meta.changePct != null && <Pill tone={meta.changePct >= 0 ? "up" : "down"}>{fmtPct(meta.changePct, 2)}</Pill>}
                {meta.name && meta.name !== meta.symbol && <span className="truncate text-xs text-muted-foreground">{meta.name}</span>}
              </>
            )}
            {oc.chainLoading && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("advisor.loadingChain")}</span>}
            {oc.chain && !oc.chainLoading && atmIv != null && <Pill tone="purple">ATM IV {fmtNum(atmIv, 0)}%</Pill>}
          </div>
        </div>
        {oc.expirations.length > 0 && (
          <ExpirationChips expirations={oc.expirations} selected={oc.selectedExp} onSelect={oc.selectExp} />
        )}
        {oc.error && (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-down">
            <span className="flex min-w-0 items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{oc.error}</span>
            {oc.ticker.trim() && (
              <Button type="button" variant="ghost" size="sm" onClick={() => oc.load()} disabled={oc.loading || oc.chainLoading}>
                <RefreshCw aria-hidden="true" /> {commonI18n.t("actions.retry")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** One horizontal row of dates, nearest first; scrolls sideways on a phone and keeps the chosen chip in view. */
function ExpirationChips({ expirations, selected, onSelect }: { expirations: Expiration[]; selected: string; onSelect: (label: string) => void }) {
  const { t } = calculatorI18n.useT();
  const ref = useRef<HTMLDivElement>(null);
  useScrollActiveIntoView(ref, selected);
  return (
    <div className="flex flex-col gap-1.5">
      <span id="chain-exp-label" className="text-xs text-muted-foreground">{t("advisor.expiration")}</span>
      <div ref={ref} role="group" aria-labelledby="chain-exp-label" className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {expirations.map((e) => (
          <button key={e.label} type="button" aria-pressed={selected === e.label} onClick={() => onSelect(e.label)}
            title={e.label}
            className="chip flex min-h-11 shrink-0 flex-col items-center justify-center px-3 py-1 leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <span className="text-sm font-medium tabular-nums">{fmtDeskDate(e.label)}</span>
            <span className="text-2xs tabular-nums opacity-80">{e.dte <= 0 ? t("ladder.today") : t("shared.dayChip", { count: e.dte })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
