/**
 * The playbook library's one filter row (design audit wave 3): the list search + «Фильтры (n)» (list view / sort,
 * the quick filter, tags) + «collapse all», and the active chips under it. The same row sits in the library's left
 * column (`inline`: the column is already a glass panel) and as a glass Toolbar above the card grid.
 */
import * as React from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Toolbar } from "@/components/ds";
import { ActiveFilters, FilterSection, FiltersButton, ToolbarSearch, type ActiveFilter } from "@/components/shared/filters/filter-toolbar";
import { Button } from "@/components/ui/button";
import type { QuickFilter, SortKey } from "./model";
import { playbookI18n } from "@/i18n/ns/playbook";

export const SORT_KEYS: SortKey[] = ["folder", "edge", "used", "new", "name"];
export const FILTER_KEYS: QuickFilter[] = ["all", "regime", "today", "edge", "untested", "noExamples", "unreviewed"];

const CHIP = "chip min-h-8 px-2.5 text-xs pointer-coarse:min-h-10";

export function LibraryFilters({
  inline = false,
  query, onQuery, onSearchKeyDown, inputRef,
  sort, onSort,
  quick, onQuick, quickCounts, showUnreviewed,
  tags, tagFilter, onTagFilter,
  collapse,
  resultCount,
  onResetAll,
}: {
  /** In the library column (no glass of its own); false = a Toolbar above the grid. */
  inline?: boolean;
  query: string;
  onQuery: (v: string) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  quick: QuickFilter;
  onQuick: (v: QuickFilter) => void;
  quickCounts: Record<QuickFilter, number>;
  /** «Не проверены» is an office filter: offered there (or while it is the active one). */
  showUnreviewed: boolean;
  tags: ReadonlyArray<readonly [string, number]>;
  tagFilter: string[];
  onTagFilter: (next: string[]) => void;
  /** «Свернуть / развернуть все папки» (folder view of the library column only). */
  collapse?: { allOpen: boolean; onToggle: () => void } | null;
  resultCount?: number;
  /** «Сбросить» after the chips: the page also clears its search. */
  onResetAll: () => void;
}) {
  const { t } = playbookI18n.useT();
  const filtersCount = (sort !== "folder" ? 1 : 0) + (quick !== "all" ? 1 : 0) + tagFilter.length;
  const resetFilters = () => { onSort("folder"); onQuick("all"); onTagFilter([]); };
  const chips: ActiveFilter[] = [
    ...(sort !== "folder" ? [{ key: "sort", label: t("page.sortChip", { label: t(`page.sort.${sort}.label`) }), onRemove: () => onSort("folder") }] : []),
    ...(quick !== "all" ? [{ key: "quick", label: t(`page.filter.${quick}.label`), onRemove: () => onQuick("all") }] : []),
    ...tagFilter.map((tag) => ({ key: `tag:${tag}`, label: `#${tag}`, removeLabel: tag, onRemove: () => onTagFilter(tagFilter.filter((x) => x !== tag)) })),
  ];
  const quickKeys = FILTER_KEYS.filter((f) => f !== "unreviewed" || showUnreviewed || quick === "unreviewed");

  const row = (
    <>
      <ToolbarSearch
        value={query}
        onChange={onQuery}
        placeholder={t("page.searchPlaceholder")}
        inputRef={inputRef}
        onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); onSearchKeyDown?.(e); }}
        className={inline ? "basis-0" : "sm:max-w-80"}
      />
      <FiltersButton count={filtersCount} onReset={resetFilters} resultCount={resultCount} width="md">
        <FilterSection title={t("page.listView")}>
          <div role="group" aria-label={t("page.listView")} className="flex flex-wrap gap-1.5">
            {SORT_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={sort === k} onClick={() => onSort(k)} className={CHIP}>{t(`page.sort.${k}.label`)}</button>
            ))}
          </div>
        </FilterSection>
        <FilterSection title={t("page.filterAria")}>
          <div role="group" aria-label={t("page.filterAria")} className="flex flex-wrap gap-1.5">
            {quickKeys.map((k) => (
              <button key={k} type="button" aria-pressed={quick === k} onClick={() => onQuick(k)} className={CHIP}>
                {t(`page.filter.${k}.label`)}
                {k !== "all" && <span className="tabular-nums text-muted-foreground">{quickCounts[k]}</span>}
              </button>
            ))}
          </div>
        </FilterSection>
        {tags.length > 0 && (
          <FilterSection title={t("page.tagFilter")}>
            <p className="text-xs text-muted-foreground">{t("page.tagFilterHint")}</p>
            <div className="flex max-h-[min(40dvh,280px)] flex-wrap gap-1.5 overflow-y-auto">
              {tags.map(([tag, n]) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={tagFilter.includes(tag)}
                  onClick={() => onTagFilter(tagFilter.includes(tag) ? tagFilter.filter((x) => x !== tag) : [...tagFilter, tag])}
                  className={CHIP}
                >
                  {tag} <span className="tabular-nums text-muted-foreground">{n}</span>
                </button>
              ))}
            </div>
          </FilterSection>
        )}
      </FiltersButton>
      {collapse && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={collapse.allOpen ? t("page.collapseAll") : t("page.expandAll")}
          title={collapse.allOpen ? t("page.collapseAll") : t("page.expandAll")}
          onClick={collapse.onToggle}
          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground"
        >
          {collapse.allOpen ? <ChevronsDownUp aria-hidden="true" /> : <ChevronsUpDown aria-hidden="true" />}
        </Button>
      )}
    </>
  );

  const active = <ActiveFilters items={chips} onReset={() => { resetFilters(); onResetAll(); }} />;
  if (inline) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-1.5">{row}</div>
        {active}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Toolbar className="flex-nowrap">{row}</Toolbar>
      {active}
    </div>
  );
}
