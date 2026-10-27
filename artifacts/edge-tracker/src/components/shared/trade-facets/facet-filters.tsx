/**
 * The trade «Разрезы» in the one filter pattern (components/shared/filters, design audit wave 3):
 * - inside «Фильтры (n)»: the «Исключить IMX» switch and the column grid (FacetFilterSections);
 * - under the toolbar: «Без IMX ×» and the hidden values as struck-through chips (facetChips) — more than two hidden in
 *   one column fold into «Месяцы: скрыто 10 ×»;
 * - the count for the button badge (facetFilterCount) and the reset (resetFacetFilters).
 * Used by /trades, /stats and the period pages (range-facets RangeFacetFilters).
 */
import type * as React from "react";
import { FilterSection, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { tradeFacetsI18n } from "@/i18n/ns/tradeFacets";
import { activeCount, toggleKey, uncheckedChips, type FacetView, type FacetsResponse } from "@/lib/trade-facets";
import { FacetGrid } from "./FacetPanel";
import { ImxToggle } from "./FacetSummary";

export function facetFilterCount(view: FacetView): number {
  return activeCount(view) + (view.excludeImx ? 1 : 0);
}

export function resetFacetFilters(view: FacetView): FacetView {
  return { ...view, off: {}, excludeImx: false };
}

export function facetChips(view: FacetView, onChange: (v: FacetView) => void, data: FacetsResponse | undefined): ActiveFilter[] {
  const t = tradeFacetsI18n.t;
  const out: ActiveFilter[] = [];
  if (view.excludeImx) out.push({ key: "imx", label: t("imx.chip"), onRemove: () => onChange({ ...view, excludeImx: false }) });
  const all = uncheckedChips(view, data);
  const perDim = new Map<string, number>();
  for (const c of all) perDim.set(c.dim, (perDim.get(c.dim) ?? 0) + 1);
  for (const [dim, n] of perDim) {
    if (n <= 2) continue;
    const d = dim as (typeof all)[number]["dim"];
    out.push({ key: `g:${d}`, label: t("chipGroup", { dim: t(`dims.${d}`), count: n }), onRemove: () => onChange({ ...view, off: { ...view.off, [d]: [] } }) });
  }
  for (const c of all) {
    if ((perDim.get(c.dim) ?? 0) > 2) continue;
    const label = `${t(`dims.${c.dim}`)}: ${c.label}`;
    out.push({ key: `${c.dim}:${c.key}`, label, excluded: true, onRemove: () => onChange(toggleKey(view, c.dim, c.key)) });
  }
  return out;
}

export function FacetFilterSections({ view, onChange, data, loading, error, tickerSearch = true, help }: {
  view: FacetView;
  onChange: (v: FacetView) => void;
  data: FacetsResponse | undefined;
  loading: boolean;
  error: boolean;
  tickerSearch?: boolean;
  /** The page's «?» next to the title. */
  help?: React.ReactNode;
}) {
  const t = tradeFacetsI18n.t;
  return (
    <>
      <FilterSection>
        <ImxToggle value={view.excludeImx} onChange={(v) => onChange({ ...view, excludeImx: v })} />
      </FilterSection>
      <FilterSection title={t("title")} action={help}>
        <p className="-mt-1 text-xs text-muted-foreground">{t("clickHint")}</p>
        <FacetGrid view={view} onChange={onChange} data={data} loading={loading} error={error} tickerSearch={tickerSearch} />
      </FilterSection>
    </>
  );
}
