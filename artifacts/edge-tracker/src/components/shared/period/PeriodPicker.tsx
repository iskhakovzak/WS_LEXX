/**
 * The period selector of every trade-analysis page: the page's presets (7 / 30 / 90 days, YTD, all…) and one more
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
import { draftRange, prevDayRange, rangeDays, rangeError, type DayRange } from "@/lib/period-range";
import { commonI18n } from "@/i18n/ns/common";

export const CUSTOM_PERIOD = "custom" as const;
export type WithCustom<P extends string> = P | typeof CUSTOM_PERIOD;

/** «3–21 окт. 2026 г.» — the label of an applied range (also for page headings). */
export function fmtDayRange(r: DayRange): string {
  return fmtDateRange(r.from, r.to, "short");
}

export function PeriodPicker<P extends string>({
  options, value, custom, onPreset, onCustom, presetRange, today, ariaLabel, size = "md", comparePrev = false, className,
}: {
  options: ReadonlyArray<{ value: P; label: React.ReactNode }>;
  value: WithCustom<P>;
  /** The applied custom range (kept when a preset is picked, so «Период…» reopens on it). */
  custom: DayRange | null;
  onPreset: (p: P) => void;
  onCustom: (r: DayRange) => void;
  /** The window of the current preset — the form's prefill before any custom range was chosen. */
  presetRange?: { from?: string | null; to?: string | null } | null;
  /** YYYY-MM-DD: the latest day the inputs allow. */
  today: string;
  ariaLabel: string;
  size?: "sm" | "md";
  /** The page compares with the previous window: the form names it. */
  comparePrev?: boolean;
  className?: string;
}) {
  const t = commonI18n.t;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DayRange>(() => draftRange(custom, presetRange ?? null, today));
  const fromId = React.useId();
  const toId = React.useId();
  const errId = React.useId();
  const active = value === CUSTOM_PERIOD && custom;
  const isMobile = useIsMobile();

  const openForm = () => {
    setDraft(draftRange(value === CUSTOM_PERIOD ? custom : null, value === CUSTOM_PERIOD ? null : presetRange ?? null, today));
    setOpen(true);
  };
  const err = rangeError(draft);
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (err) return;
    onCustom(draft);
    setOpen(false);
  };

  const segs = [
    ...options.map((o) => ({ value: o.value as string, label: o.label })),
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
                aria-label={ariaLabel}
                value={value}
                onChange={(e) => (e.target.value === CUSTOM_PERIOD ? openForm() : onPreset(e.target.value as P))}
                className="h-full max-w-full appearance-none truncate rounded-full bg-transparent pl-3.5 pr-8 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {options.map((o) => <option key={o.value} value={o.value}>{typeof o.label === "string" ? o.label : String(o.value)}</option>)}
                <option value={CUSTOM_PERIOD}>{active ? fmtDayRange(active) : t("periodPicker.custom")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </span>
          ) : (
            <Segmented<string>
              ariaLabel={ariaLabel}
              size={size}
              value={value}
              options={segs}
              onChange={(v) => (v === CUSTOM_PERIOD ? openForm() : onPreset(v as P))}
            />
          )}
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-[22rem]">
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
      </PopoverContent>
    </Popover>
  );
}
