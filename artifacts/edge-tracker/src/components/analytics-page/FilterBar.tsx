/**
 * /analytics scope row (design audit wave 3), right under the header and above the tabs, in the same order as /stats,
 * /behavior, /what-if, /benchmark: period (the group's shared scope, hooks/use-analytics-scope) · person (staff) ·
 * unit R / $ · «Фильтры (n)» — side, horizon, setup, account, ticker and the «Разрезы» — then every active filter as a
 * chip. Phones: one row (period select · person · «Фильтры»); the unit moves into «Фильтры».
 * One ticker field only: the page's own (a drill target of «Преимущество», sent to the server sums), so the «Разрезы»
 * grid hides its «Найти тикер».
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Segmented, Toolbar } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { ActiveFilters, FilterSection, FiltersButton, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { FacetFilterSections } from "@/components/shared/trade-facets/facet-filters";
import { rangeFacetChips, rangeFacetCount, resetRangeFacets, type RangeFacets } from "@/components/shared/trade-facets/range-facets";
import { ANALYTICS_PRESETS, type AnalyticsPreset, type AnalyticsScope } from "@/hooks/use-analytics-scope";
import { analyticsI18n } from "@/i18n/ns/analytics";
import {
  type AnalyticsFilters, type SideFilter, type Unit, type Horizon, type HorizonFilter,
  HORIZONS, activeFilterCount, horizonLabel,
} from "./metrics";

const ALL = "__all__";
const NO_FILTERS = { side: "", horizon: "", setup: "", ticker: "", account: "", source: "" } as const;

export type FilterOptions = {
  setups: string[];
  hasNoSetup: boolean;
  tickers: string[];
  /** Broker accounts seen in the data (PropReports). Trades come only from PropReports: no source switch. */
  accounts: string[];
};

export function FilterBar({
  sc, presetRange, filters, onChange, options, unit, onUnitChange, hasPnl, hasR, traderPicker, rf, className,
}: {
  sc: AnalyticsScope;
  /** The window of the current preset (the custom form's prefill). */
  presetRange: { from?: string | null; to?: string | null } | null;
  filters: AnalyticsFilters;
  onChange: (f: AnalyticsFilters) => void;
  options: FilterOptions;
  unit: Unit;
  onUnitChange: (u: Unit) => void;
  hasPnl: boolean;
  hasR: boolean;
  /** Staff: the trader picker (own book · whole team · a person), always shown — it decides what every tab reads. */
  traderPicker?: ReactNode;
  rf: RangeFacets;
  className?: string;
}) {
  const { t } = analyticsI18n.useT();
  const isMobile = useIsMobile();
  const set = <K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) => onChange({ ...filters, [k]: v });
  const tickerListId = useId();
  const [tickerDraft, setTickerDraft] = useState(filters.ticker);
  useEffect(() => setTickerDraft(filters.ticker), [filters.ticker]);

  const commitTicker = (raw: string) => {
    const v = raw.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
    if (v !== filters.ticker) set("ticker", v);
  };
  const resetAll = () => { onChange({ ...filters, ...NO_FILTERS }); resetRangeFacets(rf); };
  const count = activeFilterCount(filters) + rangeFacetCount(rf);
  const chip = (label: string, value: string) => t("filters.chip", { label, value });
  const chips: ActiveFilter[] = [
    filters.side && { key: "side", label: t(`bucket.side.${filters.side}`), onRemove: () => set("side", "") },
    filters.horizon && { key: "horizon", label: horizonLabel(filters.horizon), onRemove: () => set("horizon", "") },
    filters.setup && { key: "setup", label: filters.setup === "__none__" ? t("filters.noSetup") : chip(t("filters.setup"), filters.setup), onRemove: () => set("setup", "") },
    filters.account && { key: "account", label: chip(t("filters.account"), filters.account), onRemove: () => set("account", "") },
    filters.ticker && { key: "ticker", label: filters.ticker, onRemove: () => set("ticker", "") },
    ...rangeFacetChips(rf),
  ].filter((x): x is ActiveFilter => !!x);

  const unitSwitch = (
    <Segmented<Unit>
      ariaLabel={t("filters.unit")}
      size="sm"
      options={[
        { value: "r", label: "R", disabled: !hasR },
        { value: "usd", label: "$", disabled: !hasPnl },
      ]}
      value={unit}
      onChange={onUnitChange}
    />
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Toolbar className="max-md:flex-nowrap">
        <PeriodPicker<AnalyticsPreset>
          compact comparePrev ariaLabel={t("filters.period")} presets={ANALYTICS_PRESETS} value={sc.period} custom={sc.custom}
          presetRange={presetRange} today={sc.today} onPreset={sc.setPreset} onCustom={sc.setCustom} className="shrink-0"
        />
        {traderPicker}
        {!isMobile && unitSwitch}
        <FiltersButton count={count} onReset={resetAll} width="xl">
          {isMobile && <FilterSection title={t("filters.unit")}>{unitSwitch}</FilterSection>}
          <FilterSection title={t("filters.side")}>
            <Segmented<"all" | "long" | "short">
              ariaLabel={t("filters.side")}
              size="sm"
              className="self-start"
              options={[
                { value: "all", label: t("filters.sideAll") },
                { value: "long", label: t("bucket.side.long") },
                { value: "short", label: t("bucket.side.short") },
              ]}
              value={filters.side || "all"}
              onChange={(v) => set("side", (v === "all" ? "" : v) as SideFilter)}
            />
          </FilterSection>
          <FilterSection title={t("filters.horizon")}>
            <Segmented<"all" | Horizon>
              ariaLabel={t("filters.horizon")}
              size="sm"
              className="self-start"
              options={[
                { value: "all", label: t("filters.horizonAll") },
                ...HORIZONS.map((h) => ({ value: h, label: horizonLabel(h) })),
              ]}
              value={filters.horizon || "all"}
              onChange={(v) => set("horizon", (v === "all" ? "" : v) as HorizonFilter)}
            />
          </FilterSection>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(options.setups.length > 0 || filters.setup) && (
              <FilterSection title={t("filters.setup")}>
                <Select value={filters.setup || ALL} onValueChange={(v) => set("setup", v === ALL ? "" : v)}>
                  <SelectTrigger aria-label={t("filters.setup")} className="h-9 w-full">
                    <SelectValue placeholder={t("filters.allSetups")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("filters.allSetups")}</SelectItem>
                    {options.hasNoSetup && <SelectItem value="__none__">{t("filters.noSetup")}</SelectItem>}
                    {options.setups.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    {filters.setup && filters.setup !== "__none__" && !options.setups.includes(filters.setup) && (
                      <SelectItem value={filters.setup}>{filters.setup}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </FilterSection>
            )}
            {(options.accounts.length > 0 || filters.account) && (
              <FilterSection title={t("filters.account")}>
                <Select value={filters.account || ALL} onValueChange={(v) => set("account", v === ALL ? "" : v)}>
                  <SelectTrigger aria-label={t("filters.account")} className="h-9 w-full">
                    <SelectValue placeholder={t("filters.allAccounts")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("filters.allAccounts")}</SelectItem>
                    {options.accounts.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    {filters.account && !options.accounts.includes(filters.account) && <SelectItem value={filters.account}>{filters.account}</SelectItem>}
                  </SelectContent>
                </Select>
              </FilterSection>
            )}
            <FilterSection title={t("filters.ticker")}>
              <form role="search" onSubmit={(e) => { e.preventDefault(); commitTicker(tickerDraft); }}>
                <Input
                  aria-label={t("filters.ticker")}
                  placeholder={t("filters.ticker")}
                  list={tickerListId}
                  value={tickerDraft}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    setTickerDraft(v);
                    if (v === "" || options.tickers.includes(v)) commitTicker(v);
                  }}
                  onBlur={() => commitTicker(tickerDraft)}
                  className="h-9 uppercase tabular-nums placeholder:normal-case"
                />
                <datalist id={tickerListId}>
                  {options.tickers.map((x) => <option key={x} value={x} />)}
                </datalist>
              </form>
            </FilterSection>
          </div>
          {rf.enabled && (
            <FacetFilterSections view={rf.fv.view} onChange={rf.fv.update} data={rf.q.data} loading={rf.q.isFetching} error={rf.q.isError} tickerSearch={false} />
          )}
        </FiltersButton>
      </Toolbar>
      <ActiveFilters items={chips} onReset={resetAll} />
    </div>
  );
}
