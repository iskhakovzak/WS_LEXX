/**
 * The inside of «Фильтры (n)» on /trades (TradeFilterBar): the trader (staff), result / direction / horizon / setup,
 * the exact fields (ticker, session, event type, sector, tag, selected ids), execution quality, the list order (list
 * modes only) and the saved views. Every value set here also shows as a chip under the toolbar (trade-filter-chips).
 */
import * as React from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookmarkPlus, X } from "lucide-react";
import { FilterChip, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterSection } from "@/components/shared/filters/filter-toolbar";
import { PersonSelect } from "@/components/people/person-select";
import { commonI18n } from "@/i18n/ns/common";
import { tradesI18n } from "@/i18n/ns/trades";
import { EVENT_LABEL, EVENT_TYPES, HORIZONS, HORIZON_LABEL, SESSIONS, SESSION_LABEL, type Outcome, type SortConfig, type TradeFilters } from "./trade-utils";
import type { SavedView } from "./use-trade-filters";

const ALL = "__all";
const OUTCOMES: readonly Outcome[] = ["all", "win", "loss", "breakeven", "open"];
const SORT_COLS = ["date", "impact", "pnl", "fees", "hold", "ticker", "entry", "exitEff", "setup"] as const satisfies readonly SortConfig["col"][];

export type TradeFilterFieldsProps = {
  filters: TradeFilters;
  patch: (p: Partial<TradeFilters>) => void;
  outcomeCounts: Record<Outcome, number>;
  horizonCounts: Record<string, number>;
  setups: { name: string; count: number }[];
  /** Staff only (more than one trader in scope); empty hides the picker. */
  traders: string[];
  sectors: string[];
};

/** Trader · result · direction · horizon · setup (the left column). */
export function TradeMainFields({ filters: f, patch, outcomeCounts, horizonCounts, setups, traders }: TradeFilterFieldsProps) {
  const { t } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const top = setups.slice(0, 6);
  return (
    <>
      {traders.length > 1 && (
        <FilterSection title={tc("fields.trader")}>
          <PersonSelect value={f.trader || ""} onValueChange={(v) => patch({ trader: v })} options={traders} allLabel={tc("fields.allTraders")} ariaLabel={tc("fields.trader")} className="h-9 w-full" />
        </FilterSection>
      )}
      <FilterSection title={tc("trading.result")}>
        <Segmented
          ariaLabel={tc("trading.result")}
          size="sm"
          value={f.outcome}
          onChange={(v) => patch({ outcome: v })}
          options={OUTCOMES.map((o) => ({ value: o, label: t(`filters.outcome.${o}`), count: outcomeCounts[o] }))}
        />
      </FilterSection>
      <FilterSection title={t("filters.direction")}>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("filters.direction")}>
          {(["Long", "Short"] as const).map((s) => (
            <FilterChip key={s} size="sm" active={f.side === s} onClick={() => patch({ side: f.side === s ? "" : s })}>
              {s === "Long" ? tc("trading.long") : tc("trading.short")}
            </FilterChip>
          ))}
        </div>
      </FilterSection>
      <FilterSection title={tc("trading.horizon")}>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tc("trading.horizon")}>
          {HORIZONS.map((h) => (
            <FilterChip key={h} size="sm" active={f.horizon === h} onClick={() => patch({ horizon: f.horizon === h ? "" : h })} count={horizonCounts[h] || undefined}>
              {HORIZON_LABEL[h]}
            </FilterChip>
          ))}
        </div>
      </FilterSection>
      {(top.length > 0 || f.setup) && (
        <FilterSection title={tc("trading.setup")}>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={tc("trading.setup")}>
            {top.map((s) => (
              <FilterChip key={s.name} size="sm" active={f.setup === s.name} onClick={() => patch({ setup: f.setup === s.name ? "" : s.name })} count={s.count}>
                {EVENT_LABEL[s.name] ?? s.name}
              </FilterChip>
            ))}
            {f.setup && !top.some((s) => s.name === f.setup) && (
              <FilterChip size="sm" active onClick={() => patch({ setup: "" })}>{EVENT_LABEL[f.setup] ?? f.setup}</FilterChip>
            )}
          </div>
        </FilterSection>
      )}
    </>
  );
}

function FieldSelect({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger id={id} className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{commonI18n.t("states.all")}</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The exact fields and execution quality (the right column). */
export function TradeExactFields({ filters: f, patch, sectors }: Pick<TradeFilterFieldsProps, "filters" | "patch" | "sectors">) {
  const { t } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  return (
    <>
      <FilterSection title={t("filters.more")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tf-flt-ticker" className="text-xs text-muted-foreground">{t("filters.tickerExact")}</Label>
            <Input id="tf-flt-ticker" value={f.ticker} onChange={(e) => patch({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, "") })} placeholder="NVDA" className="h-9 uppercase" />
          </div>
          <FieldSelect id="tf-flt-session" label={tc("trading.session")} value={f.session} onChange={(v) => patch({ session: v })} options={SESSIONS.map((s) => ({ value: s, label: SESSION_LABEL[s] ?? s }))} />
          <FieldSelect id="tf-flt-event" label={t("filters.eventType")} value={f.eventType} onChange={(v) => patch({ eventType: v })} options={EVENT_TYPES.map((s) => ({ value: s, label: EVENT_LABEL[s] ?? s }))} />
          {sectors.length > 0 && (
            <FieldSelect id="tf-flt-sector" label={tc("trading.sector")} value={f.sector} onChange={(v) => patch({ sector: v })} options={sectors.map((s) => ({ value: s, label: s }))} />
          )}
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="tf-flt-tag" className="text-xs text-muted-foreground">{t("filters.tagContains")}</Label>
            <Input id="tf-flt-tag" value={f.tag} onChange={(e) => patch({ tag: e.target.value })} placeholder="Gap, Offering…" className="h-9" />
          </div>
          {f.ids && (
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("filters.selectedIds")}</Label>
              <Button variant="outline" size="sm" className="h-9 w-full justify-between" onClick={() => patch({ ids: "" })}>
                <span className="truncate tabular-nums">{tc("units.trades", { count: f.ids.split(",").filter(Boolean).length })}</span><X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </FilterSection>
      <FilterSection title={t("filters.quality")}>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tf-flt-eff" className="text-xs text-muted-foreground" title={t("filters.exitEffTitle")}>{t("filters.exitEffLabel")}</Label>
            <Input id="tf-flt-eff" type="number" inputMode="numeric" min={-100} max={100} step={5} value={f.exitEffMax} onChange={(e) => patch({ exitEffMax: e.target.value })} placeholder="50" className="h-9 px-3" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tf-flt-mfe" className="text-xs text-muted-foreground" title={t("filters.mfeTitle")}>MFE ≥ R</Label>
            <Input id="tf-flt-mfe" type="number" inputMode="decimal" min={0} step={0.5} value={f.mfeRMin} onChange={(e) => patch({ mfeRMin: e.target.value })} placeholder="2" className="h-9 px-3" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tf-flt-left" className="text-xs text-muted-foreground" title={t("filters.leftTitle")}>{t("filters.leftLabel")}</Label>
            <Input id="tf-flt-left" type="number" inputMode="decimal" min={0} step={0.5} value={f.leftMin} onChange={(e) => patch({ leftMin: e.target.value })} placeholder="1" className="h-9 px-3" />
          </div>
        </div>
        <p className="text-2xs text-muted-foreground">{t("filters.qualityHint")}</p>
      </FilterSection>
    </>
  );
}

/** The order of the flat list (only in the list modes; the day view is always newest first). */
export function TradeSortField({ sort, onSort }: { sort: SortConfig; onSort: (s: SortConfig) => void }) {
  const { t } = tradesI18n.useT();
  const dirLabel = t(sort.dir === "desc" ? "review.sort.desc" : "review.sort.asc");
  return (
    <FilterSection title={commonI18n.t("actions.sort")}>
      <div className="flex items-center gap-1">
        <Select value={sort.col} onValueChange={(v) => onSort({ col: v as SortConfig["col"], dir: sort.dir })}>
          <SelectTrigger className="h-9 min-w-0 flex-1" aria-label={commonI18n.t("actions.sort")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORT_COLS.map((c) => <SelectItem key={c} value={c}>{t(`review.sort.${c}`)}</SelectItem>)}
            {!(SORT_COLS as readonly string[]).includes(sort.col) && <SelectItem value={sort.col}>{sort.col}</SelectItem>}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon-sm" className="h-9 w-9" aria-label={dirLabel} title={dirLabel} onClick={() => onSort({ col: sort.col, dir: sort.dir === "desc" ? "asc" : "desc" })}>
          {sort.dir === "desc" ? <ArrowDownWideNarrow className="h-4 w-4" aria-hidden="true" /> : <ArrowUpNarrowWide className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    </FilterSection>
  );
}

/** Named filter sets: apply (closes the panel), remove, save the current filters. */
export function SavedViewsField({ views, onSave, onApply, onRemove, canSave }: {
  views: SavedView[]; onSave: (name: string) => void; onApply: (v: SavedView) => void; onRemove: (id: string) => void; canSave: boolean;
}) {
  const { t } = tradesI18n.useT();
  const [name, setName] = React.useState("");
  function save() {
    const n = name.trim();
    if (!n) return;
    onSave(n.slice(0, 40));
    setName("");
  }
  return (
    <FilterSection title={t("filters.views.title")}>
      {views.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("filters.views.empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {views.map((v) => (
            <li key={v.id} className="inline-flex min-h-8 items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] text-sm">
              <button type="button" onClick={() => onApply(v)} className="max-w-[14rem] cursor-pointer truncate rounded-full py-1 pl-3 pr-1 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {v.name}
              </button>
              <button
                type="button"
                aria-label={t("filters.views.remove", { name: v.name })}
                onClick={() => onRemove(v.id)}
                className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-down focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Input
          aria-label={t("filters.views.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={canSave ? t("filters.views.name") : t("filters.views.setFiltersFirst")}
          disabled={!canSave}
          className="h-9"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!canSave || !name.trim()} aria-label={t("filters.views.save")} title={t("filters.views.save")} className="h-9 w-9 shrink-0 px-0">
          <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </FilterSection>
  );
}
