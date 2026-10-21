/**
 * The watchlist below `sm` (Волна 2 п. 2.11): one card per row instead of the 1000 px table — no horizontal scroll at
 * 375 px, the whole card opens the ticker sheet, the «…» menu (В план, идея, списки) is a 40 px target. Same rows,
 * order and actions as WatchlistTable (which stays for `sm` and up); selection / drag / inline notes are desktop-only.
 */
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { toneOf, toneText } from "@/components/ds";
import { fmtPct, fmtPrice } from "@/lib/format";
import { watchlistI18n } from "@/i18n/ns/watchlist";
import { LIST_LABELS, rowWritable } from "./lib";
import { EventMarks, HistoryCell, LevelCell } from "./bits";
import { RowMenu, type RowActions } from "./WatchlistRow";
import { cardFacts, type CardMetric, type WlRow } from "./card-model";

function Metric({ label, m, fmt }: { label: string; m: CardMetric; fmt: (v: number) => string }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className={cn("truncate text-xs tabular-nums", m.strong ? "font-semibold text-foreground" : "text-muted-foreground")}>{m.value != null ? fmt(m.value) : "—"}</div>
    </div>
  );
}

function Card({ r, showList, canEdit, me, actions, scoring, levelsLoading, quotesLoading, today }: {
  r: WlRow; showList: boolean; canEdit: boolean; me: string | null; actions: RowActions; scoring: boolean; levelsLoading: boolean; quotesLoading: boolean; today: string;
}) {
  const { t } = watchlistI18n.useT();
  const { isCurator } = useAuth();
  const { item, quote: q, plan } = r;
  const f = cardFacts(q);
  // Quotes come from an external feed (~1 s): a placeholder bar keeps the card from flashing «—» first.
  const loadingQuote = quotesLoading && !q;
  const mayModify = rowWritable(item, canEdit, me, isCurator);
  // The plan's alert as the card's left edge — the table's 3 px bar.
  const accent = plan.alert === "stop-hit" ? "border-l-[3px] border-l-down" : plan.alert === "target-hit" ? "border-l-[3px] border-l-up" : plan.alert ? "border-l-[3px] border-l-warn" : "";
  return (
    <li className={cn("tile p-0", accent, !r.list && "opacity-75", r.pending && "opacity-60")}>
      <div className="flex items-start gap-1">
        <button
          type="button"
          disabled={r.pending}
          onClick={() => actions.open(item)}
          aria-label={t("row.open") + ` ${item.ticker}`}
          className="flex min-h-11 min-w-0 flex-1 flex-col gap-2 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <span className="text-base font-semibold tracking-tight text-foreground">{item.ticker}</span>
            <EventMarks item={item} earnings={r.earnings} upcoming={r.upcoming} news={r.news} today={today} />
            {showList && <span className="shrink-0 rounded-full bg-[var(--glass-bg)] px-1.5 text-xs text-muted-foreground">{r.list ? LIST_LABELS[r.list] : t("list.archiveLower")}</span>}
            <span className="ml-auto shrink-0 text-right">
              {loadingQuote ? (
                <span className="flex flex-col items-end gap-1 py-0.5" aria-hidden="true">
                  <span className="block h-3.5 w-14 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                  <span className="block h-3 w-10 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                </span>
              ) : (
                <>
                  <span className="block text-sm font-medium tabular-nums text-foreground">{fmtPrice(f.price)}</span>
                  <span className={cn("block text-xs tabular-nums", toneText(toneOf(f.change)))}>{fmtPct(f.change, 2)}</span>
                </>
              )}
            </span>
          </span>
          <span className="grid w-full grid-cols-3 gap-2">
            <Metric label={t("table.gap")} m={f.gap} fmt={(v) => fmtPct(v, 1)} />
            <Metric label="rVol" m={f.rvol} fmt={(v) => `${v.toFixed(1)}×`} />
            <Metric label="ATR" m={f.atrPct} fmt={(v) => fmtPct(v, { decimals: 1, signed: false })} />
          </span>
          {item.notes && <span className="line-clamp-2 w-full text-xs text-muted-foreground">{item.notes}</span>}
        </button>
        {!r.pending && (
          <span className="shrink-0 p-1.5">
            <RowMenu item={item} list={r.list} canEdit={canEdit} canModify={mayModify} canPlan={!!me} actions={actions} scoring={scoring} triggerClassName="h-10 w-10" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--glass-border)] px-3 py-2">
        <span className="min-w-0"><LevelCell price={q?.price} levels={r.levels} keys={r.keys} loading={levelsLoading} /></span>
        <span className="min-w-0"><HistoryCell history={r.history} me={me} /></span>
      </div>
    </li>
  );
}

export function WatchlistCards({ rows, showList, canEdit, me, actions, scoringIds, levelsLoading, quotesLoading = false, today, className }: {
  rows: WlRow[]; showList: boolean; canEdit: boolean; me: string | null; actions: RowActions; scoringIds: Set<number>;
  levelsLoading: boolean; quotesLoading?: boolean; today: string; className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-2 p-2", className)} aria-label={watchlistI18n.t("table.ticker")}>
      {rows.map((r) => (
        <Card key={r.item.id} r={r} showList={showList} canEdit={canEdit} me={me} actions={actions} scoring={scoringIds.has(r.item.id)} levelsLoading={levelsLoading} quotesLoading={quotesLoading} today={today} />
      ))}
    </ul>
  );
}
