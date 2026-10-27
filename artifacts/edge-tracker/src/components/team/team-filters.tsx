/**
 * «Фильтры (n)» of the «Команда» feed (/notifications?tab=team; design audit wave 3): the sections with their 30-day
 * counts, the action type and — for staff — the trader with «Только мои». It replaces the second and third filter rows
 * under the feed toolbar; the active values show as chips under the row (team-activity).
 */
import { FilterChip } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterSection, FiltersButton } from "@/components/shared/filters/filter-toolbar";
import { PersonSelect } from "@/components/people/person-select";
import { ACTION_GROUPS, actionGroupLabel, sectionMeta, type ActionGroup } from "@/components/team/activity-model";
import { activityI18n } from "@/i18n/ns/activity";
import { commonI18n } from "@/i18n/ns/common";

export type Filters = { group: ActionGroup; sections: string[]; trader: string | null };
export const DEFAULT_FILTERS: Filters = { group: "all", sections: [], trader: null };

export function TeamFiltersButton({
  filters, setFilters, count, sectionKeys, sectionCounts, countsHint, staff, me, traderOptions,
}: {
  filters: Filters;
  setFilters: (f: (prev: Filters) => Filters) => void;
  count: number;
  sectionKeys: string[];
  sectionCounts: ReadonlyMap<string, number>;
  /** The counts came from the server (30-day facets): say so. */
  countsHint: boolean;
  staff: boolean;
  me: string | null;
  traderOptions: string[];
}) {
  const { t } = activityI18n.useT();
  const tc = commonI18n.useT().t;
  const toggleSection = (s: string) =>
    setFilters((f) => ({ ...f, sections: f.sections.includes(s) ? f.sections.filter((x) => x !== s) : [...f.sections, s] }));
  const pickTrader = (v: string | null) => setFilters((f) => ({ ...f, trader: v }));
  return (
    <FiltersButton count={count} onReset={() => setFilters(() => DEFAULT_FILTERS)} width="lg">
      <FilterSection title={t("sectionsAria")} action={countsHint ? <span className="text-xs text-muted-foreground">{t("counts30d")}</span> : undefined}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("sectionsAria")}>
          {sectionKeys.map((s) => {
            const m = sectionMeta(s);
            const Icon = m.icon;
            return (
              <FilterChip key={s} size="sm" active={filters.sections.includes(s)} onClick={() => toggleSection(s)} count={sectionCounts.get(s)}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {m.label}
              </FilterChip>
            );
          })}
        </div>
      </FilterSection>
      <FilterSection title={t("actionTypeAria")}>
        <Select value={filters.group} onValueChange={(g) => setFilters((f) => ({ ...f, group: g as ActionGroup }))}>
          <SelectTrigger aria-label={t("actionTypeAria")} className="h-9 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(ACTION_GROUPS) as ActionGroup[]).map((k) => <SelectItem key={k} value={k}>{actionGroupLabel(k)}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSection>
      {staff && (
        <FilterSection title={tc("fields.trader")}>
          <div className="flex flex-wrap items-center gap-1.5">
            <PersonSelect value={filters.trader ?? ""} onValueChange={(v) => pickTrader(v || null)} options={traderOptions} allLabel={tc("fields.allTraders")} self={me} ariaLabel={tc("fields.trader")} className="h-9 min-w-0 flex-1" />
            {me && (
              <FilterChip size="sm" active={filters.trader === me} onClick={() => pickTrader(filters.trader === me ? null : me)}>
                {t("onlyMineFilter")}
              </FilterChip>
            )}
          </div>
        </FilterSection>
      )}
    </FiltersButton>
  );
}
