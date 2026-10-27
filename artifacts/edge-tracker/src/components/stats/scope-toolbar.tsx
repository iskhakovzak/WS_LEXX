/**
 * /stats scope row (design audit wave 3): the group's shared period · person (hooks/use-analytics-scope) and
 * «Фильтры (n)» — the horizon and the «Разрезы» — right under the header, in the same order as /analytics, /behavior,
 * /what-if, /benchmark; every active filter as a chip under it. The unit (R / $ нетто / $ брутто) stays the series
 * switch in the curve's header (design audit P2).
 */
import { Segmented, Toolbar } from "@/components/ds";
import { ActiveFilters, FilterSection, FiltersButton, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { RangeFacetSections, rangeFacetChips, rangeFacetCount, resetRangeFacets, type RangeFacets } from "@/components/shared/trade-facets/range-facets";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { ANALYTICS_PRESETS, type AnalyticsPreset, type AnalyticsScope } from "@/hooks/use-analytics-scope";
import { statsI18n } from "@/i18n/ns/stats";
import { HORIZON_OPTIONS, horizonLabel, type HorizonFilter, type Range } from "./metrics";

export function StatsScopeToolbar({ sc, presetRange, rf, picker, horizon, onHorizon }: {
  sc: AnalyticsScope;
  /** The window of the current preset (the custom form's prefill). */
  presetRange: Range;
  rf: RangeFacets;
  /** Staff only: the person picker (own book · «Вся команда» · a person). */
  picker: { value: string; onChange: (v: string) => void; me: string | null; names: string[] } | null;
  horizon: HorizonFilter;
  onHorizon: (h: HorizonFilter) => void;
}) {
  const { t } = statsI18n.useT();
  const reset = () => { onHorizon("all"); resetRangeFacets(rf); };
  const chips: ActiveFilter[] = [
    ...(horizon !== "all" ? [{ key: "horizon", label: horizonLabel(horizon), onRemove: () => onHorizon("all") }] : []),
    ...rangeFacetChips(rf),
  ];
  return (
    <>
      <Toolbar>
        <PeriodPicker<AnalyticsPreset>
          compact comparePrev ariaLabel={t("periodAria")} presets={ANALYTICS_PRESETS} value={sc.period} custom={sc.custom}
          presetRange={presetRange} today={sc.today} onPreset={sc.setPreset} onCustom={sc.setCustom}
        />
        {picker && (
          <StaffTraderPicker
            value={picker.value} onChange={picker.onChange} me={picker.me} names={picker.names} teamLabel={t("wholeTeam")}
            className="h-9 w-auto min-w-0 max-w-[18rem] sm:min-w-[13rem]" ariaLabel={t("traderAria")}
          />
        )}
        <FiltersButton count={(horizon !== "all" ? 1 : 0) + rangeFacetCount(rf)} onReset={reset} width="xl">
          <FilterSection title={t("horizonAria")}>
            <Segmented<HorizonFilter>
              ariaLabel={t("horizonAria")} size="sm" value={horizon} onChange={onHorizon} className="self-start"
              options={HORIZON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </FilterSection>
          <RangeFacetSections rf={rf} />
        </FiltersButton>
      </Toolbar>
      <ActiveFilters items={chips} onReset={reset} />
    </>
  );
}
