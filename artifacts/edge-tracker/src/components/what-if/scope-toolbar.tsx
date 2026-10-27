/**
 * /what-if scope row (design audit wave 3): the group's shared period · person (hooks/use-analytics-scope) and
 * «Фильтры (n)» with the «Разрезы», right under the header in the same order as /stats, /analytics, /behavior; the
 * active cuts as chips under it.
 */
import { Toolbar } from "@/components/ds";
import { ActiveFilters, FiltersButton } from "@/components/shared/filters/filter-toolbar";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { RangeFacetSections, rangeFacetChips, rangeFacetCount, resetRangeFacets, type RangeFacets } from "@/components/shared/trade-facets/range-facets";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { TEAM } from "@/components/people/staff-scope";
import { ANALYTICS_PRESETS, type AnalyticsPreset, type AnalyticsScope } from "@/hooks/use-analytics-scope";
import { whatIfI18n } from "@/i18n/ns/whatIf";

export function WhatIfScopeToolbar({ sc, rf, staff, me, traders, filters }: {
  sc: AnalyticsScope;
  rf: RangeFacets;
  /** Staff pick a person or «Вся команда»; a trader sees only the own book. */
  staff: boolean;
  me: string;
  traders: string[];
  /** «Фильтры» (the «Разрезы»): not for guests. */
  filters: boolean;
}) {
  const { t } = whatIfI18n.useT();
  const team = sc.trader === TEAM;
  const reset = () => resetRangeFacets(rf);
  return (
    <>
      <Toolbar>
        <PeriodPicker<AnalyticsPreset>
          compact ariaLabel={t("periodAria")} presets={ANALYTICS_PRESETS} value={sc.period} custom={sc.custom} today={sc.today}
          onPreset={sc.setPreset} onCustom={sc.setCustom}
        />
        {staff && (
          <StaffTraderPicker
            value={team ? TEAM : sc.trader || me}
            onChange={(v) => sc.setTrader(v === me ? "" : v)}
            me={me}
            names={traders}
            teamLabel={t("wholeTeam")}
            className="h-9 w-auto min-w-0 max-w-[18rem] sm:min-w-[13rem]"
            ariaLabel={t("traderAria")}
          />
        )}
        {filters && (
          <FiltersButton count={rangeFacetCount(rf)} onReset={reset} width="xl">
            <RangeFacetSections rf={rf} />
          </FiltersButton>
        )}
      </Toolbar>
      <ActiveFilters items={rangeFacetChips(rf)} onReset={reset} />
    </>
  );
}
