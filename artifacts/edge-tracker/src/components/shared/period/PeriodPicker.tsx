/**
 * The ONE period selector of the app (design audit wave 3): Сегодня · Неделя · Месяц · Квартал · Год · Всё · Период…
 * (lib/period-range PERIOD_PRESETS; windows end today). A page may show a subset (`presets`); a calendar-anchored report
 * (/office) passes its own `options`. Dense toolbars use `compact` (one «Месяц ▾» button with the same list).
 * The page's presets and one more
 * segment «Период…» that opens a small form with «с» / «по» dates (lib/period-range). Applied, the segment reads the
 * range itself («3–21 окт. 2026 г.»), so the choice is visible where it was made; clicking it again edits the range.
 * The form opens prefilled (the stored range, else the current preset's window), refuses from > to, and says which
 * window the «к прошлому периоду» comparison uses when the page compares (`comparePrev`).
 * Phones (< 768 px) get one native select instead of the segment row (design audit wave 2B: the period is one control,
 * not a strip that runs off the screen); «Период…» in it opens the same form.
 */
import * as React from "react";
import { CalendarRange, ChevronDown } from "lucide-react";
import { Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtDateRange } from "@/lib/format";
import { PERIOD_PRESETS, draftRange, prevDayRange, presetRange as presetWindow, rangeDays, rangeError, type DayRange, type PeriodPreset } from "@/lib/period-range";
import { commonI18n } from "@/i18n/ns/common";

export const CUSTOM_PERIOD = "custom" as const;
const MENU_ROW = "flex min-h-9 items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11";
export type WithCustom<P extends string> = P | typeof CUSTOM_PERIOD;

/** «3–21 окт. 2026 г.» — the label of an applied range (also for page headings). */
export function fmtDayRange(r: DayRange): string {
  return fmtDateRange(r.from, r.to, "short");
}

type PeriodOption<P extends string> = { value: P; label: React.ReactNode; title?: string };

/** The vocabulary as picker options (labels follow the UI language — call in render). */
export function periodPresetOptions(presets: readonly PeriodPreset[] = PERIOD_PRESETS): PeriodOption<PeriodPreset>[] {
  const t = commonI18n.t;
  return presets.map((p) => ({ value: p, label: t(`periodPicker.presets.${p}`), title: t(`periodPicker.hints.${p}`) }));
}

/** «Месяц» / «3–21 окт.» — the short label of a period value (summary lines, chips). */
export function periodLabel(value: string, custom: DayRange | null): string {
  if (value === CUSTOM_PERIOD) return custom ? fmtDayRange(custom) : commonI18n.t("periodPicker.custom");
  return (PERIOD_PRESETS as readonly string[]).includes(value) ? commonI18n.t(`periodPicker.presets.${value as PeriodPreset}`) : value;
}

export function PeriodPicker<P extends string = PeriodPreset>({
  options: optionsProp, presets, value, custom, onPreset, onCustom, presetRange, today, ariaLabel, size = "md", comparePrev = false, compact = false, className,
}: {
  /** Own options (calendar-anchored reports); default: the vocabulary, or the `presets` subset of it. */
  options?: ReadonlyArray<PeriodOption<P>>;
  /** A subset of the vocabulary, in its order. */
  presets?: readonly PeriodPreset[];
  value: WithCustom<P>;
  /** The applied custom range (kept when a preset is picked, so «Период…» reopens on it). */
  custom: DayRange | null;
  onPreset: (p: P) => void;
  onCustom: (r: DayRange) => void;
  /** The window of the current preset — the form's prefill before any custom range was chosen (default: the vocabulary's). */
  presetRange?: { from?: string | null; to?: string | null } | null;
  /** YYYY-MM-DD: the latest day the inputs allow. */
  today: string;
  ariaLabel?: string;
  /** One dropdown button instead of the segment row (toolbars with a search and a mode). Phones always get a select. */
  compact?: boolean;
  size?: "sm" | "md";
  /** The page compares with the previous window: the form names it. */
  comparePrev?: boolean;
  className?: string;
}) {
  const t = commonI18n.t;
  const options = (optionsProp ?? periodPresetOptions(presets)) as ReadonlyArray<PeriodOption<P>>;
  const label = ariaLabel ?? t("periodPicker.aria");
  const presetWin = presetRange ?? ((PERIOD_PRESETS as readonly string[]).includes(value) ? presetWindow(value as PeriodPreset, today) : null);
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"menu" | "form">("form");
  const [draft, setDraft] = React.useState<DayRange>(() => draftRange(custom, presetWin, today));
  const fromId = React.useId();
  const toId = React.useId();
  const errId = React.useId();
  const active = value === CUSTOM_PERIOD && custom;
  const isMobile = useIsMobile();

  const openForm = () => {
    setDraft(draftRange(value === CUSTOM_PERIOD ? custom : null, value === CUSTOM_PERIOD ? null : presetWin, today));
    setMode("form");
    setOpen(true);
  };
  const current = options.find((o) => o.value === value);
  const err = rangeError(draft);
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (err) return;
    onCustom(draft);
    setOpen(false);
  };

  const segs = [
    ...options.map((o) => ({ value: o.value as string, label: o.label, title: o.title })),
    {
      value: CUSTOM_PERIOD as string,
      label: (
        <>
          <CalendarRange aria-hidden="true" />
          {active ? fmtDayRange(active) : t("periodPicker.custom")}
        </>
      ),
      title: t("periodPicker.customAria"),
    },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className={cn("inline-flex max-w-full", className)}>
          {isMobile ? (
            <span className="glass-field relative inline-flex h-10 max-w-full items-center rounded-full">
              <select
                aria-label={label}
                value={value}
                onChange={(e) => (e.target.value === CUSTOM_PERIOD ? openForm() : onPreset(e.target.value as P))}
                className="h-full max-w-full appearance-none truncate rounded-full bg-transparent pl-3.5 pr-8 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {options.map((o) => <option key={o.value} value={o.value}>{typeof o.label === "string" ? o.label : String(o.value)}</option>)}
                <option value={CUSTOM_PERIOD}>{active ? fmtDayRange(active) : t("periodPicker.custom")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </span>
          ) : compact ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-haspopup="menu"
              aria-expanded={open && mode === "menu"}
              aria-label={`${label}: ${active ? fmtDayRange(active) : typeof current?.label === "string" ? current.label : value}`}
              onClick={() => { setMode("menu"); setOpen((o) => !o || mode !== "menu"); }}
              className="h-9 gap-1.5 font-medium"
            >
              <CalendarRange aria-hidden="true" />
              <span className="tabular-nums">{active ? fmtDayRange(active) : current?.label ?? t("periodPicker.custom")}</span>
              <ChevronDown className="opacity-60" aria-hidden="true" />
            </Button>
          ) : (
            <Segmented<string>
              ariaLabel={label}
              size={size}
              value={value}
              options={segs}
              onChange={(v) => (v === CUSTOM_PERIOD ? openForm() : onPreset(v as P))}
            />
          )}
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className={mode === "menu" ? "w-64 p-1.5" : "w-[22rem]"}>
        {mode === "menu" ? (
          <div role="menu" aria-label={label} className="flex flex-col">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={o.value === value}
                onClick={() => { onPreset(o.value); setOpen(false); }}
                className={cn(MENU_ROW, o.value === value && "bg-[var(--glass-hover-bg)] font-semibold")}
              >
                <span>{o.label}</span>
                {o.title && <span className="text-xs font-normal text-muted-foreground">{o.title}</span>}
              </button>
            ))}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={value === CUSTOM_PERIOD}
              onClick={openForm}
              className={cn(MENU_ROW, "mt-1 justify-start border-t border-border", value === CUSTOM_PERIOD && "font-semibold")}
            >
              <CalendarRange className="h-4 w-4" aria-hidden="true" />
              {active ? fmtDayRange(active) : t("periodPicker.custom")}
            </button>
          </div>
        ) : (
        <form onSubmit={apply} className="flex flex-col gap-3" aria-label={t("periodPicker.title")}>
          <p className="text-sm font-semibold">{t("periodPicker.title")}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={fromId} className="text-xs text-muted-foreground">{t("periodPicker.from")}</Label>
              <Input
                id={fromId} type="date" value={draft.from} max={today} aria-invalid={err === "order" || undefined} aria-describedby={err ? errId : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="h-9 px-2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={toId} className="text-xs text-muted-foreground">{t("periodPicker.to")}</Label>
              <Input
                id={toId} type="date" value={draft.to} max={today} aria-invalid={err === "order" || undefined} aria-describedby={err ? errId : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="h-9 px-2"
              />
            </div>
          </div>
          {err ? (
            <p id={errId} role="alert" className="text-xs text-down">{t(`periodPicker.${err}`)}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {commonI18n.t("units.days", { count: rangeDays(draft) })}
              {comparePrev && ` · ${t("periodPicker.prevNote", { range: fmtDayRange(prevDayRange(draft)) })}`}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("periodPicker.cancel")}</Button>
            <Button type="submit" size="sm" disabled={!!err}>{t("periodPicker.apply")}</Button>
          </div>
        </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
