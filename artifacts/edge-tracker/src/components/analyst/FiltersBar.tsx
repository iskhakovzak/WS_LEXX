/**
 * The feed's one filter row (design audit wave 3, components/shared/filters/filter-toolbar):
 *
 *   [ search ]  [ type: Все · Смена рейтинга · … ]  [ Неделя ▾ ]  [ Фильтры (n) ]          N строк
 *   chips       Мои тикеры ×  Топ-фирмы ×  Таргет ≥ 10% ×  Сбросить
 *
 * «Фильтры» holds my tickers / session (M / T), firm tier, target change, sector, cap, the order and the saved views.
 * Everything except the search is persisted by the page (usePersistentState analyst.filters.v6; the period also in
 * ?period).
 */
import * as React from "react";
import { Bookmark, Coins, Sunrise, Trash2, UserRound } from "lucide-react";
import { FilterChip, Kbd, Segmented, TermTooltip } from "@/components/ds";
import { ActiveFilters, FilterSection, FiltersButton, ToolbarSearch, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { analystI18n } from "@/i18n/ns/analyst";
import {
  CAP_PRESETS, DEFAULT_FILTERS, PERIOD_PRESETS_AA, PT_SIZES,
  type Filters, type PtSize, type SavedView, type SortKey, type TierFilter, type TypeFilter,
} from "./lib";

export type TypeCounts = Record<TypeFilter, number>;

export function FiltersBar({
  filters: f,
  onChange,
  search,
  onSearch,
  searchRef,
  typeCounts,
  sectors,
  capStats,
  mineCount,
  views,
  onSaveView,
  onDeleteView,
  firmFilter,
  tickerFilter,
  onClearFirm,
  onClearTicker,
  onReset,
  sortKey,
  onSortMode,
  shown,
  today,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  search: string;
  onSearch: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  typeCounts: TypeCounts;
  sectors: string[];
  capStats?: { known: number; unknown: number; excludedUnknown?: number; excludedUnknownTickers?: number };
  mineCount: number;
  views: SavedView[];
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  firmFilter: string | null;
  tickerFilter: string | null;
  onClearFirm: () => void;
  onClearTicker: () => void;
  onReset: () => void;
  sortKey: SortKey;
  onSortMode: (k: "time" | "score") => void;
  shown: number;
  /** NY day (YYYY-MM-DD): the latest day of «Период…». */
  today: string;
}) {
  const { t } = analystI18n.useT();
  const tierLabel = (v: TierFilter) => (v === "top" ? t("filters.tierTop") : t("filters.tierOther"));
  // Inside «Фильтры»: everything except the search, the type (main mode) and the period (scope).
  const inside = [f.mineOnly, f.todayOnly, f.tier !== "all", !!f.ptMin, !!f.sector, f.minCapB > 0, sortKey === "score"].filter(Boolean).length;
  const resetInside = () => {
    onChange({ mineOnly: false, todayOnly: false, tier: "all", ptMin: 0, sector: null, minCapB: 0 });
    if (sortKey === "score") onSortMode("time");
  };
  const chips: Array<ActiveFilter | false> = [
    f.mineOnly && { key: "mine", label: t("filters.myTickers"), onRemove: () => onChange({ mineOnly: false }) },
    f.todayOnly && { key: "session", label: t("filters.toSession"), onRemove: () => onChange({ todayOnly: false }) },
    f.tier !== "all" && { key: "tier", label: t("filters.chipTier", { value: tierLabel(f.tier) }), onRemove: () => onChange({ tier: "all" }) },
    !!f.ptMin && { key: "pt", label: t("filters.chipPt", { value: f.ptMin }), onRemove: () => onChange({ ptMin: 0 }) },
    !!f.sector && { key: "sector", label: t("filters.chipSector", { name: f.sector }), onRemove: () => onChange({ sector: null }) },
    f.minCapB > 0 && { key: "cap", label: t("filters.chipCap", { value: f.minCapB }), onRemove: () => onChange({ minCapB: 0 }) },
    sortKey === "score" && { key: "sort", label: t("filters.chipSort"), onRemove: () => onSortMode("time") },
    !!firmFilter && { key: "firm", label: t("filters.firm", { name: firmFilter }), removeLabel: t("filters.clearFirm"), onRemove: onClearFirm },
    !!tickerFilter && { key: "ticker", label: t("filters.ticker", { name: tickerFilter }), removeLabel: t("filters.clearTicker"), onRemove: onClearTicker },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarSearch
          value={search}
          onChange={onSearch}
          inputRef={searchRef}
          placeholder={t("filters.searchPlaceholder")}
          ariaLabel={t("filters.searchAria")}
          className="basis-44"
        />
        <Segmented<TypeFilter>
          ariaLabel={t("filters.typeAria")}
          value={f.type}
          onChange={(v) => onChange({ type: v })}
          options={[
            { value: "all", label: commonI18n.t("states.all"), count: typeCounts.all },
            { value: "moves", label: t("filters.type.moves"), count: typeCounts.moves },
            { value: "upgrade", label: t("filters.type.upgrade"), count: typeCounts.upgrade },
            { value: "downgrade", label: t("filters.type.downgrade"), count: typeCounts.downgrade },
            { value: "initiated", label: t("filters.type.initiated"), count: typeCounts.initiated },
            { value: "targets", label: t("filters.type.targets"), count: typeCounts.targets },
          ]}
        />
        <PeriodPicker
          compact
          presets={PERIOD_PRESETS_AA}
          value={f.period}
          custom={f.custom}
          onPreset={(p) => onChange({ period: p })}
          onCustom={(r) => onChange({ period: "custom", custom: r })}
          today={today}
          ariaLabel={t("filters.periodAria")}
        />
        <FiltersButton count={inside} onReset={resetInside} width="md" resultCount={shown}>
          <FilterSection title={t("filters.showSection")}>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip size="sm" active={f.mineOnly} onClick={() => onChange({ mineOnly: !f.mineOnly })} count={mineCount || undefined}>
                <UserRound aria-hidden="true" /> {t("filters.myTickers")}
                <Kbd className="ml-0.5 hidden sm:inline-flex">M</Kbd>
              </FilterChip>
              <FilterChip size="sm" active={f.todayOnly} onClick={() => onChange({ todayOnly: !f.todayOnly })}>
                <Sunrise aria-hidden="true" /> {t("filters.toSession")}
                <Kbd className="ml-0.5 hidden sm:inline-flex">T</Kbd>
              </FilterChip>
            </div>
          </FilterSection>
          <FilterSection title={<span className="inline-flex items-center gap-1">{t("filters.firms")} <TermTooltip term="topFirm" icon /></span>}>
            <Segmented<TierFilter>
              ariaLabel={t("filters.tierAria")}
              size="sm"
              value={f.tier}
              onChange={(v) => onChange({ tier: v })}
              options={[{ value: "all", label: commonI18n.t("states.all") }, { value: "top", label: t("filters.tierTop") }, { value: "other", label: t("filters.tierOther") }]}
            />
          </FilterSection>
          <FilterSection title={<span className="inline-flex items-center gap-1">{t("filters.ptChange")} <TermTooltip term="pt" icon /></span>}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filters.ptAria")}>
              {PT_SIZES.map((v) => (
                <FilterChip key={v} size="sm" active={f.ptMin === v} onClick={() => onChange({ ptMin: v as PtSize })}>
                  {v === 0 ? t("filters.any") : `≥ ${v}%`}
                </FilterChip>
              ))}
            </div>
          </FilterSection>
          {(sectors.length > 1 || f.sector) && (
            <FilterSection title={<Label htmlFor="aa-sector">{t("filters.sector")}</Label>}>
              <select
                id="aa-sector"
                value={f.sector ?? ""}
                onChange={(e) => onChange({ sector: e.target.value || null })}
                className="glass-field h-9 w-full rounded-lg px-3 text-sm text-foreground"
              >
                <option value="">{t("filters.allSectors")}</option>
                {f.sector && !sectors.includes(f.sector) && <option value={f.sector}>{f.sector}</option>}
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FilterSection>
          )}
          <FilterSection title={<span className="inline-flex items-center gap-1"><Coins className="h-3.5 w-3.5" aria-hidden="true" /> {t("filters.capFrom")}</span>}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filters.capAria")}>
              {CAP_PRESETS.map((b) => (
                <FilterChip key={b} size="sm" active={f.minCapB === b} onClick={() => onChange({ minCapB: b })}>
                  {b === 0 ? t("filters.anyCap") : `$${b}B`}
                </FilterChip>
              ))}
            </div>
            {f.minCapB > 0 && (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="aa-unknown-cap" className="text-xs font-normal text-muted-foreground">
                  {t("filters.includeUnknown")}{unknownCount(f.includeUnknownCap, capStats)}
                </Label>
                <Switch id="aa-unknown-cap" checked={f.includeUnknownCap} onCheckedChange={(v) => onChange({ includeUnknownCap: v })} />
              </div>
            )}
          </FilterSection>
          <FilterSection title={t("filters.orderAria")}>
            <Segmented<SortKey>
              ariaLabel={t("filters.orderAria")}
              size="sm"
              value={sortKey === "score" ? "score" : "time"}
              onChange={(v) => onSortMode(v === "score" ? "score" : "time")}
              options={[{ value: "time", label: t("filters.newest") }, { value: "score", label: t("filters.important") }]}
            />
          </FilterSection>
          <SavedViews views={views} onSave={onSaveView} onDelete={onDeleteView} onApply={(v) => onChange(v.filters)} current={f} />
        </FiltersButton>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t("filters.rows", { count: shown })}</span>
      </div>
      <ActiveFilters items={chips} onReset={onReset} />
    </div>
  );
}

/** «Виды» inside «Фильтры»: apply / delete a saved set, save the current one. */
function SavedViews({
  views, onSave, onDelete, onApply, current,
}: {
  views: SavedView[];
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  onApply: (v: SavedView) => void;
  current: Filters;
}) {
  const { t } = analystI18n.useT();
  const [name, setName] = React.useState("");
  const same = (v: SavedView) => JSON.stringify(v.filters) === JSON.stringify(current);
  const canSave = name.trim().length > 0 && JSON.stringify(current) !== JSON.stringify(DEFAULT_FILTERS);
  return (
    <FilterSection title={<span className="inline-flex items-center gap-1"><Bookmark className="h-3.5 w-3.5" aria-hidden="true" /> {t("filters.views")}</span>}>
      {views.length > 0 ? (
        <ul className="flex flex-col gap-0.5" aria-label={t("filters.viewsAria")}>
          {views.map((v) => (
            <li key={v.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={same(v)}
                onClick={() => onApply(v)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--glass-hover-bg)]",
                  same(v) ? "font-medium text-primary" : "text-foreground",
                )}
              >
                {v.name}
              </button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDelete(v.id)} aria-label={t("filters.removeView", { name: v.name })} title={t("filters.removeView", { name: v.name })}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("filters.viewsHint")}</p>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (canSave) { onSave(name.trim()); setName(""); } }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder={t("filters.viewName")} aria-label={t("filters.viewName")} className="h-8" />
        <Button type="submit" size="sm" disabled={!canSave}>{commonI18n.t("actions.save")}</Button>
      </form>
    </FilterSection>
  );
}

/** « (N)» after «включая без данных»: actions shown with an unknown cap, or — switch off — excluded for it. */
function unknownCount(include: boolean, s: { unknown: number; excludedUnknown?: number } | undefined): string {
  const n = include ? s?.unknown ?? 0 : s?.excludedUnknown ?? 0;
  return n > 0 ? ` (${n})` : "";
}
