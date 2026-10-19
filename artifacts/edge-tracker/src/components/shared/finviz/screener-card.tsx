/**
 * «Утренний скринер» (Finviz Elite): gappers / relative volume / earnings today → ready candidates for the day.
 * Before the open it is the focal point (expanded, polls every 5 min); after the bell it folds into one line.
 * «В план» = one tap: the ticker joins «Мой план» of the day with a prefilled catalyst; «В плейбук» opens the playbook
 * sheet to pick the setup. Mounted on the day plan (desk view) and playbook «Сегодня».
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, Check, ChevronDown, ChevronUp, Plus, RefreshCw, ScanSearch } from "lucide-react";
import { ErrorState, Panel, Segmented, SortableTh, DataTable, usePersistentState, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastAction } from "@/components/ui/toast";
import { openSetupSheet } from "@/components/shared/playbook-sheet";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { BASE } from "@/lib/api";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtCompact, fmtDeskDate, fmtNum, fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { finvizI18n } from "@/i18n/ns/finviz";
import { screenerQuery, useAddToPlan, useFinvizRefresh, useFinvizStatus, usePlanTickerDoc } from "./api";
import { EarningsFlagPill, FinvizOff, useMinuteClock } from "./earnings";
import {
  DEFAULT_SORT, PLAN_MAX_TICKERS, SCREENER_PRESETS, catalystLine, earningsFlagOf, morningState, planTickers, rowMove, screenerSummary, sortRows,
  type ScreenerPreset, type ScreenerRow, type ScreenerSortKey,
} from "./model";

const SHOW = 8;

type RowActions = {
  inPlan: (ticker: string) => boolean;
  canPlan: boolean;
  adding: string | null;
  onAdd: (r: ScreenerRow) => void;
  planDate: string;
};

function MoveCell({ r, preset }: { r: ScreenerRow; preset: ScreenerPreset }) {
  const m = rowMove(r, preset);
  return <span className={cn("font-semibold tabular-nums", toneText(toneOf(m)))}>{fmtPct(m, 1)}</span>;
}

function Actions({ r, a, compact }: { r: ScreenerRow; a: RowActions; compact?: boolean }) {
  const { t } = finvizI18n.useT();
  const date = fmtDeskDate(a.planDate, "dayMonth");
  const has = a.inPlan(r.ticker);
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {a.canPlan && (
        <Button
          type="button"
          size="sm"
          variant={has ? "ghost" : "outline"}
          className="h-8 gap-1 px-2"
          disabled={has || a.adding === r.ticker}
          onClick={() => a.onAdd(r)}
          title={has ? t("screener.inPlanTitle", { ticker: r.ticker, date }) : t("screener.toPlanTitle", { ticker: r.ticker, date })}
          aria-label={has ? t("screener.inPlanTitle", { ticker: r.ticker, date }) : t("screener.toPlanTitle", { ticker: r.ticker, date })}
        >
          {has ? <Check className="h-4 w-4 text-up" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          <span className={cn(compact && "sr-only")}>{has ? t("screener.inPlan") : t("screener.toPlan")}</span>
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 gap-1 px-2"
        onClick={() => openSetupSheet()}
        title={t("screener.toPlaybookTitle", { ticker: r.ticker })}
        aria-label={t("screener.toPlaybookTitle", { ticker: r.ticker })}
        aria-haspopup="dialog"
      >
        <BookMarked className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only lg:not-sr-only">{t("screener.toPlaybook")}</span>
      </Button>
    </div>
  );
}

function RowBadge({ r, day }: { r: ScreenerRow; day: string }) {
  const flag = earningsFlagOf(r, day);
  return flag ? <EarningsFlagPill flag={flag} short /> : null;
}

/** Phone: one compact line per candidate (ticker · move · RVOL · float), actions on the right. */
function PhoneList({ rows, preset, a, day }: { rows: ScreenerRow[]; preset: ScreenerPreset; a: RowActions; day: string }) {
  return (
    <ul className="flex flex-col divide-y divide-border/50">
      {rows.map((r) => (
        <li key={r.ticker} className="flex min-w-0 items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-semibold">{r.ticker}</span>
              <MoveCell r={r} preset={preset} />
              <RowBadge r={r} day={day} />
            </div>
            <p className="truncate text-xs tabular-nums text-muted-foreground">
              {[
                r.relVolume != null ? `RVOL ${fmtNum(r.relVolume, 1)}` : null,
                r.float != null ? `Float ${fmtCompact(r.float)}` : null,
                r.shortFloatPct != null ? `SI ${fmtPct(r.shortFloatPct, { decimals: 1, signed: false })}` : null,
                r.price != null ? `$${fmtPrice(r.price)}` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Actions r={r} a={a} compact />
        </li>
      ))}
    </ul>
  );
}

const COLS: { key: ScreenerSortKey; label: "ticker" | "price" | "move" | "relVolume" | "float" | "shortFloat" | "atr" | "marketCap"; right?: boolean }[] = [
  { key: "ticker", label: "ticker" },
  { key: "move", label: "move", right: true },
  { key: "relVolume", label: "relVolume", right: true },
  { key: "float", label: "float", right: true },
  { key: "shortFloat", label: "shortFloat", right: true },
  { key: "atr", label: "atr", right: true },
  { key: "price", label: "price", right: true },
  { key: "marketCap", label: "marketCap", right: true },
];

function DeskTable({ rows, preset, a, day, sort, onSort }: {
  rows: ScreenerRow[]; preset: ScreenerPreset; a: RowActions; day: string;
  sort: { key: ScreenerSortKey; dir: "asc" | "desc" }; onSort: (k: ScreenerSortKey) => void;
}) {
  const { t } = finvizI18n.useT();
  return (
    <DataTable ariaLabel={t("screener.tableAria")}>
      <table>
        <thead>
          <tr>
            {COLS.map((c) => (
              <SortableTh key={c.key} active={sort.key === c.key} dir={sort.dir} onSort={() => onSort(c.key)} align={c.right ? "right" : "left"}>
                {t(`screener.cols.${c.label}`)}
              </SortableTh>
            ))}
            <th scope="col" className="text-right">{t("screener.cols.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker}>
              <td className="whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.ticker}</span>
                  <RowBadge r={r} day={day} />
                </div>
                {(r.company || r.sector) && (
                  <div className="max-w-[16rem] truncate text-xs text-muted-foreground" title={[r.company, r.sector].filter(Boolean).join(" · ")}>
                    {[r.company, r.sector].filter(Boolean).join(" · ")}
                  </div>
                )}
              </td>
              <td className="text-right"><MoveCell r={r} preset={preset} /></td>
              <td className="text-right">{fmtNum(r.relVolume, 1)}</td>
              <td className="text-right">{fmtCompact(r.float)}</td>
              <td className="text-right">{fmtPct(r.shortFloatPct, { decimals: 1, signed: false })}</td>
              <td className="text-right">{fmtNum(r.atr)}</td>
              <td className="text-right">{fmtPrice(r.price)}</td>
              <td className="text-right text-muted-foreground">{r.marketCap != null ? `$${fmtCompact(r.marketCap)}` : "—"}</td>
              <td className="text-right"><Actions r={r} a={a} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTable>
  );
}

/** Adds a row to the plan and says what happened (toast with «Открыть план»). */
function useAddRow(planDate: string) {
  const { t } = finvizI18n.useT();
  const add = useAddToPlan(planDate);
  const [adding, setAdding] = useState<string | null>(null);
  const onAdd = (r: ScreenerRow, preset: ScreenerPreset) => {
    const flag = earningsFlagOf(r, planDate);
    const earnings = flag ? t(`earnings.badge.${flag}`) : null;
    setAdding(r.ticker);
    add.mutate({ ticker: r.ticker, catalyst: catalystLine(r, preset, earnings) }, {
      onSettled: () => setAdding(null),
      onSuccess: (kind) => {
        const date = fmtDeskDate(planDate, "dayMonth");
        if (kind === "full") { toast({ title: t("screener.planFull", { max: PLAN_MAX_TICKERS }), variant: "destructive" }); return; }
        toast({
          title: kind === "exists" ? t("screener.alreadyInPlan", { ticker: r.ticker }) : t("screener.added", { ticker: r.ticker }),
          description: kind === "added" ? t("screener.addedHint", { date }) : undefined,
          action: (
            <ToastAction altText={t("screener.openPlan")} onClick={() => window.location.assign(`${BASE}${links.myPlan(planDate)}`)}>
              {t("screener.openPlan")}
            </ToastAction>
          ),
        });
      },
      onError: (e) => toast({ title: t("screener.addFailed", { ticker: r.ticker }), description: humanizeApiError(e), variant: "destructive" }),
    });
  };
  return { adding, onAdd };
}

function StaffRefresh() {
  const { t } = finvizI18n.useT();
  const refresh = useFinvizRefresh();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      title={t("screener.refresh")}
      aria-label={t("screener.refresh")}
      disabled={refresh.isPending}
      onClick={() =>
        refresh.mutate(undefined, {
          onSuccess: () => toast({ title: t("screener.refreshed") }),
          onError: (e) => toast({ title: t("screener.refreshFailed"), description: humanizeApiError(e), variant: "destructive" }),
        })
      }
    >
      <RefreshCw className={cn("h-4 w-4", refresh.isPending && "animate-spin")} aria-hidden="true" />
    </Button>
  );
}

/**
 * `planDate`: the personal plan «в план» writes to (the page's day: game plan date / playbook day); default = the
 * session the morning prepares for.
 */
export function MorningScreener({ planDate: planDateProp, className }: { planDate?: string; className?: string }) {
  const { t } = finvizI18n.useT();
  const now = useMinuteClock();
  const morning = morningState(now);
  const planDate = planDateProp ?? morning.planDate;
  const { state } = useFinvizStatus();
  const { user, isCurator, isAdmin, can } = useAuth();
  const me = user && user.role !== "guest" ? user.traderName : null;
  const canPlan = !!me && can("journal.write.own", { trader: me });
  const isMobile = useIsMobile();
  const [stored, setPreset] = usePersistentState<ScreenerPreset>("finviz.screener.preset", "gappers");
  const preset: ScreenerPreset = SCREENER_PRESETS.includes(stored) ? stored : "gappers";
  const [openPick, setOpen] = useState<boolean | null>(null);
  const open = openPick ?? morning.beforeOpen;
  const [all, setAll] = useState(false);
  const [sortPick, setSort] = useState<{ key: ScreenerSortKey; dir: "asc" | "desc" } | null>(null);
  const sort = sortPick ?? { key: DEFAULT_SORT[preset], dir: "desc" as const };

  const q = useQuery({ ...screenerQuery(preset, morning.beforeOpen && open), enabled: state === "on" });
  const planDoc = usePlanTickerDoc(planDate, canPlan && state === "on");
  const inPlanSet = planTickers(planDoc.data ?? null);
  const { adding, onAdd } = useAddRow(planDate);

  if (state === "loading") return <Skeleton className={cn("h-14 rounded-2xl", className)} />;
  if (state === "off") return <Panel className={className} padded={false} bodyClassName="px-[var(--panel-p)]"><FinvizOff /></Panel>;

  const rows = q.data ? sortRows(q.data.rows, sort.key, sort.dir, preset) : [];
  const summary = screenerSummary(q.data?.rows ?? [], preset);
  const shown = all ? rows : rows.slice(0, SHOW);
  const actions: RowActions = { inPlan: (x) => inPlanSet.has(x.toUpperCase()), canPlan, adding, onAdd: (r) => onAdd(r, preset), planDate };
  const updated = q.data?.asOf ? t("screener.updated", { ago: fmtRelative(q.data.asOf) }) : t("screener.notYet");
  const onSort = (k: ScreenerSortKey) =>
    setSort((s) => {
      const cur = s ?? sort;
      return cur.key === k ? { key: k, dir: cur.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "ticker" ? "asc" : "desc" };
    });
  const toggle = (
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? t("screener.collapse") : t("screener.expand")} title={open ? t("screener.collapse") : t("screener.expand")}>
      {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );

  if (!open) {
    return (
      <section aria-label={t("screener.aria")} className={cn("glass-panel flex min-w-0 items-center gap-3 rounded-2xl px-[var(--panel-p)] py-2", className)}>
        <ScanSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 truncate text-left text-sm">
          <span className="font-semibold">{t("screener.title")}</span>
          <span className="text-muted-foreground">
            {" · "}
            {summary.leader
              ? t("screener.collapsed", { count: summary.count, ticker: summary.leader.ticker, move: fmtPct(summary.move, 1) })
              : t("screener.collapsedEmpty")}
          </span>
        </button>
        {toggle}
      </section>
    );
  }

  let body: ReactNode;
  if (q.isLoading) body = <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-lg" />)}</div>;
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => q.refetch()} title={t("screener.loadFailed")} compact inset />;
  else if (rows.length === 0) {
    body = (
      <div className="py-3">
        <p className="text-sm font-medium">{t("screener.empty")}</p>
        <p className="text-xs text-muted-foreground">{t("screener.emptyHint")}</p>
      </div>
    );
  } else {
    body = (
      <>
        {isMobile ? <PhoneList rows={shown} preset={preset} a={actions} day={planDate} /> : <DeskTable rows={shown} preset={preset} a={actions} day={planDate} sort={sort} onSort={onSort} />}
        {rows.length > SHOW && (
          <Button type="button" variant="ghost" size="sm" className="mt-1 self-start" onClick={() => setAll((v) => !v)}>
            {all ? t("screener.showLess") : t("screener.showAll", { n: rows.length })}
          </Button>
        )}
      </>
    );
  }

  return (
    <Panel
      aria-label={t("screener.aria")}
      title={t("screener.title")}
      description={`${t(`screener.presetHint.${preset}`)} · ${updated}`}
      icon={ScanSearch}
      className={className}
      actions={
        <>
          <Segmented<ScreenerPreset>
            ariaLabel={t("screener.presetsAria")}
            size="sm"
            value={preset}
            onChange={(p) => { setPreset(p); setSort(null); setAll(false); }}
            options={SCREENER_PRESETS.map((p) => ({ value: p, label: t(`screener.presets.${p}`), title: t(`screener.presetHint.${p}`) }))}
          />
          {(isCurator || isAdmin) && <StaffRefresh />}
          {toggle}
        </>
      }
    >
      <div className="flex min-w-0 flex-col">{body}</div>
    </Panel>
  );
}
