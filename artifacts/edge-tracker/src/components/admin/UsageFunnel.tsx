/**
 * «Использование» → the daily-loop funnel (trader × step × the last 10 trading days, ✓ / · / ◐) and the inactive list.
 * Data: UsageOverview.funnel / .inactive (lib/usage/stats.ts on the server). Internal, admins only.
 */
import { useState } from "react";
import { EmptyState, Panel, Pill, Segmented, TableScroll } from "@/components/ds";
import { tierDisplay } from "@/components/shared/tier-labels";
import { personName } from "@/i18n";
import { fmtDate, fmtRelative, fmtWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usageI18n } from "@/i18n/ns/usage";
import type { FunnelTrader, InactiveTrader, UsageOverview } from "./usage-api";
import { STEPS, cellMark, defaultFilter, filterTraders, pilotFirst, stepBase, type FunnelFilter, type Mark } from "./usage-model";

const MARK: Record<Mark, { glyph: string; cls: string }> = {
  yes: { glyph: "✓", cls: "text-up font-semibold" },
  part: { glyph: "◐", cls: "text-warn" },
  no: { glyph: "·", cls: "text-muted-foreground" },
  none: { glyph: "", cls: "" },
};

function DayHead({ day, today }: { day: string; today: boolean }) {
  const { t } = usageI18n.useT();
  return (
    <th scope="col" className={cn("px-1 pb-1 text-center font-medium text-muted-foreground", today && "text-foreground")}>
      <span className="block text-2xs uppercase">{today ? t("funnel.today") : fmtWeekday(day, "short")}</span>
      <span className="block tabular-nums">{fmtDate(day, "dayMonthNumeric")}</span>
    </th>
  );
}

function TraderRows({ tr, days, today }: { tr: FunnelTrader; days: string[]; today: string }) {
  const { t } = usageI18n.useT();
  const name = personName(tr.name);
  return (
    <tbody>
      <tr>
        <th scope="rowgroup" colSpan={days.length + 2} className="px-1 pb-1 pt-3 text-left">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">{name}</span>
            {tr.tier && <Pill>{tierDisplay(tr.tier)}</Pill>}
            {tr.pilot && <Pill tone="accent">{t("funnel.pilotBadge")}</Pill>}
          </span>
        </th>
      </tr>
      {STEPS.map((step) => {
        const label = t(`funnel.steps.${step}`);
        const base = stepBase(step, tr);
        return (
          <tr key={step} className="hover:bg-[var(--glass-hover-bg)]">
            <th scope="row" title={t(`funnel.stepHelp.${step}`)} className="sticky left-0 z-raised whitespace-nowrap bg-[var(--sticky-bg)] py-0.5 pl-3 pr-2 text-left font-normal text-foreground/80">
              {label}
            </th>
            {days.map((d, i) => {
              const m = cellMark(step, tr, i);
              const title = t("funnel.cellTitle", { trader: name, step: label, day: fmtDate(d, "dayMonthNumeric"), value: t(`funnel.cell.${m}`) });
              return (
                <td key={d} title={title} aria-label={title} className={cn("h-6 w-9 text-center tabular-nums", d === today && "bg-[var(--glass-bg)]", MARK[m].cls)}>
                  {MARK[m].glyph}
                </td>
              );
            })}
            <td className="whitespace-nowrap px-2 text-right tabular-nums text-muted-foreground">{base ? `${tr.totals[step]}/${base}` : "—"}</td>
          </tr>
        );
      })}
    </tbody>
  );
}

export function FunnelPanel({ data, onOpenSettings }: { data: UsageOverview; onOpenSettings?: () => void }) {
  const { t } = usageI18n.useT();
  const [picked, setPicked] = useState<FunnelFilter | null>(null);
  const filter = picked ?? defaultFilter(data);
  const rows = filterTraders(data.funnel.traders, filter);
  const counts: Record<FunnelFilter, number> = {
    pilot: filterTraders(data.funnel.traders, "pilot").length,
    trainees: filterTraders(data.funnel.traders, "trainees").length,
    all: data.funnel.traders.length,
  };
  const days = data.funnel.days;
  return (
    <Panel
      title={t("funnel.title")}
      description={t("funnel.description")}
      actions={
        <Segmented<FunnelFilter>
          ariaLabel={t("funnel.filterAria")}
          size="sm"
          value={filter}
          onChange={setPicked}
          options={(["pilot", "trainees", "all"] as const).map((v) => ({ value: v, label: t(`funnel.filter.${v}`), count: counts[v] }))}
        />
      }
    >
      <div className="mb-2 flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{data.trackedSince ? t("funnel.eventsNote", { date: fmtDate(data.trackedSince, "dayMonthLong") }) : t("funnel.eventsNone")}</p>
        {filter === "pilot" && !data.pilot.names.length && (
          <p>
            {t("funnel.pilotEmpty")}{" "}
            {onOpenSettings && <button type="button" onClick={onOpenSettings} className="underline underline-offset-2 hover:text-foreground">{t("status.settings")}</button>}
          </p>
        )}
        {data.pilot.unknown.length > 0 && <p className="text-warn">{t("funnel.pilotUnknown", { names: data.pilot.unknown.join(", ") })}</p>}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("funnel.empty")} className="py-8" />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-raised bg-[var(--sticky-bg)] px-1 pb-1 text-left font-medium text-muted-foreground">{t("funnel.trader")}</th>
                {days.map((d) => <DayHead key={d} day={d} today={d === data.today} />)}
                <th scope="col" className="px-2 pb-1 text-right font-medium text-muted-foreground">{t("funnel.total")}</th>
              </tr>
            </thead>
            {rows.map((tr) => <TraderRows key={tr.name} tr={tr} days={days} today={data.today} />)}
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

function InactiveRow({ r }: { r: InactiveTrader }) {
  const { t } = usageI18n.useT();
  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{personName(r.name)}</span>
        {r.tier && <Pill>{tierDisplay(r.tier)}</Pill>}
        {r.pilot && <Pill tone="accent">{t("funnel.pilotBadge")}</Pill>}
      </span>
      <span className="text-xs text-muted-foreground">
        <span className="font-medium text-warn">{r.capped ? t("inactive.missedCapped") : t("inactive.missed", { count: r.missedDays })}</span>
        {" · "}
        {r.lastSeen ? t("inactive.lastSeen", { when: fmtRelative(r.lastSeen) }) : t("inactive.never")}
      </span>
    </li>
  );
}

const INACTIVE_SHOWN = 8;

export function InactivePanel({ rows }: { rows: InactiveTrader[] }) {
  const { t } = usageI18n.useT();
  const [all, setAll] = useState(false);
  const sorted = pilotFirst(rows);
  const shown = all ? sorted : sorted.slice(0, INACTIVE_SHOWN);
  return (
    <Panel
      title={t("inactive.title")}
      description={t("inactive.description")}
      fill
      footer={sorted.length > INACTIVE_SHOWN ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {all ? t("inactive.showLess") : t("inactive.showAll", { count: sorted.length })}
        </button>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("inactive.empty")}</p>
      ) : (
        <ul className="divide-y divide-[var(--glass-border)]">{shown.map((r) => <InactiveRow key={r.name} r={r} />)}</ul>
      )}
    </Panel>
  );
}
