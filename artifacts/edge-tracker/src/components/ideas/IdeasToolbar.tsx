/**
 * The /trade-ideas filter row (design audit wave 3, components/shared/filters): search · board/list (the main mode) ·
 * «Фильтры (n)» with whose ideas, author, horizon, sort and — in the list — the stage; every non-default value shows as
 * a removable chip under the row.
 */
import type * as React from "react";
import { Columns3, List } from "lucide-react";
import { FilterChip, Segmented, Toolbar } from "@/components/ds";
import { ActiveFilters, FilterSection, FiltersButton, ToolbarSearch, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { PersonSelect } from "@/components/people/person-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HORIZONS, STAGES, type Horizon, type Stage } from "./model";
import { ideasI18n } from "@/i18n/ns/ideas";
import { commonI18n } from "@/i18n/ns/common";
import { personName } from "@/i18n";

export type IdeasView = "board" | "list";
export type IdeasScope = "all" | "mine";
export type IdeasSort = "new" | "score" | "rr";
export type IdeasStageFilter = "all" | Stage;

export type IdeasFilterState = {
  query: string;
  view: IdeasView;
  scope: IdeasScope;
  author: string;
  horizon: "all" | Horizon;
  sort: IdeasSort;
  stage: IdeasStageFilter;
  ticker: string | null;
};

export type IdeasFilterSetters = {
  setQuery: (v: string) => void;
  setView: (v: IdeasView) => void;
  setScope: (v: IdeasScope) => void;
  setAuthor: (v: string) => void;
  setHorizon: (v: "all" | Horizon) => void;
  setSort: (v: IdeasSort) => void;
  setStage: (v: IdeasStageFilter) => void;
  setTicker: (v: string | null) => void;
};

export function IdeasToolbar({
  f, set, me, authors, stageCounts, total, resultCount, updating, searchRef, onReset,
}: {
  f: IdeasFilterState;
  set: IdeasFilterSetters;
  me: string;
  authors: string[];
  stageCounts: Record<Stage, number>;
  /** Ideas after every filter except the stage (the «Все» chip count). */
  total: number;
  resultCount: number;
  updating: boolean;
  searchRef: React.Ref<HTMLInputElement>;
  onReset: () => void;
}) {
  const { t } = ideasI18n.useT();
  const { t: tc } = commonI18n.useT();
  const stageOn = f.view === "list" && f.stage !== "all";
  const sortLabel = f.sort === "score" ? t("page.sortScore") : f.sort === "rr" ? t("page.sortRr") : t("page.sortNew");
  const count = [f.scope !== "all", f.author !== "all", f.horizon !== "all", f.sort !== "new", stageOn, !!f.ticker].filter(Boolean).length;
  const chips: Array<ActiveFilter | false> = [
    !!f.ticker && { key: "ticker", label: f.ticker, onRemove: () => set.setTicker(null) },
    f.scope !== "all" && { key: "scope", label: tc("fields.mine"), onRemove: () => set.setScope("all") },
    f.author !== "all" && { key: "author", label: `${t("page.author")}: ${personName(f.author)}`, onRemove: () => set.setAuthor("all") },
    f.horizon !== "all" && { key: "horizon", label: HORIZONS.find((h) => h.key === f.horizon)?.label ?? f.horizon, onRemove: () => set.setHorizon("all") },
    stageOn && { key: "stage", label: STAGES.find((s) => s.key === f.stage)?.short ?? f.stage, onRemove: () => set.setStage("all") },
    f.sort !== "new" && { key: "sort", label: sortLabel, onRemove: () => set.setSort("new") },
  ];
  const resetAll = () => onReset();

  return (
    <>
      <Toolbar className="gap-2">
        <ToolbarSearch
          inputRef={searchRef}
          value={f.query}
          onChange={set.setQuery}
          placeholder={t("page.searchPlaceholder")}
          ariaLabel={t("page.searchAria")}
        />
        <Segmented<IdeasView>
          ariaLabel={t("page.viewAria")}
          value={f.view}
          onChange={set.setView}
          options={[
            { value: "board", label: <><Columns3 aria-hidden="true" />{t("page.board")}</> },
            { value: "list", label: <><List aria-hidden="true" />{t("page.list")}</> },
          ]}
        />
        <FiltersButton count={count} onReset={onReset} resultCount={resultCount}>
          <FilterSection title={t("page.scopeAria")}>
            <Segmented<IdeasScope>
              ariaLabel={t("page.scopeAria")}
              size="sm"
              value={f.scope}
              onChange={set.setScope}
              options={[{ value: "all", label: tc("states.all") }, { value: "mine", label: tc("fields.mine"), disabled: !me }]}
            />
            <PersonSelect value={f.author} onValueChange={set.setAuthor} allValue="all" allLabel={t("page.allAuthors")} options={authors} placeholder={t("page.author")} ariaLabel={t("page.author")} className="h-9 w-full" />
          </FilterSection>
          <FilterSection title={t("page.horizon")}>
            <Select value={f.horizon} onValueChange={(v) => set.setHorizon(v as "all" | Horizon)}>
              <SelectTrigger className="h-9 w-full" aria-label={t("page.horizon")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("page.anyHorizon")}</SelectItem>
                {HORIZONS.map((h) => <SelectItem key={h.key} value={h.key}>{h.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterSection>
          {f.view === "list" && (
            <FilterSection title={tc("fields.status")}>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip size="sm" active={f.stage === "all"} onClick={() => set.setStage("all")} count={total}>{tc("states.all")}</FilterChip>
                {STAGES.filter((s) => s.key !== "rejected" || stageCounts.rejected > 0).map((s) => (
                  <FilterChip key={s.key} size="sm" active={f.stage === s.key} onClick={() => set.setStage(s.key)} count={stageCounts[s.key]}>{s.short}</FilterChip>
                ))}
              </div>
            </FilterSection>
          )}
          <FilterSection title={t("page.sortAria")}>
            <Segmented<IdeasSort>
              ariaLabel={t("page.sortAria")}
              size="sm"
              value={f.sort}
              onChange={set.setSort}
              options={[{ value: "new", label: t("page.sortNew") }, { value: "score", label: t("page.sortScore") }, { value: "rr", label: t("page.sortRr") }]}
            />
          </FilterSection>
        </FiltersButton>
        {updating && <span className="ml-auto text-xs text-muted-foreground">{t("page.updatingPrices")}</span>}
      </Toolbar>
      <ActiveFilters items={chips} onReset={resetAll} />
    </>
  );
}
