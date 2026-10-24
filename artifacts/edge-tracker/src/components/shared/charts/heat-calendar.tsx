/**
 * <HeatCalendar> — the month P&L heatmap shared by /stats and /journal.
 *
 * Columns = the given weekdays + a weekly totals column; each cell is tinted by its value relative to the period max
 * (heat.ts); empty days, break-even days and profit / loss days are visually distinct. Hover or keyboard focus shows a
 * glass tooltip; the grid is one tab stop with arrow-key navigation (← → by day, ↑ ↓ by week, Home / End — the row's
 * ends, Enter / Space — activate). The host owns the data, the month and what activation does.
 */
import * as React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { getBeRange, subscribeBeRange } from "@/lib/appearance/be-range";
import { chartsI18n } from "@/i18n/ns/charts";
import { HEAT_BE, HEAT_FLAT, heatFill, heatKind, heatRamp } from "./heat";
import { TooltipCard, type TooltipRow } from "./tooltip";
import { pnlTextClass } from "./theme";

export interface HeatDay {
  /** YYYY-MM-DD. */
  date: string;
  /** Day number shown in the corner. */
  dayNum: number;
  inMonth: boolean;
  /** The day has trades (otherwise it is an empty day, not a break-even one). */
  traded: boolean;
  /** Signed value that picks hue and intensity (null for a traded day without a value → neutral). */
  value: number | null;
  /** Compact value text inside the cell. */
  valueText?: string;
  /** Second line (e.g. trade count) — hidden on phones. */
  sub?: string;
  /** Full accessible label of the cell. */
  label: string;
  tipTitle?: React.ReactNode;
  tipRows?: TooltipRow[];
  /** Small mark in the corner (review state…). */
  adornment?: React.ReactNode;
  today?: boolean;
  active?: boolean;
  /** Weekend / outside the trading week: quieter. */
  quiet?: boolean;
  /** Not clickable (e.g. stats: empty day). */
  disabled?: boolean;
  /** Fill override for a traded day without a value (e.g. tinted by wins − losses). */
  fill?: string;
}

export interface HeatWeekTotal {
  value: number | null;
  /** Shown only when the week has trades. */
  text: string;
  sub?: string;
  label: string;
  tipTitle?: React.ReactNode;
  tipRows?: TooltipRow[];
  href?: string;
  hrefTitle?: string;
}

export interface HeatWeek {
  key: string;
  days: HeatDay[];
  total: HeatWeekTotal | null;
}

export interface HeatCalendarProps {
  weeks: HeatWeek[];
  /** Column heads of the day columns (Mon-first). */
  weekdays: string[];
  /** Largest |value| of the period (intensity base). */
  max: number;
  /** "accent" — a count metric (one hue, no sign). */
  hue?: "pnl" | "accent";
  ariaLabel: string;
  onActivate?: (date: string) => void;
  /** Values inside the cells on phones too (default: only the tint + day number below sm). */
  phoneValues?: boolean;
  /** Days of the neighbouring months that fill the first / last week: shown faded and usable (default: blank). */
  showOutside?: boolean;
  className?: string;
  legend?: boolean;
  legendExtra?: React.ReactNode;
}

type Pos = { r: number; c: number };
type CellFocus = {
  ref: (el: HTMLElement | null) => void;
  tabIndex: number;
  onFocus: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
};

export function HeatCalendar({
  weeks, weekdays, max, hue = "pnl", ariaLabel, onActivate, phoneValues = false, showOutside = false, className, legend = true, legendExtra,
}: HeatCalendarProps) {
  const { t } = chartsI18n.useT();
  // Re-render when the «Вид» break-even range changes (heat.ts reads it while colouring the days).
  React.useSyncExternalStore(subscribeBeRange, getBeRange, getBeRange);
  const keysId = React.useId();
  const cols = weekdays.length;
  const refs = React.useRef(new Map<string, HTMLElement>());
  const [tip, setTip] = React.useState<Pos | null>(null);
  const [focus, setFocus] = React.useState<Pos | null>(null);

  const navigable = (p: Pos) => {
    const w = weeks[p.r];
    if (!w) return false;
    if (p.c === cols) return !!w.total?.href;
    const d = w.days[p.c];
    return !!d && (d.inMonth || showOutside) && !d.disabled;
  };
  // The single tab stop: the active day, else today, else the first navigable cell.
  const home = React.useMemo<Pos | null>(() => {
    let first: Pos | null = null, today: Pos | null = null;
    for (let r = 0; r < weeks.length; r++) {
      for (let c = 0; c < cols; c++) {
        const d = weeks[r].days[c];
        if (!d || !d.inMonth || d.disabled) continue;
        if (d.active) return { r, c };
        if (d.today && !today) today = { r, c };
        if (!first) first = { r, c };
      }
    }
    return today ?? first;
  }, [weeks, cols]);
  const stop = focus && navigable(focus) ? focus : home;

  const move = (from: Pos, dr: number, dc: number): Pos | null => {
    let p = { ...from };
    for (let i = 0; i < 64; i++) {
      p = { r: p.r + dr, c: p.c + dc };
      if (p.c < 0) p = { r: p.r - 1, c: cols };
      if (p.c > cols) p = { r: p.r + 1, c: 0 };
      if (p.r < 0 || p.r >= weeks.length) return null;
      if (navigable(p)) return p;
    }
    return null;
  };
  const go = (p: Pos | null) => {
    if (!p) return;
    setFocus(p);
    setTip(p);
    refs.current.get(`${p.r}:${p.c}`)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = focus ?? stop;
    if (!cur || e.altKey || e.ctrlKey || e.metaKey) return;
    let next: Pos | null | undefined;
    switch (e.key) {
      case "ArrowLeft": next = move(cur, 0, -1); break;
      case "ArrowRight": next = move(cur, 0, 1); break;
      case "ArrowUp": next = move(cur, -1, 0); break;
      case "ArrowDown": next = move(cur, 1, 0); break;
      case "Home": next = move({ r: cur.r, c: -1 }, 0, 1); break;
      case "End": next = navigable({ r: cur.r, c: cols }) ? { r: cur.r, c: cols } : move({ r: cur.r, c: cols }, 0, -1); break;
      case "Escape": setTip(null); return;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (next) go(next);
  };

  const ref = (p: Pos) => (el: HTMLElement | null) => {
    const k = `${p.r}:${p.c}`;
    if (el) refs.current.set(k, el); else refs.current.delete(k);
  };
  const focusProps = (p: Pos): CellFocus => ({
    ref: ref(p),
    tabIndex: stop && stop.r === p.r && stop.c === p.c ? 0 : -1,
    onFocus: (e: React.FocusEvent<HTMLElement>) => { setFocus(p); if (e.currentTarget.matches(":focus-visible")) setTip(p); },
    onBlur: () => setTip((x) => (x && x.r === p.r && x.c === p.c ? null : x)),
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === "mouse") setTip(p); },
    onPointerLeave: () => setTip((x) => (x && x.r === p.r && x.c === p.c ? null : x)),
  });

  const weekMax = Math.max(0, ...weeks.map((w) => Math.abs(w.total?.value ?? 0)));
  const tipSide = (p: Pos) => (p.c === 0 ? "left-0" : p.c >= cols - 1 ? "right-0" : "left-1/2 -translate-x-1/2");
  const tipV = (p: Pos) => (p.r === 0 ? "top-full mt-1.5" : "bottom-full mb-1.5");

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div
        role="grid"
        aria-label={ariaLabel}
        aria-describedby={keysId}
        onKeyDown={onKeyDown}
        className="grid gap-1 sm:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr)) minmax(2.75rem, 1.05fr)` }}
      >
        <div role="row" className="contents">
          {weekdays.map((w, i) => (
            <div key={`${w}-${i}`} role="columnheader" className={cn("pb-0.5 text-center text-2xs font-medium text-muted-foreground", i >= 5 && "opacity-70")}>{w}</div>
          ))}
          <div role="columnheader" className="border-l border-[var(--glass-border)] pb-0.5 text-center text-2xs font-medium text-muted-foreground">{t("heat.week")}</div>
        </div>

        {weeks.map((w, r) => (
          <div key={w.key} role="row" className="contents">
            {w.days.map((d, c) => {
              const p = { r, c };
              if (!d.inMonth && !showOutside) return <div key={d.date} role="gridcell" aria-hidden="true" className="min-h-[2.75rem] rounded-lg sm:min-h-[4rem]" />;
              const kind = heatKind(d.value, d.traded);
              const fill = kind === "up" || kind === "down" ? heatFill(d.value, max, hue) : kind === "be" ? HEAT_BE : kind === "flat" ? d.fill ?? HEAT_FLAT : undefined;
              const showTip = tip && tip.r === r && tip.c === c && (d.tipRows?.length || d.tipTitle);
              return (
                <div key={d.date} role="gridcell" className="relative min-w-0" aria-selected={d.active || undefined}>
                  <button
                    type="button"
                    {...focusProps(p)}
                    disabled={d.disabled}
                    aria-pressed={d.active}
                    aria-label={d.label}
                    aria-current={d.today ? "date" : undefined}
                    onClick={() => onActivate?.(d.date)}
                    style={fill ? { backgroundColor: fill } : undefined}
                    className={cn(
                      "flex h-full min-h-[2.75rem] w-full min-w-0 flex-col justify-between rounded-lg p-1 text-left transition-[box-shadow,background-color] duration-[var(--dur-1)] sm:min-h-[4rem] sm:p-1.5",
                      kind === "empty" ? "border border-dashed border-[hsl(var(--border)/0.7)]" : "border border-transparent",
                      d.quiet && kind === "empty" && "opacity-60",
                      !d.inMonth && "opacity-45",
                      !d.disabled && "hover:ring-1 hover:ring-[hsl(var(--foreground)/0.25)]",
                      d.active && "ring-2 ring-primary",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-1">
                      <span className={cn(
                        "grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs tabular-nums",
                        d.today ? "bg-primary font-semibold text-primary-foreground" : kind === "empty" ? "text-muted-foreground" : "text-foreground/80",
                      )}>{d.dayNum}</span>
                      {d.adornment}
                    </span>
                    {d.traded && d.valueText != null && (
                      <span className={cn("w-full min-w-0 flex-col leading-tight", phoneValues ? "flex" : "hidden sm:flex")}>
                        <span className={cn("truncate font-semibold tabular-nums text-foreground", cols > 5 ? "text-2xs tracking-tight lg:text-xs" : "text-2xs sm:text-xs")}>{d.valueText}</span>
                        {d.sub && <span className="hidden truncate text-2xs tabular-nums text-foreground/70 md:block">{d.sub}</span>}
                      </span>
                    )}
                  </button>
                  {showTip && (
                    <TooltipCard
                      title={d.tipTitle}
                      rows={d.tipRows ?? []}
                      tone={hue === "pnl" ? "pnl" : "plain"}
                      className={cn("absolute z-raised w-max", tipSide(p), tipV(p))}
                    />
                  )}
                </div>
              );
            })}
            <WeekCell
              total={w.total}
              weekMax={weekMax}
              hue={hue}
              focus={focusProps({ r, c: cols })}
              tipClass={cn("absolute z-raised w-max right-0", tipV({ r, c: cols }))}
              showTip={!!tip && tip.r === r && tip.c === cols}
            />
          </div>
        ))}
      </div>

      <p id={keysId} className="sr-only">{t("heat.keys")}</p>
      {legend && <HeatLegend hue={hue} extra={legendExtra} />}
    </div>
  );
}

function WeekCell({ total, weekMax, hue, focus, tipClass, showTip }: {
  total: HeatWeekTotal | null;
  weekMax: number;
  hue: "pnl" | "accent";
  focus: CellFocus;
  tipClass: string;
  showTip: boolean;
}) {
  const traded = !!total && total.text !== "";
  // A quiet tint (a quarter of the day scale) so the column reads as totals, not as one more day; on a tint the value
  // wears the text colour (the hue and the sign carry profit / loss), untinted it wears the profit / loss tone.
  const fill = traded && hue === "pnl" ? heatFill(total!.value, weekMax * 4, hue) : undefined;
  const tone = fill ? "text-foreground" : hue === "pnl" && total ? pnlTextClass(total.value) : "text-foreground";
  const body = (
    <>
      <span className={cn("truncate text-2xs font-semibold tabular-nums sm:text-xs", traded ? tone : "text-muted-foreground")}>{traded ? total!.text : "—"}</span>
      {traded && total!.sub && <span className="hidden truncate text-2xs tabular-nums text-muted-foreground sm:block">{total!.sub}</span>}
    </>
  );
  const cls = "flex h-full min-h-[2.75rem] w-full min-w-0 flex-col items-center justify-center rounded-lg bg-[var(--glass-bg)] px-0.5 text-center sm:min-h-[4rem]";
  const style = fill ? { backgroundImage: `linear-gradient(${fill}, ${fill})` } : undefined;
  return (
    <div role="gridcell" className="relative min-w-0 border-l border-[var(--glass-border)] pl-1 sm:pl-1.5">
      {total?.href && traded ? (
        <Link
          href={total.href}
          {...focus}
          aria-label={total.label}
          title={total.hrefTitle}
          style={style}
          className={cn(cls, "outline-none transition-shadow hover:ring-1 hover:ring-[hsl(var(--foreground)/0.25)] focus-visible:ring-2 focus-visible:ring-ring")}
        >
          {body}
        </Link>
      ) : (
        <div className={cls} style={style} aria-label={total?.label} onPointerEnter={focus.onPointerEnter} onPointerLeave={focus.onPointerLeave}>{body}</div>
      )}
      {showTip && traded && total!.tipRows?.length ? (
        <TooltipCard rows={total!.tipRows} tone={hue === "pnl" ? "pnl" : "plain"} title={total!.tipTitle} className={tipClass} />
      ) : null}
    </div>
  );
}

/** Legend: empty · break-even · loss ramp · profit ramp (or one accent ramp for counts). */
export function HeatLegend({ hue = "pnl", extra, className }: { hue?: "pnl" | "accent"; extra?: React.ReactNode; className?: string }) {
  const { t } = chartsI18n.useT();
  const sw = "h-2.5 w-2.5 rounded-[3px]";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-muted-foreground", className)} title={t("heat.scale")}>
      <span className="inline-flex items-center gap-1.5"><span className={cn(sw, "border border-dashed border-[hsl(var(--border))]")} aria-hidden="true" />{t("heat.noTrades")}</span>
      {hue === "pnl" && <span className="inline-flex items-center gap-1.5"><span className={sw} style={{ backgroundColor: HEAT_FLAT }} aria-hidden="true" />{t("heat.flat")}</span>}
      {hue === "pnl" ? (
        <span className="inline-flex items-center gap-1.5">
          {t("heat.loss")}
          <span className="inline-flex gap-0.5" aria-hidden="true">
            {heatRamp("down").reverse().map((c) => <span key={c} className={sw} style={{ backgroundColor: c }} />)}
            {heatRamp("up").map((c) => <span key={c} className={sw} style={{ backgroundColor: c }} />)}
          </span>
          {t("heat.profit")}
        </span>
      ) : (
        <span className="inline-flex gap-0.5" aria-hidden="true">
          {heatRamp("primary").map((c) => <span key={c} className={sw} style={{ backgroundColor: c }} />)}
        </span>
      )}
      {extra}
    </div>
  );
}
