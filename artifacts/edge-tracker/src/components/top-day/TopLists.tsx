/**
 * «Топ дня» — the chosen day: desk summary, «Топ‑10 прибыль» and «Топ‑10 убыток» side by side (stacked on phones) and
 * the viewer's own place when they are outside both lists. A row opens that trader-day (TraderDaySheet).
 */
import * as React from "react";
import { TrendingDown, TrendingUp, UserRound } from "lucide-react";
import { EmptyState, Panel, toneOf, toneText } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { cn } from "@/lib/utils";
import { fmtDate, fmtUsd } from "@/lib/format";
import { personInitials, personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { topDayI18n } from "@/i18n/ns/topDay";
import type { TopDay, TopRow } from "./api";
import { myDayParts } from "./model";
import { displayTicker } from "@/lib/option-symbol";

/** «Трейдер 3» / «Я» / the real name (staff, named mode). */
export function whoLabel(row: { me: boolean; name: string | null; alias: number }): string {
  if (row.me) return topDayI18n.t("me");
  if (row.name) return personName(row.name);
  return topDayI18n.t("trader", { n: row.alias });
}

/**
 * The avatar circle: «Я» for the viewer, initials when the name is known (staff), else a person icon — never the alias
 * number, which read as a second rank next to the place (OWNER-24); the «Трейдер N» label carries the alias.
 */
export function AliasBadge({ row, className }: { row: { me: boolean; alias: number; name?: string | null }; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
        row.me ? "bg-primary-solid text-primary-foreground" : "bg-[var(--glass-bg)] text-foreground ring-1 ring-[var(--glass-border)]",
        className,
      )}
    >
      {row.me ? topDayI18n.t("me").slice(0, 1) : row.name ? personInitials(row.name) : <UserRound className="h-3.5 w-3.5 text-muted-foreground" />}
    </span>
  );
}

const MAX_CHIPS = 3;

/** `onOpen` absent: another trader's day, which only staff may open (own trades only, owner rule 2026-10-21). */
function Row({ row, onOpen }: { row: TopRow; onOpen?: (alias: number) => void }) {
  const { t } = topDayI18n.useT();
  const who = whoLabel(row);
  const chips = row.tickers.slice(0, MAX_CHIPS);
  const more = row.tickers.length - chips.length;
  const Tag = onOpen ? "button" : "div";
  return (
    <li>
      <Tag
        {...(onOpen ? { type: "button" as const, onClick: () => onOpen(row.alias), "aria-label": t("day.open", { who }) } : {})}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left",
          onOpen && "transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          row.me && "bg-primary/8",
        )}
      >
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{row.place > 0 ? row.place : ""}</span>
        <AliasBadge row={row} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm font-semibold", row.me && "text-primary")} title={who}>{who}</span>
            <span className={cn("shrink-0 text-sm font-semibold tabular-nums", toneText(toneOf(row.net)))}>
              {row.net != null ? fmtUsd(row.net, { signed: true, decimals: "auto" }) : "—"}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
            <span className="tabular-nums">{commonI18n.t("units.tradesShort", { count: row.trades })}</span>
            {chips.map((c) => (
              <span key={c.ticker} title={c.ticker} className={cn("chip px-1.5 py-0.5 font-medium tabular-nums", c.net != null && toneText(toneOf(c.net)))}>
                {displayTicker(c.ticker)}
              </span>
            ))}
            {more > 0 && <span className="tabular-nums">{t("day.more", { count: more })}</span>}
          </span>
        </span>
      </Tag>
    </li>
  );
}

function List({ title, icon, rows, empty, onOpen, staff }: { title: string; icon: React.ReactNode; rows: TopRow[]; empty: string; onOpen: (alias: number) => void; staff: boolean }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {rows.length ? (
        <ol className="flex flex-col gap-0.5">
          {rows.map((r) => <Row key={r.alias} row={r} onOpen={staff || r.me ? onOpen : undefined} />)}
        </ol>
      ) : (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

/** A trader's own day (2.14): R and the win share first, the own $ after — no place by loss. */
function MyDay({ me, onOpen }: { me: TopRow; onOpen: (alias: number) => void }) {
  const { t } = topDayI18n.useT();
  const p = myDayParts(me);
  const parts = [p.r, p.win ? t("day.winShare", { pct: p.win }) : null, commonI18n.t("units.tradesShort", { count: me.trades })].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={() => onOpen(me.alias)}
      className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-primary/40 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AliasBadge row={me} className="h-6 w-6 text-2xs" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-foreground">{t("day.myDay")}</span> <span className="tabular-nums">{parts}</span>
      </span>
      {p.net != null && <span className={cn("shrink-0 text-xs tabular-nums", toneText(toneOf(p.net)))}>{fmtUsd(p.net, { signed: true, decimals: "auto" })}</span>}
    </button>
  );
}

function MyPlace({ me, onOpen }: { me: TopRow; onOpen: (alias: number) => void }) {
  const { t } = topDayI18n.useT();
  const net = me.net != null ? fmtUsd(me.net, { signed: true, decimals: "auto" }) : "—";
  const text = (me.net ?? 0) > 0 ? t("day.myPlaceProfit", { place: me.place, net }) : (me.net ?? 0) < 0 ? t("day.myPlaceLoss", { place: me.place, net }) : t("day.myFlat");
  return (
    <button
      type="button"
      onClick={() => onOpen(me.alias)}
      className="flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/40 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AliasBadge row={me} className="h-6 w-6 text-2xs" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </button>
  );
}

export function TopLists({ date, q, onOpen }: {
  date: string | null;
  q: { data: TopDay | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  onOpen: (alias: number) => void;
}) {
  const { t } = topDayI18n.useT();
  const day = q.data;
  const title = date ? <span className="inline-block first-letter:uppercase">{fmtDate(date, date.slice(0, 4) === String(new Date().getFullYear()) ? "weekdayDayMonthLong" : "full")}</span> : t("title");
  const description = day && day.desk.traders > 0
    ? [
        day.desk.net != null ? t("day.desk", { net: fmtUsd(day.desk.net, { signed: true, decimals: "auto" }) }) : null,
        commonI18n.t("units.traders", { count: day.desk.traders }),
        commonI18n.t("units.trades", { count: day.desk.trades }),
      ].filter(Boolean).join(" · ")
    : undefined;

  let body: React.ReactNode;
  if (!date) body = <EmptyState title={t("day.pick")} className="py-10" />;
  else if (q.isError) body = <QueryError error={q.error} onRetry={() => q.refetch()} />;
  else if (!day || day.date !== date) body = <ListsSkeleton />;
  else if (!day.desk.traders) body = <EmptyState title={t("day.noTrades")} className="py-10" />;
  else {
    const inLists = day.me && [...day.profit, ...day.loss].some((r) => r.me);
    body = (
      <div className="flex flex-col gap-3">
        {day.me && day.mode !== "staff" && <MyDay me={day.me} onOpen={onOpen} />}
        {day.me && day.mode === "staff" && !inLists && <MyPlace me={day.me} onOpen={onOpen} />}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-3">
          <List title={t("day.profit")} icon={<TrendingUp className="h-3.5 w-3.5 text-up" aria-hidden="true" />} rows={day.profit} empty={t("day.emptyProfit")} onOpen={onOpen} staff={day.mode === "staff"} />
          <List title={t("day.loss")} icon={<TrendingDown className="h-3.5 w-3.5 text-down" aria-hidden="true" />} rows={day.loss} empty={t("day.emptyLoss")} onOpen={onOpen} staff={day.mode === "staff"} />
        </div>
      </div>
    );
  }

  return (
    <Panel title={title} description={description} bodyClassName="px-2 sm:px-3">
      {body}
    </Panel>
  );
}

function ListsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-busy="true" aria-label={topDayI18n.t("loading")}>
      {[0, 1].map((k) => (
        <div key={k} className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ))}
    </div>
  );
}
