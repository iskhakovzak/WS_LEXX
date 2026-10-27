/**
 * The analyst feed below `sm` (Волна 2 п. 2.11): one card per action instead of the 1000 px table — ticker + time,
 * the action and grade change, firm (weight), target, gap · RVOL and the usual reaction, then «в вотчлист / в план /
 * идея / …» as 40 px buttons, always visible. Same rows and order as ActionsTable (which stays from `sm` up); pages of
 * CARD_PAGE with «Показать ещё» (card-model.ts).
 */
import * as React from "react";
import { Delta } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GradeChange, Highlight, KindPill, Marks, ReactionChip, RowActions, TargetChange } from "./ActionRow";
import type { Row } from "./rows";
import { dayTitle, nyKey, nyTime, sessionOf, WEIGHT_MIN_N } from "./lib";
import { CARD_PAGE, cardPage, cardSignal, nextPageCount, rvolText } from "./card-model";
import { analystI18n } from "@/i18n/ns/analyst";
/** The table's props a card needs (no sorting / keyboard focus on a phone). */
type CardsProps = {
  rows: Row[];
  query: string;
  today: string;
  canEdit: boolean;
  inPlan: (t: string) => boolean;
  addingWatch: string | null;
  addingPlan: string | null;
  onOpen: (r: Row) => void;
  onAddWatch: (r: Row) => void;
  onAddPlan: (r: Row) => void;
  onFilterFirm: (firm: string) => void;
  onFilterTicker: (ticker: string) => void;
  className?: string;
};

export function ActionCards({ rows, className, ...rest }: CardsProps) {
  const { t } = analystI18n.useT();
  const [limit, setLimit] = React.useState(CARD_PAGE);
  // A new filter / sort starts from the first page again (a quote refresh keeps the rows' order and count: no reset).
  const listKey = `${rows.length}:${rows[0]?.a.id ?? ""}`;
  React.useEffect(() => { setLimit(CARD_PAGE); }, [listKey]);
  const { shown, rest: left } = cardPage(rows, limit);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ul className="flex flex-col gap-2" aria-label={t("table.aria")}>
        {shown.map((r) => <ActionCard key={r.a.id} r={r} {...rest} />)}
      </ul>
      {left > 0 && (
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setLimit((n) => n + nextPageCount(left))}>
          {t("cards.more", { count: nextPageCount(left), total: rows.length })}
        </Button>
      )}
    </div>
  );
}

function ActionCard({ r, query, today, canEdit, inPlan, addingWatch, addingPlan, onOpen, onAddWatch, onAddPlan, onFilterFirm, onFilterTicker }: Omit<CardsProps, "rows" | "className"> & { r: Row }) {
  const { t } = analystI18n.useT();
  const a = r.a;
  const day = nyKey(a.gradedAt).slice(0, 10);
  const session = sessionOf(a.gradedAt);
  const s = cardSignal(r);
  const w = r.weight && r.weight.n >= WEIGHT_MIN_N ? r.weight : null;
  return (
    <li className={cn("tile flex flex-col gap-2 p-3", r.held.length > 0 && "ring-1 ring-warn/40")}>
      <button type="button" onClick={() => onOpen(r)} aria-label={t("table.historyAria", { ticker: a.ticker })} className="flex min-h-11 w-full flex-col gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="text-base font-semibold tracking-tight text-foreground"><Highlight text={a.ticker} query={query} /></span>
          <Marks held={r.held} watched={r.watched} traded={r.traded} />
          <span className={cn("ml-auto shrink-0 text-xs tabular-nums", session === "pre" && day === today ? "text-primary" : "text-muted-foreground")}>
            {nyTime(a.gradedAt)} · {day === today ? (session === "pre" ? t("table.premarket") : t("table.today")) : dayTitle(day, today).toLowerCase()}
          </span>
        </span>
        {a.longName && <span className="truncate text-2xs text-muted-foreground">{a.longName}</span>}
        <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
          <KindPill kind={a.action} />
          <GradeChange from={a.fromGrade} to={a.toGrade} className="max-w-full" />
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate text-foreground"><Highlight text={a.firm} query={query} /></span>
          {r.top && <span className="shrink-0 rounded-full bg-primary/12 px-1.5 text-2xs font-medium text-accent-soft">{t("table.top")}</span>}
          {w && <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{t("table.weight")} ×{w.ratio?.toFixed(1) ?? "—"}</span>}
        </span>
        <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <TargetChange action={a} price={r.quote?.price} showUpside={false} />
          <span className="flex items-center gap-2 text-xs">
            {s.gap != null ? <Delta value={s.gap} suffix="%" bare showIcon={false} /> : <span className="text-muted-foreground">—</span>}
            {s.rvol != null && <span className={cn("tabular-nums", s.rvolStrong ? "font-medium text-foreground" : "text-muted-foreground")}>{rvolText(s.rvol)}</span>}
            <ReactionChip agg={r.reaction} />
          </span>
        </span>
      </button>
      <RowActions
        action={a}
        watched={r.watched}
        inPlan={inPlan(a.ticker)}
        addingWatch={addingWatch === a.ticker}
        addingPlan={addingPlan === a.ticker}
        canEdit={canEdit}
        onAddWatch={() => onAddWatch(r)}
        onAddPlan={() => onAddPlan(r)}
        onOpen={() => onOpen(r)}
        onFilterFirm={() => onFilterFirm(a.firm)}
        onFilterTicker={() => onFilterTicker(a.ticker)}
        className="justify-end border-t border-[var(--glass-border)] pt-1 [&_button]:h-10 [&_button]:w-10"
      />
    </li>
  );
}
