import * as React from "react";
import { Link } from "wouter";
import { ArrowRight, BookCheck, Check, CornerDownRight, Layers, NotebookPen, Sparkles, Users } from "lucide-react";
import { EmptyState, Panel, Pill, toneBg, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { fmtDate, fmtNum, fmtUsd } from "@/lib/format";
import { mistakeLabel } from "@/components/shared/mistake-labels";
import { curatorI18n } from "@/i18n/ns/curator";
import { coachI18n } from "@/i18n/ns/coach";
import { commonI18n } from "@/i18n/ns/common";
import { personName } from "@/i18n";
import { curatorApi, useCuratorMutation, type CostQueueRow, type CostReasonKind, type TodayPayload } from "./api";
import { MONEY_PARAMS, attentionRows, primaryAction, type AttentionRow } from "./cost-queue-model";
import { actionTone, curatorLinks } from "./curator-math";
import type { EodTarget } from "./eod-review";

type Reason = CostQueueRow["reasons"][number];

const REASON_TONE: Record<CostReasonKind, Tone> = {
  stop_breach: "down", loss_streak: "down", focus_broken: "warn", fees: "warn", giveback: "warn", disputed: "purple", rule: "neutral",
};
const VISIBLE = 10;

/** Short chip label of a reason. A limit breach is named by its limit (daily stop / weekly / max drawdown, OLGA-21). */
const reasonLabel = (k: CostReasonKind, r?: Reason) => {
  const scope = k === "stop_breach" ? r?.text.params?.scope : null;
  return (scope ? curatorI18n.tryT(`costQueue.reasonScope.${scope}`) : null) ?? curatorI18n.tryT(`costQueue.reason.${k}`) ?? k;
};

/**
 * The $ figure on a chip: the cost; a giveback shows what was not earned (not a loss, OLGA-09); a lasting breach
 * without an added loss shows used / limit («$3,526 / $2,000», OLGA-21).
 */
function chipMoney(r: Reason): string | null {
  if (r.kind === "giveback") return r.costNet != null && r.costNet < 0 ? fmtUsd(-r.costNet, { decimals: 0 }) : null;
  if (r.costNet != null && r.costNet < 0) return fmtUsd(r.costNet, { decimals: 0 });
  const p = r.text.params ?? {};
  if (r.kind === "stop_breach" && typeof p.used === "number" && typeof p.limit === "number") {
    return `${fmtUsd(p.used, { decimals: 0 })} / ${fmtUsd(p.limit, { decimals: 0 })}`;
  }
  return null;
}

/** The reason's line (tooltip / note prefill): params from the server, $ and dates formatted, mistake ids as labels. */
function reasonDetail(r: Reason): string {
  const raw = r.text.params ?? {};
  const p: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) p[k] = "—";
    else if (MONEY_PARAMS.has(k) && typeof v === "number") p[k] = fmtUsd(v, { decimals: 0 });
    else if (k === "mistake") p[k] = mistakeLabel(String(v));
    else if (k === "rule") p[k] = mistakeLabel(`rule:${v}`);
    else if (k === "from") p[k] = fmtDate(String(v), "dayMonth");
    else if (k === "scope") p[k] = curatorI18n.tryT(`costQueue.scope.${v}`) ?? String(v);
    else p[k] = v;
  }
  if (r.kind === "giveback" && typeof raw.stops === "number") {
    return curatorI18n.t("costQueue.detail.givebackStops", { stops: fmtNum(raw.stops, { decimals: 1 }), peak: p.peak ?? "—", close: p.close ?? "—" });
  }
  if (r.kind === "giveback") {
    return curatorI18n.t("costQueue.detail.giveback", { peak: p.peak ?? "—", close: p.close ?? "—", missed: r.costNet != null ? fmtUsd(Math.abs(r.costNet), { decimals: 0 }) : "—" });
  }
  if (r.kind === "stop_breach" && raw.scope && raw.scope !== "daily") {
    return curatorI18n.tryT(`costQueue.detail.stop_${raw.scope}`, p) ?? curatorI18n.t("costQueue.detail.stop_breach", { scope: p.scope ?? "—", used: p.used ?? "—", limit: p.limit ?? "—" });
  }
  if ((r.kind === "focus_broken" || r.kind === "disputed") && !Number(raw.count)) return curatorI18n.t(`costQueue.detail.${r.kind}Day`, { mistake: p.mistake ?? "—" });
  if (r.kind === "rule" && Number(raw.rules) > 1) return curatorI18n.t("costQueue.detail.ruleMany", { count: p.count ?? "—", rule: p.rule ?? "—", more: Number(raw.rules) - 1 });
  return curatorI18n.tryT(r.text.key, p) ?? reasonLabel(r.kind);
}

/**
 * «Следующие шаги» merged with the queue by money: the most expensive problems first, then the usual next steps.
 * `extra` — small item types composed by the page on top (reward requests to grant / decline).
 */
export function AttentionPanel({ data, onOpenTrader, onTemplate, onReviewDay, extra }: {
  data: TodayPayload;
  onOpenTrader: (trader: string, tab?: string) => void;
  onTemplate: (traders: string[]) => void;
  /** Opens the EOD review sheet of a closed day (the cabinet's sheet); saving the review resolves the row. */
  onReviewDay?: (target: EodTarget) => void;
  extra?: React.ReactNode;
}) {
  const { t } = curatorI18n.useT();
  const [all, setAll] = React.useState(false);
  const rows = React.useMemo(() => attentionRows(data), [data]);
  const shown = all ? rows : rows.slice(0, VISIBLE);
  const open = rows.filter((r) => r.type !== "cost" || !r.item.resolved).length;
  return (
    <Panel
      className="lg:col-span-7"
      fill
      title={t("today.nextTitle")}
      icon={Sparkles}
      description={t("today.nextHint")}
      actions={open ? <Pill tone="neutral">{open}</Pill> : undefined}
    >
      {extra && <div className="mb-1.5 empty:hidden">{extra}</div>}
      {rows.length === 0 ? (
        <EmptyState compact icon={Sparkles} title={t("today.allClear")} description={t("today.allClearHint")} />
      ) : (
        // Wide (@xl): one grid for the whole list, cost rows on a subgrid — name · reasons · money · action · note are
        // shared columns, so every amount and every action sits in the same slot whatever the action's label width.
        // The edge tracks include the card's px-3 (a subgrid's padding is taken from its edge tracks): name 8rem, note 2rem.
        <div className="@container">
          <ul className="flex flex-col gap-1.5 @xl:grid @xl:grid-cols-[8.75rem_minmax(0,1fr)_6rem_auto_2.75rem] @xl:gap-x-3">
            {shown.map((r) => (r.type === "cost"
              ? <CostRow key={r.key} row={r} onOpenTrader={onOpenTrader} onReviewDay={onReviewDay} />
              : r.type === "oneOnOne"
                ? <OneOnOneRow key={r.key} row={r} onOpenTrader={onOpenTrader} />
                : <NextRow key={r.key} row={r} onOpenTrader={onOpenTrader} onTemplate={onTemplate} />))}
            {!!data.nextActionsMore && (
              <li className="col-span-full px-1 text-xs text-muted-foreground">{coachI18n.t("priority.moreInDigest", { count: data.nextActionsMore })}</li>
            )}
            {rows.length > VISIBLE && (
              <li className="col-span-full">
                <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="inline-flex min-h-8 items-center px-1 text-xs text-primary hover:underline">
                  {all ? commonI18n.t("actions.collapse") : t("showMore", { count: rows.length - VISIBLE })}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function CostRow({ row, onOpenTrader, onReviewDay }: {
  row: Extract<AttentionRow, { type: "cost" }>;
  onOpenTrader: (trader: string, tab?: string) => void;
  onReviewDay?: (target: EodTarget) => void;
}) {
  const { t } = curatorI18n.useT();
  const { item } = row;
  const action = primaryAction(row);
  const day = fmtDate(item.date, "dayMonth");
  const journalDay = curatorLinks.journalDay(item.trader, item.date);
  return (
    // Own card at the list's normal gap, full width (no pull-up / inset: that made the run read as one merged card and
    // shifted its columns). A run of one trader's days is tied by the same left rule on each of its cards and the «↳»
    // before a continuation's date. Wide: a subgrid of the list's columns.
    <li
      className={cn(
        "tile flex min-w-0 flex-col gap-2 px-3 py-2 @xl:col-span-full @xl:grid @xl:grid-cols-subgrid @xl:items-center",
        // An inset rule, not a border: it must not narrow the first column (the shared track would truncate names).
        row.group && "shadow-[inset_2px_0_0_hsl(var(--muted-foreground)/0.45)]",
        item.resolved && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2 @xl:flex-col @xl:gap-0">
        {/* Another day of the trader above: the name is not repeated (the group reads as one trader). */}
        {row.cont ? <span className="sr-only">{personName(item.trader)}</span> : (
          <button type="button" onClick={() => onOpenTrader(item.trader)} className="max-w-full truncate text-left text-sm font-medium text-foreground hover:text-primary" title={personName(item.trader)}>
            {personName(item.trader)}
          </button>
        )}
        <Link href={curatorLinks.journalDay(item.trader, item.date)} className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground hover:text-primary" title={t("costQueue.dayTitle", { date: day })}>
          {row.cont && <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
          {day}
        </Link>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {item.reasons.map((r, i) => <ReasonChip key={`${r.kind}:${i}`} r={r} />)}
      </div>
      {/* Narrow: money at the left, actions at the right (the amount never moves with the button's width).
          Wide: `contents` — money, action and note become cells of the shared columns. */}
      <div className="flex items-center gap-1.5 @xl:contents">
        <span className="mr-auto flex w-24 flex-col items-start leading-tight @xl:mr-0 @xl:items-end">
          <span className={cn("text-sm font-medium tabular-nums", item.costNet < 0 ? "text-down" : "text-muted-foreground")} title={t("costQueue.totalTitle")}>
            {item.costNet < 0 ? fmtUsd(item.costNet, { signed: true, decimals: 0 }) : "—"}
          </span>
          {item.dayNet != null && (
            <span className="text-2xs tabular-nums text-muted-foreground" title={t("costQueue.dayNetTitle")}>
              {t("costQueue.dayNet", { net: fmtUsd(item.dayNet, { signed: true, decimals: 0 }) })}
            </span>
          )}
        </span>
        <span className="flex min-w-0 @xl:justify-self-start">
          {item.resolved ? (
            <Pill tone="up" title={t("costQueue.resolvedTitle")}><Check className="h-3 w-3" aria-hidden="true" /> {t("costQueue.resolved")}</Pill>
          ) : action.kind === "breach" ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenTrader(item.trader, "risk")}>{t("costQueue.breach")}</Button>
          ) : action.kind === "review" && onReviewDay ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title={t("costQueue.reviewDayTitle", { date: day })}
              onClick={() => onReviewDay({ eodId: action.eod.eodId, trader: item.trader, date: item.date, closedAt: action.eod.closedAt, hoursWaiting: action.eod.hoursWaiting })}
            >
              <BookCheck className="h-3.5 w-3.5" /> {t("costQueue.reviewDay")}
            </Button>
          ) : (
            <Button asChild size="sm" variant="ghost">
              <Link href={action.kind === "next" ? action.href : journalDay} title={action.kind === "next" ? undefined : t("costQueue.dayTitle", { date: day })}>
                {action.kind === "next" ? t("open") : t("costQueue.openDay")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </span>
        <QuickNote trader={item.trader} day={item.date} prefill={`${day}: ${item.reasons.map(reasonDetail).join("; ")}`} />
      </div>
    </li>
  );
}

function ReasonChip({ r }: { r: Reason }) {
  const money = chipMoney(r);
  const body = (
    <Pill tone={REASON_TONE[r.kind]} title={reasonDetail(r)}>
      {reasonLabel(r.kind, r)}
      {money != null && <span className="tabular-nums opacity-80">{money}</span>}
    </Pill>
  );
  if (r.tradeId == null) return body;
  return <Link href={links.trade(r.tradeId)} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${reasonLabel(r.kind, r)} · ${curatorI18n.t("costQueue.tradeTitle")}`}>{body}</Link>;
}

function NextRow({ row, onOpenTrader, onTemplate }: {
  row: Extract<AttentionRow, { type: "next" }>;
  onOpenTrader: (trader: string, tab?: string) => void;
  onTemplate: (traders: string[]) => void;
}) {
  const { t } = curatorI18n.useT();
  const a = row.next;
  return (
    <li className="tile col-span-full flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <button type="button" onClick={() => onOpenTrader(a.trader)} title={personName(a.trader)} className="w-28 shrink-0 truncate text-left text-sm font-medium text-foreground hover:text-primary sm:w-32">
        {personName(a.trader)}
      </button>
      <span className="flex min-w-[9rem] flex-1 items-start gap-1.5" title={a.label}><span className={cn("mt-[0.4375rem] h-2 w-2 shrink-0 rounded-full", toneBg(actionTone(a.kind)))} aria-hidden="true" /><span className="min-w-0 text-sm leading-ui text-foreground">{a.label}</span></span>
      {a.kind === "no_limits" ? (
        <Button type="button" size="sm" variant="outline" className="ml-auto shrink-0" onClick={() => onTemplate([a.trader])}>
          <Layers className="h-3.5 w-3.5" /> {t("today.template")}
        </Button>
      ) : (
        <Button asChild size="sm" variant="ghost" className="shrink-0">
          <Link href={a.href}>{t("open")} <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      )}
    </li>
  );
}

/** A ward whose last 1:1 is older than 30 days (or who never had one): plan the meeting (OLGA-18). */
function OneOnOneRow({ row, onOpenTrader }: { row: Extract<AttentionRow, { type: "oneOnOne" }>; onOpenTrader: (trader: string, tab?: string) => void }) {
  const { t } = curatorI18n.useT();
  const label = row.days == null ? t("oneOnOne.never") : t("oneOnOne.days", { count: row.days });
  return (
    <li className="tile col-span-full flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <button type="button" onClick={() => onOpenTrader(row.trader)} title={personName(row.trader)} className="w-28 shrink-0 truncate text-left text-sm font-medium text-foreground hover:text-primary sm:w-32">
        {personName(row.trader)}
      </button>
      {/* Wraps (with the full text as a tooltip) instead of StatusDot's one-line ellipsis: a narrow panel showed «1:1 е…». */}
      <span className="flex min-w-[9rem] flex-1 items-start gap-1.5" title={label}>
        <span className="mt-[0.4375rem] h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
        <span className="min-w-0 text-sm leading-ui text-foreground">{label}</span>
      </span>
      <Button asChild size="sm" variant="ghost" className="ml-auto shrink-0">
        <Link href={`/academy/mentor?student=${encodeURIComponent(row.trader)}`}><Users className="h-3.5 w-3.5" /> {t("oneOnOne.plan")}</Link>
      </Button>
    </li>
  );
}

/** One-line private note right from the row (prefilled with the day's reasons); saving marks ONLY this day reviewed. */
function QuickNote({ trader, day, prefill }: { trader: string; day: string; prefill: string }) {
  const { t } = curatorI18n.useT();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState(prefill);
  const add = useCuratorMutation((text: string) => curatorApi.addNote({ trader, body: text, kind: "note", day }));
  const save = () => {
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate(text, {
      onSuccess: () => { setOpen(false); toast({ title: t("costQueue.noteSaved") }); },
      onError: (e) => toast({ title: t("costQueue.noteFailed"), description: (e as Error).message, variant: "destructive" }),
    });
  };
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setBody(prefill); }}>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" title={t("costQueue.note")} aria-label={t("costQueue.noteTitle", { name: personName(trader) })}>
          <NotebookPen className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{t("costQueue.noteTitle", { name: personName(trader) })}</span>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={4000}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
        />
        <p className="text-xs text-muted-foreground">{t("costQueue.noteHint")}</p>
        <Button type="button" size="sm" className="self-end" onClick={save} disabled={!body.trim() || add.isPending}>
          {add.isPending ? t("saving") : t("costQueue.noteSave")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
