import { useEffect, useRef, useState } from "react";
import { Bookmark, Download, X } from "lucide-react";
import { FilterChip, Toolbar } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActiveFilters, FilterSection, FiltersButton, ToolbarSearch, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { cn } from "@/lib/utils";
import {
  BUILTIN_PRESETS, EMPTY_FILTERS, activeFilterCount, describeFilters, normalizeFilters, sameFilters,
  type FilterPreset, type OfferingFilters,
} from "./filters";
import { DEAL_TYPE_HINT, DEAL_TYPE_LABEL, type DealType } from "./score";
import { commonI18n } from "@/i18n/ns/common";
import { offeringsI18n } from "@/i18n/ns/offerings";

const TYPES: DealType[] = ["spo", "direct", "pipe", "atm", "ipo", "shelf", "s1"];

function NumField({ label, value, onChange, suffix, placeholder, step = 1 }: {
  label: string; value: number | null; onChange: (v: number | null) => void; suffix?: string; placeholder?: string; step?: number;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => { setText(value == null ? "" : String(value)); }, [value]);
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <span className="relative">
        <Input
          inputMode="decimal"
          type="number"
          step={step}
          min={0}
          value={text}
          placeholder={placeholder ?? "—"}
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.trim() === "" ? null : Number(e.target.value.replace(",", "."));
            onChange(v == null || !Number.isFinite(v) ? null : v);
          }}
          className={cn("h-8 tabular-nums", suffix && "pr-8")}
        />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

/** One removable chip per set filter (wave 3: every value hidden in «Фильтры» is seen under the toolbar). */
function activeChips(f: OfferingFilters, set: (patch: Partial<OfferingFilters>) => void): ActiveFilter[] {
  const t = offeringsI18n.t;
  const out: ActiveFilter[] = [];
  if (f.mine) out.push({ key: "mine", label: t("filters.myTickers"), onRemove: () => set({ mine: false }) });
  if (f.types.length) out.push({ key: "types", label: f.types.map((x) => DEAL_TYPE_LABEL[x]).join(" / "), onRemove: () => set({ types: [] }) });
  if (f.minPctMcap != null) out.push({ key: "pct", label: t("filters.descPctMcap", { value: f.minPctMcap }), onRemove: () => set({ minPctMcap: null }) });
  if (f.minDiscount != null) out.push({ key: "disc", label: t("filters.descDiscount", { value: f.minDiscount }), onRemove: () => set({ minDiscount: null }) });
  if (f.priceMin != null || f.priceMax != null) out.push({ key: "price", label: t("filters.descPrice", { min: f.priceMin ?? 0, max: f.priceMax ?? "∞" }), onRemove: () => set({ priceMin: null, priceMax: null }) });
  if (f.floatMaxM != null) out.push({ key: "float", label: t("filters.descFloat", { value: f.floatMaxM }), onRemove: () => set({ floatMaxM: null }) });
  if (f.mcapMaxM != null) out.push({ key: "mcap", label: t("filters.descMcap", { value: f.mcapMaxM }), onRemove: () => set({ mcapMaxM: null }) });
  if (f.minScore != null) out.push({ key: "score", label: t("filters.descScore", { value: f.minScore }), onRemove: () => set({ minScore: null }) });
  return out;
}

/**
 * The offerings toolbar (wave 3 filter pattern): search · the one main-mode Segmented (`mode`, «Когда торгуется» on the
 * day tab) · «Фильтры (n)» (saved sets, «Мои тикеры», deal type, numbers) · count + CSV at the end; active filters as chips.
 */
export function FilterBar({
  filters,
  onChange,
  presets,
  onSavePreset,
  onDeletePreset,
  query,
  onQuery,
  searchRef,
  mineCount,
  onExport,
  canExport,
  shown,
  total,
  mode,
  loading = false,
}: {
  filters: OfferingFilters;
  onChange: (f: OfferingFilters) => void;
  presets: FilterPreset[];
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  mineCount: number;
  onExport: () => void;
  canExport: boolean;
  shown: number;
  total: number;
  /** The screen's one Segmented (main mode), after the search. */
  mode?: React.ReactNode;
  /** The day is still loading: filters and search already work, counts are not known yet. */
  loading?: boolean;
}) {
  const { t } = offeringsI18n.useT();
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const count = activeFilterCount(filters);
  const all = [...BUILTIN_PRESETS, ...presets];
  const activePreset = all.find((p) => sameFilters(p.filters, filters) && count > 0);
  const set = (patch: Partial<OfferingFilters>) => onChange(normalizeFilters({ ...filters, ...patch }));
  const reset = () => onChange(EMPTY_FILTERS);

  return (
    <>
      <Toolbar>
        {/* The page binds «/» itself (next to its J/K/W/P keys), so the box's own hotkey is off. */}
        <ToolbarSearch value={query} onChange={onQuery} inputRef={searchRef} hotkey={false} placeholder={t("filters.searchPlaceholder")} ariaLabel={t("filters.searchAria")} />
        {mode}
        <FiltersButton count={count} onReset={reset} resultCount={loading ? undefined : shown}>
          <FilterSection title={t("filters.presetsAria")}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filters.presetsAria")}>
              <FilterChip active={filters.mine} onClick={() => set({ mine: !filters.mine })} count={loading ? undefined : mineCount} className="min-h-8 text-xs">
                {t("filters.myTickers")}
              </FilterChip>
              {all.map((p) => {
                const on = activePreset?.id === p.id;
                return (
                  <span key={p.id} className="relative inline-flex" title={describeFilters(p.filters)}>
                    <FilterChip active={on} onClick={() => onChange(on ? EMPTY_FILTERS : p.filters)} className={cn("min-h-8 text-xs", !p.builtin && "pr-7")}>
                      {p.name}
                    </FilterChip>
                    {!p.builtin && (
                      <button type="button" onClick={() => onDeletePreset(p.id)} aria-label={t("filters.deletePreset", { name: p.name })}
                        className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </FilterSection>
          <FilterSection title={t("filters.dealType")}>
            <div className="flex flex-wrap gap-1">
              {TYPES.map((dt) => {
                const on = filters.types.includes(dt);
                return (
                  <button key={dt} type="button" aria-pressed={on} title={DEAL_TYPE_HINT[dt]}
                    onClick={() => set({ types: on ? filters.types.filter((x) => x !== dt) : [...filters.types, dt] })}
                    className="chip inline-flex min-h-7 items-center px-2.5 text-xs font-medium">
                    {DEAL_TYPE_LABEL[dt]}
                  </button>
                );
              })}
            </div>
          </FilterSection>
          <FilterSection>
            <div className="grid grid-cols-2 gap-2">
              <NumField label={t("filters.minPctMcap")} value={filters.minPctMcap} onChange={(v) => set({ minPctMcap: v })} suffix="%" />
              <NumField label={t("filters.minDiscount")} value={filters.minDiscount} onChange={(v) => set({ minDiscount: v })} suffix="%" />
              <NumField label={t("filters.priceMin")} value={filters.priceMin} onChange={(v) => set({ priceMin: v })} suffix="$" step={0.5} />
              <NumField label={t("filters.priceMax")} value={filters.priceMax} onChange={(v) => set({ priceMax: v })} suffix="$" step={0.5} />
              <NumField label={t("filters.floatMax")} value={filters.floatMaxM} onChange={(v) => set({ floatMaxM: v })} suffix="M" />
              <NumField label={t("filters.mcapMax")} value={filters.mcapMaxM} onChange={(v) => set({ mcapMaxM: v })} suffix="M" step={50} />
              <NumField label={t("filters.minScore")} value={filters.minScore} onChange={(v) => set({ minScore: v == null ? null : Math.min(100, v) })} />
            </div>
            <p className="text-2xs text-muted-foreground">{t("filters.numericHint")}</p>
          </FilterSection>
          <form
            className="flex items-center gap-2 border-t border-[var(--glass-border)] pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (!n || count === 0) { nameRef.current?.focus(); return; }
              onSavePreset(n);
              setName("");
            }}
          >
            <Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("filters.presetName")} aria-label={t("filters.presetNameAria")} className="h-8 flex-1" maxLength={40} />
            <Button type="submit" size="sm" variant="outline" className="h-8" disabled={count === 0 || !name.trim()}>
              <Bookmark aria-hidden="true" /> {commonI18n.t("actions.save")}
            </Button>
          </form>
        </FiltersButton>

        <div className="ml-auto flex items-center gap-2">
          {loading
            ? <span aria-hidden="true" className="skeleton block h-3 w-8" />
            : <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{shown === total ? `${total}` : commonI18n.t("states.ofTotal", { value: shown, total })}</span>}
          {canExport && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onExport} aria-label={t("filters.downloadCsv")} title={t("filters.downloadCsv")}>
              <Download aria-hidden="true" />
            </Button>
          )}
        </div>
      </Toolbar>
      <ActiveFilters items={activeChips(filters, set)} onReset={reset} />
    </>
  );
}
