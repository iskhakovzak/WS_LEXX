/**
 * The scope row of /office (design audit wave 3): one Toolbar under the header — the years to compare, the calendar
 * period of the focus year (Год / Квартал / Месяц / Период… — the shared words, but calendar-anchored, unlike the
 * rolling analytics scope; the option hints say so), Q1–Q4 / the month when that mode is on, the unit (partners) and
 * «Фильтры (n)» with the «Разрезы» (partners). The page owns the state and its URL (./office-period).
 */
import { Segmented, Toolbar } from "@/components/ds";
import { cn } from "@/lib/utils";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { FiltersButton } from "@/components/shared/filters/filter-toolbar";
import { RangeFacetSections, rangeFacetCount, resetRangeFacets, type RangeFacets } from "@/components/shared/trade-facets/range-facets";
import type { DayRange } from "@/lib/period-range";
import { officeI18n } from "@/i18n/ns/officeStats";
import { commonI18n } from "@/i18n/ns/common";
import { monthLong, type Unit } from "./api";
import type { OfficeMode, OfficePreset } from "./office-period";

const PRESETS: OfficePreset[] = ["ytd", "quarter", "month"];

export function OfficeScopeBar({
  yearChoices, selYears, focusYear, onToggleYear, mode, custom, period, today, onMode, onCustom,
  quarter, onQuarter, maxQuarter, month, onMonth, maxMonth, unit, rf,
}: {
  yearChoices: number[];
  selYears: number[];
  focusYear: number;
  onToggleYear: (y: number) => void;
  mode: OfficeMode;
  custom: DayRange | null;
  /** The window of the current mode (the custom form's prefill). */
  period: DayRange;
  today: string;
  onMode: (m: OfficePreset) => void;
  onCustom: (r: DayRange) => void;
  quarter: number;
  onQuarter: (q: number) => void;
  /** The last quarter / month that has begun in the focus year (later ones are disabled). */
  maxQuarter: number;
  month: number;
  onMonth: (m: number) => void;
  maxMonth: number;
  /** Partners: % of capital / $. */
  unit: { value: Unit; onChange: (u: Unit) => void; capitalSet: boolean } | null;
  rf: RangeFacets;
}) {
  const { t } = officeI18n.useT();
  return (
    <Toolbar>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("filters.yearsAria")}>
        <span className="mr-1 text-xs text-muted-foreground">{t("filters.years")}</span>
        {yearChoices.map((y) => {
          const on = selYears.includes(y);
          return (
            <button
              key={y}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleYear(y)}
              className={cn(
                "min-h-8 rounded-full border px-3 text-sm font-medium tabular-nums transition-colors pointer-coarse:min-h-10",
                on ? "border-primary/40 bg-primary/12 text-foreground" : "border-[var(--glass-border)] text-muted-foreground hover:text-foreground",
                on && y === focusYear && "border-primary bg-primary/20",
              )}
              title={on && y === focusYear ? t("filters.yearFocus") : on ? t("filters.yearRemove") : t("filters.yearAdd")}
            >
              {y}
            </button>
          );
        })}
      </div>
      <PeriodPicker<OfficePreset>
        ariaLabel={t("period.label")} value={mode} custom={custom} presetRange={period} today={today} compact
        onPreset={onMode} onCustom={onCustom}
        options={PRESETS.map((value) => ({
          value, label: commonI18n.t(`periodPicker.presets.${value === "ytd" ? "year" : value}`), title: t(`period.hints.${value}`),
        }))}
      />
      {mode === "quarter" && (
        <Segmented<string> ariaLabel={t("period.quarter")} size="sm" value={String(quarter)} onChange={(v) => onQuarter(Number(v))}
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: t("period.quarterShort", { q: n }), disabled: n > maxQuarter }))} />
      )}
      {mode === "month" && (
        <select
          aria-label={t("period.month")}
          value={month}
          onChange={(e) => onMonth(Number(e.target.value))}
          className="glass-field h-9 rounded-full bg-transparent px-3 text-sm text-foreground"
        >
          {Array.from({ length: 12 }, (_, i) => monthLong(i)).map((m, i) => (
            <option key={i} value={i + 1} disabled={i + 1 > maxMonth}>{m}</option>
          ))}
        </select>
      )}
      {unit && (
        <Segmented<Unit>
          ariaLabel={t("filters.units")}
          size="sm"
          value={unit.value}
          onChange={unit.onChange}
          options={[{ value: "pct", label: t("filters.pctOfCapital"), disabled: !unit.capitalSet, title: unit.capitalSet ? undefined : t("filters.needCapital") }, { value: "usd", label: "$" }]}
        />
      )}
      {rf.enabled && (
        <FiltersButton count={rangeFacetCount(rf)} onReset={() => resetRangeFacets(rf)} width="xl" className="ml-auto">
          <RangeFacetSections rf={rf} />
        </FiltersButton>
      )}
    </Toolbar>
  );
}
