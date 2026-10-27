/**
 * The one toolbar of «Группа» (design audit wave 3): search · table/cards · group (scope) · «Фильтры (n)» … count, CSV;
 * then the active filters as removable chips. Attention chips, activity, idle days, tier and the cards' sort / patterns
 * live in the filters popover.
 */
import { AlertTriangle, ClipboardList, Download, LayoutGrid, Rows3, ShieldAlert, UsersRound } from "lucide-react";
import { FilterChip, Segmented, Toolbar } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActiveFilters, FilterSection, FiltersButton, ToolbarSearch, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { PersonSelect } from "@/components/people/person-select";
import { curatorI18n } from "@/i18n/ns/curator";
import { commonI18n } from "@/i18n/ns/common";
import type { TraderSort } from "./curator-math";
import { ALL_GROUPS, activeFilterCount, type GroupFilters, type GroupKey } from "./group-model";

const IDLE_OPTIONS = [3, 5, 10, 20] as const;
const CARD_SORT_KEYS: readonly TraderSort[] = ["attention", "pnl", "discipline", "name"];

export type GroupToolbarProps = {
  group: GroupKey;
  groupOptions: { value: string; label: string; hint?: string }[];
  total: number;
  me: string | null;
  onGroupChange: (g: GroupKey) => void;
  q: string;
  onQ: (v: string) => void;
  mode: "table" | "cards";
  onMode: (m: "table" | "cards") => void;
  cardSort: TraderSort;
  onCardSort: (s: TraderSort) => void;
  patterns: "on" | "off";
  onPatterns: (p: "on" | "off") => void;
  filters: GroupFilters;
  onPatch: (p: Partial<GroupFilters>) => void;
  onResetFilters: () => void;
  counts: { risk: number; violations: number; pending: number; idle: number };
  tiers: [string, string][];
  shown: number;
  inGroup: number;
  narrowed: boolean;
  onCsv: (() => void) | null;
};

export function GroupToolbar(p: GroupToolbarProps) {
  const { t } = curatorI18n.useT();
  const f = p.filters;
  const cards = p.mode === "cards";
  const sortChanged = cards && p.cardSort !== "attention";
  const patternsOff = cards && p.patterns === "off";
  const count = activeFilterCount(f) + (sortChanged ? 1 : 0) + (patternsOff ? 1 : 0);
  const resetAll = () => {
    p.onResetFilters();
    p.onCardSort("attention");
    p.onPatterns("on");
  };
  const tierName = p.tiers.find(([k]) => k === f.tier)?.[1] ?? f.tier;
  const chips: (ActiveFilter | false)[] = [
    f.risk && { key: "risk", label: t("group.risk"), onRemove: () => p.onPatch({ risk: false }) },
    f.violations && { key: "violations", label: t("group.violations"), onRemove: () => p.onPatch({ violations: false }) },
    f.pending && { key: "pending", label: t("group.pending"), onRemove: () => p.onPatch({ pending: false }) },
    f.activity === "active" && { key: "activity", label: t("group.activity.active"), onRemove: () => p.onPatch({ activity: "all" }) },
    f.activity === "idle" && { key: "activity", label: t("group.chips.idle", { count: f.idleDays }), onRemove: () => p.onPatch({ activity: "all" }) },
    !!f.tier && { key: "tier", label: t("group.chips.tier", { name: tierName }), onRemove: () => p.onPatch({ tier: "" }) },
    sortChanged && { key: "sort", label: t("group.chips.sort", { value: t(`group.cardSort.${p.cardSort}`) }), onRemove: () => p.onCardSort("attention") },
    patternsOff && { key: "patterns", label: t("group.patternsOff"), onRemove: () => p.onPatterns("on") },
  ];

  return (
    <div className="flex flex-col gap-2">
      <Toolbar>
        <ToolbarSearch value={p.q} onChange={p.onQ} placeholder={commonI18n.t("people.placeholder")} ariaLabel={commonI18n.t("people.label")} />
        <Segmented
          ariaLabel={t("group.viewAria")}
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: "table", label: <><Rows3 aria-hidden="true" />{t("group.table")}</> },
            { value: "cards", label: <><LayoutGrid aria-hidden="true" />{t("group.cards")}</> },
          ]}
        />
        <PersonSelect
          value={p.group}
          onValueChange={(v) => p.onGroupChange(v || ALL_GROUPS)}
          allValue={ALL_GROUPS}
          allLabel={`${t("group.allGroups")} · ${p.total}`}
          options={p.groupOptions}
          placeholder={t("group.groupPicker")}
          ariaLabel={t("group.groupPicker")}
          self={p.me}
          selfSuffix={t("group.mineSuffix")}
          icon={UsersRound}
          className="h-9 w-56"
        />
        <FiltersButton count={count} onReset={resetAll} resultCount={p.shown} description={t("group.filtersAria")}>
          <FilterSection title={t("group.filterSections.attention")}>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip size="sm" active={f.risk} onClick={() => p.onPatch({ risk: !f.risk })} count={p.counts.risk}><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />{t("group.risk")}</FilterChip>
              <FilterChip size="sm" active={f.violations} onClick={() => p.onPatch({ violations: !f.violations })} count={p.counts.violations}><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t("group.violations")}</FilterChip>
              <FilterChip size="sm" active={f.pending} onClick={() => p.onPatch({ pending: !f.pending })} count={p.counts.pending}><ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />{t("group.pending")}</FilterChip>
            </div>
          </FilterSection>
          <FilterSection title={t("group.filterSections.activity")}>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                size="sm"
                ariaLabel={t("group.activityAria")}
                value={f.activity}
                onChange={(v) => p.onPatch({ activity: v })}
                options={[
                  { value: "all", label: t("group.activity.all") },
                  { value: "active", label: t("group.activity.active") },
                  { value: "idle", label: t("group.activity.idle"), count: p.counts.idle },
                ]}
              />
              <Select value={String(f.idleDays)} onValueChange={(v) => p.onPatch({ idleDays: Number(v) })}>
                <SelectTrigger className="h-8 w-[5.5rem] px-3 text-xs" aria-label={t("group.idleTitle")} title={t("group.idleTitle")}><SelectValue /></SelectTrigger>
                <SelectContent>{IDLE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{t("group.idleDays", { count: n })}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </FilterSection>
          {p.tiers.length > 0 && (
            <FilterSection title={t("group.filterSections.tier")}>
              <Select value={f.tier || "__any"} onValueChange={(v) => p.onPatch({ tier: v === "__any" ? "" : v })}>
                <SelectTrigger className="h-9" aria-label={t("group.tierAria")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">{t("group.tierAny")}</SelectItem>
                  {p.tiers.map(([k, n]) => <SelectItem key={k} value={k}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterSection>
          )}
          {cards && (
            <FilterSection title={t("group.filterSections.cards")}>
              <Segmented size="sm" ariaLabel={t("group.cardSortAria")} value={p.cardSort} onChange={p.onCardSort} options={CARD_SORT_KEYS.map((value) => ({ value, label: t(`group.cardSort.${value}`) }))} />
              <Segmented size="sm" ariaLabel={t("group.patternsAria")} value={p.patterns} onChange={p.onPatterns} options={[{ value: "on", label: t("group.patternsOn") }, { value: "off", label: t("group.patternsOff") }]} />
            </FilterSection>
          )}
        </FiltersButton>
        <span className="ml-auto" />
        {p.narrowed && <span className="text-xs tabular-nums text-muted-foreground">{t("group.shown", { shown: p.shown, total: p.inGroup })}</span>}
        {p.onCsv && <Button type="button" variant="ghost" size="sm" onClick={p.onCsv} title={t("group.csvTitle")}><Download aria-hidden="true" /> CSV</Button>}
      </Toolbar>
      <ActiveFilters items={chips} onReset={resetAll} />
    </div>
  );
}
