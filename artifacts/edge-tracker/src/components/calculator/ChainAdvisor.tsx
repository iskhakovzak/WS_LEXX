/**
 * Options chain tab: ticker + expiration chips (ChainHeader), the strike ladder to pick a contract in one tap
 * (StrikeLadder), the rule-based strategy advisor and the AI advisor. Data: Yahoo Finance, NASDAQ fallback, delayed.
 */
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, Layers, Shield, Star, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { EmptyState, Panel, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { STALE } from "@/lib/api/keys";
import { riskMeQuery } from "@/lib/api/queries";
import { num, toDeskLimits, usePersistedState, type RiskMeRaw } from "./lib";
import { fmtDeskDate, fmtUsd } from "@/lib/format";
import { Hint, NumField } from "./fields";
import { buildStrategies, fsFind, type AdvisorGoal, type ChainOption, type IvOutlook, type Strategy } from "./strategies";
import type { OpenInBuilderParams, PickContractParams, UseInBsParams } from "./handoff";
import { riskPerTradeUsd, useTradingDefaults } from "@/components/settings/trading-defaults";
import { calculatorI18n } from "@/i18n/ns/calculator";
import { withDerivedGreeks } from "./chainApi";
import { useOptionsChain } from "./useOptionsChain";
import ChainHeader from "./ChainHeader";
import StrikeLadder, { type OptSide, type PickedContract } from "./StrikeLadder";
import { ScenarioTable, StrategyCard } from "./AdvisorCards";
import AiAdvisor from "./AiAdvisor";

/** Goal codes + icons; labels come from `advisor.goals.<id>` at render. */
const GOALS: { id: AdvisorGoal; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "bullish", icon: TrendingUp },
  { id: "bearish", icon: TrendingDown },
  { id: "hedge_long", icon: Shield },
  { id: "hedge_short", icon: Shield },
  { id: "big_move", icon: Zap },
  { id: "neutral_sell", icon: Star },
];

const IV_OUTLOOKS: IvOutlook[] = ["expand", "neutral", "contract"];

/** Recommendation cards shown before the "more strategies" button (choice overload: the best few first). */
const TOP_STRATEGIES = 3;

export default function ChainAdvisor({
  onUseInBs,
  onOpenInBuilder,
  onPickContract,
  onUnderlying,
  builderLegCount,
  onShowBuilder,
  onShowBs,
  initialTicker,
}: {
  /** /calculator?ticker= — loaded right away. */
  initialTicker?: string;
  onUseInBs: (p: UseInBsParams) => void;
  onOpenInBuilder: (p: OpenInBuilderParams) => void;
  /** "Pick" in the ladder: prefill B-S and add a builder leg, staying on this tab. */
  onPickContract: (p: PickContractParams) => void;
  /** The loaded underlying price becomes the spot of B-S and the builder. */
  onUnderlying: (p: { symbol: string; spot: number }) => void;
  builderLegCount: number;
  onShowBuilder: () => void;
  onShowBs: () => void;
}) {
  const { t } = calculatorI18n.useT();
  const oc = useOptionsChain(initialTicker);
  const [showAllStrategies, setShowAllStrategies] = useState(false);

  const [goal, setGoal] = usePersistedState<AdvisorGoal>("advisor_goal", "bullish");
  const [maxRisk, setMaxRisk] = usePersistedState<string>("advisor_maxrisk", "500");
  // The trader's own 1R (Settings / Trading) seeds the per-contract cap once, never above the desk's
  // max risk per trade (/risk/me = hard cap). The trader can still type their own number.
  const deskQ = useQuery({ ...riskMeQuery<RiskMeRaw>(), select: toDeskLimits, retry: false, staleTime: STALE.short });
  const tradingDefaults = useTradingDefaults();
  const personalRisk = tradingDefaults.updatedAt ? riskPerTradeUsd(tradingDefaults) : null;
  const deskMaxRisk = deskQ.data?.maxRisk ?? null;
  const deskSeeded = useRef(false);
  useEffect(() => {
    if (deskSeeded.current || deskQ.isLoading) return;
    const seed = personalRisk != null && personalRisk > 0
      ? (deskMaxRisk != null ? Math.min(personalRisk, deskMaxRisk) : personalRisk)
      : deskMaxRisk;
    if (seed == null) return;
    deskSeeded.current = true;
    if (maxRisk === "500") setMaxRisk(String(Math.round(seed)));
  }, [deskQ.isLoading, deskMaxRisk, personalRisk, maxRisk, setMaxRisk]);
  const [ivOutlook, setIvOutlook] = usePersistedState<IvOutlook>("advisor_iv", "neutral");
  const [nContracts, setNContracts] = usePersistedState<string>("advisor_contracts", "1");
  const [rateStr, setRateStr] = usePersistedState<string>("advisor_rate", "4.5");

  const riskFree = Number.isFinite(num(rateStr)) ? num(rateStr) : 4.5;
  const contractsN = Math.max(1, Math.floor(num(nContracts) || 1));

  // Yahoo sends IV + greeks; NASDAQ (fallback) and dead Yahoo strikes get them derived from the mid price.
  const chain = useMemo(() => (oc.chain ? withDerivedGreeks(oc.chain, riskFree) : null), [oc.chain, riskFree]);

  // The loaded underlying price prefills the spot of B-S and the builder (once per symbol / price).
  const meta = oc.meta;
  const onUnderlyingRef = useRef(onUnderlying);
  onUnderlyingRef.current = onUnderlying;
  useEffect(() => {
    if (meta && meta.price > 0) onUnderlyingRef.current({ symbol: meta.symbol, spot: meta.price });
  }, [meta]);

  const [picked, setPicked] = useState<PickedContract | null>(null);
  const chainKey = chain ? `${chain.symbol}|${chain.expirationDate}` : "";
  useEffect(() => { setPicked(null); }, [chainKey]);

  const strategies = useMemo(() => {
    if (!chain) return [];
    const mr = num(maxRisk);
    let perContract = mr > 0 ? mr : 500;
    // Desk limit is a hard cap on the whole trade (N contracts).
    if (deskMaxRisk != null) perContract = Math.min(perContract, deskMaxRisk / contractsN);
    return buildStrategies(chain, goal, perContract, ivOutlook, contractsN, riskFree);
  }, [chain, goal, maxRisk, ivOutlook, contractsN, riskFree, deskMaxRisk]);
  const tradeRisk = (num(maxRisk) > 0 ? num(maxRisk) : 500) * contractsN;
  const overDesk = deskMaxRisk != null && tradeRisk > deskMaxRisk + 0.005;
  const maxRiskHint = [
    personalRisk != null ? t("advisor.personalRisk", { amount: fmtUsd(personalRisk, { decimals: 0 }) }) : null,
    deskMaxRisk != null
      ? t(personalRisk != null ? "advisor.deskLimitAfter" : "advisor.deskLimit", { amount: fmtUsd(deskMaxRisk, { decimals: 0 }) })
      : null,
  ].filter(Boolean).join(" · ");

  const atmIv = useMemo(() => {
    if (!chain) return null;
    return fsFind(chain.calls, chain.spot)?.iv ?? fsFind(chain.puts, chain.spot)?.iv ?? null;
  }, [chain]);

  function legIv(type: "call" | "put", strike: number): number | null {
    if (!chain) return null;
    return (type === "call" ? chain.calls : chain.puts).find((o) => o.strike === strike)?.iv ?? null;
  }

  function handleUseBs(s: Strategy) {
    const first = s.legs[0];
    if (!first || !chain) return;
    onUseInBs({
      symbol: chain.symbol, spot: chain.spot, strike: first.strike, side: first.optType, days: chain.daysToExpiry,
      iv: legIv(first.optType, first.strike), premium: first.premium, contracts: contractsN,
    });
  }

  function strategyToBuilder(s: Strategy) {
    if (!chain) return;
    // Covered call / protective put / collar assume 100 shares held per contract.
    const withStock = ["covered_call", "protective_put", "collar"].includes(s.id);
    onOpenInBuilder({
      symbol: chain.symbol, spot: chain.spot, days: chain.daysToExpiry, iv: atmIv,
      legs: [
        ...(withStock ? [{ side: "buy" as const, kind: "stock" as const, strike: chain.spot, premium: 0, qty: 100 * contractsN }] : []),
        ...s.legs.map((l) => ({ side: l.action, kind: l.optType, strike: l.strike, premium: l.premium, qty: contractsN })),
      ],
    });
  }

  function pickContract(type: OptSide, o: ChainOption) {
    if (!chain) return;
    onPickContract({
      symbol: chain.symbol, spot: chain.spot, strike: o.strike, side: type, days: chain.daysToExpiry,
      iv: o.iv, premium: o.mid, contracts: contractsN, builderIv: atmIv ?? o.iv,
    });
    setPicked({ type, strike: o.strike, premium: o.mid });
  }

  const expLabel = chain ? `${fmtDeskDate(oc.selectedExp)} · ${t("shared.days", { count: chain.daysToExpiry })}` : "";

  return (
    <div className="flex flex-col gap-4">
      <ChainHeader oc={oc} atmIv={chain && !oc.chainLoading ? atmIv : null} />

      {!chain && !oc.loading && !oc.chainLoading && !oc.error && oc.expirations.length === 0 && (
        <Panel>
          <EmptyState icon={BarChart3} title={t("advisor.emptyTitle")}
            description={t("advisor.emptyDescription")} />
        </Panel>
      )}

      {chain && (
        <>
          <StrikeLadder chain={chain} expLabel={expLabel} picked={picked} onPick={pickContract}
            builderLegCount={builderLegCount} onShowBs={onShowBs} onShowBuilder={onShowBuilder} />

          <Panel title={t("advisor.title")} icon={Zap} description={t("advisor.description")}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">{t("advisor.view")}</span>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label={t("advisor.view")}>
                  {GOALS.map((g) => (
                    <button key={g.id} type="button" aria-pressed={goal === g.id} onClick={() => setGoal(g.id)}
                      className="chip inline-flex min-h-9 items-center justify-center gap-1.5 px-3 py-1 text-center text-sm font-medium leading-tight">
                      <g.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{t(`advisor.goals.${g.id}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-[auto_repeat(3,minmax(0,10rem))] md:items-end">
                <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
                  <span className="flex min-h-5 items-center gap-1 text-xs text-muted-foreground">
                    {t("advisor.ivAhead")}
                    <Hint text={t("advisor.ivHint")} />
                  </span>
                  <Segmented<IvOutlook> ariaLabel={t("advisor.ivAria")} value={ivOutlook} onChange={setIvOutlook}
                    options={IV_OUTLOOKS.map((v) => ({ value: v, label: t(`advisor.ivOutlook.${v}`) }))} />
                </div>
                <NumField label={t("advisor.maxRiskPerContract")} prefix="$" value={maxRisk} onChange={setMaxRisk} placeholder="500"
                  error={overDesk ? t("advisor.overDesk", { risk: fmtUsd(tradeRisk, { decimals: 0 }), limit: fmtUsd(deskMaxRisk ?? 0, { decimals: 0 }) }) : undefined}
                  hint={maxRiskHint || undefined} />
                <NumField label={t("shared.contracts")} value={nContracts} onChange={setNContracts} integer placeholder="1" />
                <NumField label={t("shared.rate")} suffix="%" value={rateStr} onChange={setRateStr} placeholder="4.5" />
              </div>
            </div>
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Star className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("advisor.recommendations")}
              <span className="font-normal text-muted-foreground">· {chain.symbol} {fmtUsd(chain.spot)} · {t("shared.days", { count: chain.daysToExpiry })}</span>
            </h2>
            {builderLegCount > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={onShowBuilder}><Layers aria-hidden="true" /> {t("modes.builderCount", { count: builderLegCount })}</Button>
            )}
          </div>
          {strategies.length === 0 ? (
            <Panel><EmptyState icon={Star} title={t("advisor.noStrategiesTitle")} description={t("advisor.noStrategiesDescription")} /></Panel>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(showAllStrategies ? strategies : strategies.slice(0, TOP_STRATEGIES)).map((s, i) => (
                  <StrategyCard key={s.id} s={s} spot={chain.spot} top={i === 0} onUseInBs={handleUseBs} onToBuilder={strategyToBuilder} />
                ))}
              </div>
              {strategies.length > TOP_STRATEGIES && (
                <Button type="button" variant="ghost" size="sm" className="self-start" aria-expanded={showAllStrategies}
                  onClick={() => setShowAllStrategies((v) => !v)}>
                  <ChevronDown className={cn("transition-transform", showAllStrategies && "rotate-180")} aria-hidden="true" />
                  {showAllStrategies ? t("advisor.fewerStrategies") : t("advisor.moreStrategies", { count: strategies.length - TOP_STRATEGIES })}
                </Button>
              )}
            </div>
          )}

          <Panel title={t("advisor.atmTitle")} description={t("advisor.atmDescription")}>
            <ScenarioTable chain={chain} goal={goal} />
          </Panel>
        </>
      )}

      <AiAdvisor chain={chain} atmIv={atmIv} onOpenInBuilder={onOpenInBuilder} />
    </div>
  );
}
