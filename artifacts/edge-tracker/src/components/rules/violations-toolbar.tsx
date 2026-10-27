/**
 * The violations list's toolbar (design audit wave 3): status as the one Segmented (only statuses that have rows),
 * «Фильтры» with the rule chips and the archive switch, the counters at the end; the active filters as chips below.
 */
import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { FilterChip, Segmented, Toolbar } from "@/components/ds";
import { ActiveFilters, FilterSection, FiltersButton } from "@/components/shared/filters/filter-toolbar";
import { rulesI18n } from "@/i18n/ns/rules";
import { rich } from "./rich";
import type { Violation, ViolationStatus } from "./types";

export type StatusFilter = "all" | ViolationStatus;
const STATUS_FILTERS: StatusFilter[] = ["all", "open", "acknowledged", "resolved"];

export function ViolationsToolbar({
  violations, statusFilter, onStatus, byRule, ruleFilter, onRule, showArchive, onToggleArchive, archiveToggle, onReset, shownOf, openCount,
}: {
  violations: Violation[];
  statusFilter: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  byRule: [number, { name: string; count: number }][];
  ruleFilter: number | null;
  onRule: (id: number | null) => void;
  showArchive: boolean;
  onToggleArchive?: (v: boolean) => void;
  archiveToggle: ReactNode;
  onReset: () => void;
  /** The list is capped: «показано N из M». */
  shownOf: { shown: number; total: number } | null;
  /** New violations the owner should look at (0 hides the note). */
  openCount: number;
}) {
  const { t } = rulesI18n.useT();
  return (
    <>
      <Toolbar>
        <Segmented<StatusFilter>
          ariaLabel={t("violations.statusAria")}
          value={statusFilter}
          onChange={onStatus}
          options={STATUS_FILTERS.flatMap((f) => {
            const n = f === "all" ? violations.length : violations.filter((v) => v.status === f).length;
            return f !== "all" && n === 0 && statusFilter !== f ? [] : [{ value: f, label: t(`violations.filters.${f}`), count: n }];
          })}
        />
        {(byRule.length > 1 || onToggleArchive) && (
          <FiltersButton count={(ruleFilter != null ? 1 : 0) + (showArchive ? 1 : 0)} onReset={onReset}>
            {byRule.length > 1 && (
              <FilterSection title={t("violations.ruleTitle")}>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("violations.ruleAria")}>
                  <FilterChip size="sm" active={ruleFilter == null} onClick={() => onRule(null)} count={violations.length}>
                    {t("violations.allRules")}
                  </FilterChip>
                  {byRule.map(([id, r]) => (
                    <FilterChip key={id} size="sm" active={ruleFilter === id} onClick={() => onRule(ruleFilter === id ? null : id)} count={r.count}>
                      {r.name}
                    </FilterChip>
                  ))}
                </div>
              </FilterSection>
            )}
            {archiveToggle && <FilterSection>{archiveToggle}</FilterSection>}
          </FiltersButton>
        )}
        <span className="ml-auto" />
        {shownOf && <span className="text-xs tabular-nums text-muted-foreground">{t("violations.shownOf", shownOf)}</span>}
        {openCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-warn">
            <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{rich(t("violations.newCount", { count: "{count}" }), { count: <span className="font-semibold tabular-nums">{openCount}</span> })}</span>
          </span>
        )}
      </Toolbar>
      <ActiveFilters
        items={[
          ruleFilter != null && { key: "rule", label: byRule.find(([id]) => id === ruleFilter)?.[1].name ?? t("ruleFallback"), onRemove: () => onRule(null) },
          showArchive && !!onToggleArchive && { key: "archive", label: t("violations.archiveChip"), onRemove: () => onToggleArchive?.(false) },
        ]}
        onReset={onReset}
      />
    </>
  );
}
