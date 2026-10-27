/**
 * The ONE toolbar of /trades (design audit wave 3, components/shared/filters):
 *
 *   [ search ]  [ По дням · Все сделки · Разобрать N · Худшие N · … ]  [ Всё ▾ ]  [ Фильтры (n) ]
 *
 * - the mode Segmented merges the old view toggle (days / list) and the six review presets (a preset = the list + the
 *   preset); counts come from facets.presets;
 * - the period is the one vocabulary (PeriodPicker compact; «Период…» replaces the old from / to inputs);
 * - everything else (trader, result, direction, horizon, setup, exact fields, quality, order, saved views and the
 *   «Разрезы» with «Исключить IMX») is inside «Фильтры (n)»; each value set there is a chip under the toolbar.
 * Phones: search + «Фильтры» on the first row (the period moves into the sheet), the mode scrolls sideways on the second.
 */
import * as React from "react";
import { Segmented, Toolbar } from "@/components/ds";
import { fmtCount } from "@/lib/format";
import { FiltersButton, FilterSection, ToolbarSearch } from "@/components/shared/filters/filter-toolbar";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { FacetFilterSections, facetFilterCount } from "@/components/shared/trade-facets/facet-filters";
import { useIsMobile } from "@/hooks/use-mobile";
import { parseDayRange, type PeriodPreset } from "@/lib/period-range";
import { nyDate } from "@/lib/trading-date";
import type { FacetView, FacetsResponse } from "@/lib/trade-facets";
import type { TradesPageFacets } from "@/hooks/use-trades-page";
import { tradesI18n } from "@/i18n/ns/trades";
import { isDefaultFilters, popoverFilterCount, type SortConfig } from "./trade-utils";
import { PRESETS, PRESET_META, isPreset, type Preset } from "./review-presets";
import { SavedViewsField, TradeExactFields, TradeMainFields, TradeSortField, type TradeFilterFieldsProps } from "./trade-filter-fields";
import type { SavedView, TradesView } from "./use-trade-filters";

/** The main mode of the page: the day cards, the flat list, or the flat list through a preset. */
export type TradesMode = TradesView | Preset;

type Props = TradeFilterFieldsProps & {
  searchRef: React.RefObject<HTMLInputElement | null>;
  mode: TradesMode;
  onMode: (m: TradesMode) => void;
  presetCounts: TradesPageFacets["presets"];
  sort: SortConfig;
  onSort: (s: SortConfig) => void;
  /** «Сбросить фильтры» in the panel: everything inside it (and the facets); the search and the period stay. */
  onResetPanel: () => void;
  views: SavedView[];
  onSaveView: (name: string) => void;
  onApplyView: (v: SavedView) => void;
  onRemoveView: (id: string) => void;
  facets: { view: FacetView; onChange: (v: FacetView) => void; data: FacetsResponse | undefined; loading: boolean; error: boolean; help?: React.ReactNode };
  resultCount?: number;
};

export function TradeFilterBar(p: Props) {
  const { t } = tradesI18n.useT();
  const { filters: f, patch } = p;
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const listMode = p.mode !== "days";
  const count = popoverFilterCount(f) + facetFilterCount(p.facets.view) + (isMobile && f.period !== "all" ? 1 : 0);

  const modes = [
    { value: "days", label: t("review.byDays") },
    { value: "list", label: t("page.allTrades") },
    // Only «Разобрать» carries its count (the to-do); the other subsets name theirs in the tooltip, so the mode row,
    // the period and «Фильтры» stay one line on a 1440 screen.
    ...PRESETS.map((k) => {
      const n = p.presetCounts?.[k] ?? undefined;
      return { value: k, label: PRESET_META[k].short, title: n != null ? `${PRESET_META[k].label} · ${fmtCount(n)}` : PRESET_META[k].label, count: k === "review" ? n : undefined };
    }),
  ];
  const period = (
    <PeriodPicker
      compact
      value={f.period}
      custom={parseDayRange(f.from, f.to)}
      onPreset={(v: PeriodPreset) => patch({ period: v, from: "", to: "" })}
      onCustom={(r) => patch({ period: "custom", from: r.from, to: r.to })}
      today={nyDate()}
    />
  );

  return (
    <Toolbar className="gap-2">
      <ToolbarSearch
        value={f.q}
        onChange={(q) => patch({ q })}
        inputRef={p.searchRef}
        hotkey={false} // the page binds «/» itself (it skips while the trade card or a dialog is open)
        ariaLabel={t("filters.searchAria")}
        placeholder={t("filters.searchPlaceholder")}
      />
      <div className="order-last min-w-0 basis-full xl:order-none xl:basis-auto">
        <Segmented<string>
          ariaLabel={t("review.modeAria")}
          size="sm"
          value={p.mode}
          onChange={(v) => p.onMode(v === "days" || v === "list" || isPreset(v) ? v : "days")}
          options={modes}
        />
      </div>
      {!isMobile && period}
      <FiltersButton count={count} onReset={p.onResetPanel} width="xl" resultCount={p.resultCount} open={open} onOpenChange={setOpen}>
        {isMobile && <FilterSection title={t("filters.period")}>{period}</FilterSection>}
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <TradeMainFields {...p} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <TradeExactFields filters={f} patch={patch} sectors={p.sectors} />
            {listMode && <TradeSortField sort={p.sort} onSort={p.onSort} />}
            <SavedViewsField
              views={p.views}
              onSave={p.onSaveView}
              onApply={(v) => { p.onApplyView(v); setOpen(false); }}
              onRemove={p.onRemoveView}
              canSave={!isDefaultFilters(f)}
            />
          </div>
        </div>
        <FacetFilterSections
          view={p.facets.view}
          onChange={p.facets.onChange}
          data={p.facets.data}
          loading={p.facets.loading}
          error={p.facets.error}
          tickerSearch={false} // the page search already finds tickers
          help={p.facets.help}
        />
      </FiltersButton>
    </Toolbar>
  );
}
