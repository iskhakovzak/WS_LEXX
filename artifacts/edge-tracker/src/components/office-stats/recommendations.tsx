/**
 * «Рекомендации офису» — desk-level recommendations (GET /api/office-stats/recommendations, already redacted for the
 * viewer by the server). One card per finding: what, a one-line why with numbers and an interval, who it affects
 * (names only where the viewer may see them), the action to an existing page, 1–3 confidence ticks and «скрыть на
 * неделю». Four cards first (fewer choices), the rest behind «Показать все».
 */
import * as React from "react";
import { Link } from "wouter";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Coins, EyeOff, Gauge, GraduationCap, HelpCircle, ListChecks, Lock, PiggyBank, Scale, Sparkles, TrendingDown, Users, UsersRound,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { ConfidenceTicks } from "@/components/shared/confidence-ticks";
import { cn } from "@/lib/utils";
import { fmtDeskDate, fmtDeskTime } from "@/lib/format";
import { nyDate } from "@/lib/trading-date";
import { personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { officeRecsI18n } from "@/i18n/ns/officeRecs";
import { academyPathI18n } from "@/i18n/ns/academyPath";
import { nextHiddenMap, useHideRec, useOfficeRecs, type OfficeRec, type RecKind, type RecsResponse } from "./recs-api";
import { actionLabel, confidenceText, personHref, recBasis, recTitle, recWhy } from "./recs-model";

const FIRST = 4;
const NAMES_INLINE = 3;

const KIND_ICON: Record<RecKind, LucideIcon> = {
  leak: TrendingDown, rule: ListChecks, fees: Coins, crowding: UsersRound, practice: Sparkles, attention: AlertTriangle, readiness: GraduationCap, regime: Gauge, juniorCost: PiggyBank,
};
const KIND_TONE: Record<RecKind, string> = {
  leak: "bg-down/12 text-down", crowding: "bg-down/12 text-down", fees: "bg-warn/12 text-warn",
  rule: "bg-up/12 text-up", practice: "bg-up/12 text-up", attention: "bg-warn/12 text-warn", readiness: "bg-primary/12 text-primary", regime: "bg-warn/12 text-warn", juniorCost: "bg-up/12 text-up",
};

const blockerLabel = (metric: string) => academyPathI18n.tryT(`metrics.${metric}.label`) ?? metric;

export function OfficeRecommendations() {
  const { t } = officeRecsI18n.useT();
  const q = useOfficeRecs();
  const [all, setAll] = React.useState(false);
  const data = q.data;
  const recs = data?.recs ?? [];
  const shown = all ? recs : recs.slice(0, FIRST);
  return (
    // The page's section heading names the block («Рекомендации офису»); the panel has no header of its own and keeps
    // its tools (freshness, method, hidden, show all) in the footer.
    <Panel aria-label={t("title")} footer={data ? <Footer data={data} all={all} setAll={setAll} /> : undefined}>
      {q.isPending ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" aria-busy="true" aria-label={t("loading")}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-44 rounded-xl" />)}
        </div>
      ) : q.isError && !data ? (
        <EmptyState compact icon={AlertTriangle} title={t("loadFailed")} description={q.error instanceof Error ? q.error.message : undefined}
          action={<Button size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{commonI18n.t("actions.retry")}</Button>} />
      ) : !recs.length ? (
        <EmptyState compact icon={BadgeCheck} title={t("emptyTitle")} description={t("emptyDesc")} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {shown.map((r) => <RecCard key={r.id} rec={r} data={data!} />)}
        </ul>
      )}
    </Panel>
  );
}

function MethodPopover({ data }: { data: RecsResponse }) {
  const { t } = officeRecsI18n.useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" size="sm" className="h-auto gap-1 p-0 text-xs text-muted-foreground hover:text-foreground"><HelpCircle className="h-3.5 w-3.5" aria-hidden="true" /> {t("methodButton")}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,26rem)] text-xs leading-relaxed text-muted-foreground">
        {t("method", { days: data.window.days, from: fmtDeskDate(data.window.from), to: fmtDeskDate(data.window.to) })}
      </PopoverContent>
    </Popover>
  );
}

function Footer({ data, all, setAll }: { data: RecsResponse; all: boolean; setAll: (v: boolean) => void }) {
  const { t } = officeRecsI18n.useT();
  const hide = useHideRec();
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t("updated", { time: fmtDeskTime(data.computedAt) })}</span>
        <MethodPopover data={data} />
      </span>
      <span className="inline-flex flex-wrap items-center gap-2">
        {data.hidden.length > 0 && (
          <>
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            {t("hiddenCount", { count: data.hidden.length })}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={hide.isPending}
              onClick={() => hide.mutate(nextHiddenMap(data.hidden, { show: "all" }, nyDate()))}>
              {t("showHidden")}
            </Button>
          </>
        )}
        {data.recs.length > FIRST && (
          <Button variant="ghost" size="sm" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? t("collapse") : t("showAll", { count: data.recs.length })}
          </Button>
        )}
      </span>
    </>
  );
}

function RecCard({ rec, data }: { rec: OfficeRec; data: RecsResponse }) {
  const { t } = officeRecsI18n.useT();
  const { toast } = useToast();
  const hide = useHideRec();
  const Icon = KIND_ICON[rec.kind];
  const conf = confidenceText(rec);
  const why = recWhy(rec, blockerLabel);
  const onHide = () => {
    const today = nyDate();
    const map = nextHiddenMap(data.hidden, { hide: rec.id }, today);
    // Optimistic: the card leaves at once (this row unmounts), so the undo toast is shown now, not on success.
    hide.mutate(map);
    toast({
      title: t("hiddenToast", { date: fmtDeskDate(map[rec.id]) }),
      action: (
        <ToastAction altText={t("undo")} onClick={() => hide.mutate(nextHiddenMap([...data.hidden, { id: rec.id, until: map[rec.id], kind: rec.kind }], { show: rec.id }, today))}>
          {t("undo")}
        </ToastAction>
      ),
    });
  };
  return (
    <li className="tile flex min-w-0 flex-col gap-2.5 p-3.5 sm:p-4">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", KIND_TONE[rec.kind])} aria-hidden="true"><Icon className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1 truncate text-2xs font-medium text-muted-foreground">
          {t(`kinds.${rec.kind}`)}
          {rec.audience === "staff" && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 normal-case tracking-normal" title={t("staffOnly")}>
              <Lock className="h-3 w-3" aria-hidden="true" /><span className="sr-only">{t("staffOnly")}</span>
            </span>
          )}
        </span>
        <ConfidenceTicks level={rec.confidence} label={conf.label} hint={conf.hint} srText={t("confidence.aria", { level: rec.confidence, label: conf.label })} />
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={onHide} disabled={hide.isPending} aria-label={t("hide")} title={t("hide")}>
          <EyeOff className="h-4 w-4" />
        </Button>
      </div>
      <h3 className="text-sm font-semibold leading-snug text-foreground">{recTitle(rec)}</h3>
      <div className="flex flex-col gap-1 text-[13px] leading-relaxed text-muted-foreground">
        {why.map((line, i) => <p key={i} className={cn(i === 0 && "text-foreground/85")}>{line}</p>)}
      </div>
      <Affected rec={rec} role={data.role} />
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {rec.action && (
          <Button asChild size="sm" variant="outline">
            <Link href={rec.action.href}>{actionLabel(rec.action, rec)} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
          </Button>
        )}
        {rec.secondary && (
          <Button asChild size="sm" variant="ghost">
            <Link href={rec.secondary.href}><Scale className="h-3.5 w-3.5" aria-hidden="true" /> {actionLabel(rec.secondary, rec)}</Link>
          </Button>
        )}
        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">{recBasis(rec)}</span>
      </div>
    </li>
  );
}

function Affected({ rec, role }: { rec: OfficeRec; role: RecsResponse["role"] }) {
  const { t } = officeRecsI18n.useT();
  const { count, names } = rec.affected;
  if (!count) return null;
  const who = t("affected", { count });
  if (!names.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        {role === "trader" ? t("affectedDesk", { who }) : <>{who}{role === "curator" ? <span className="text-2xs"> · {t("affectedHidden")}</span> : null}</>}
      </p>
    );
  }
  const isCurators = rec.kind === "attention" && rec.params.sub === "load";
  const link = (n: string) => (isCurators
    ? <span key={n} className="font-medium text-foreground">{personName(n)}</span>
    : <Link key={n} href={personHref(n)} className="rounded font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{personName(n)}</Link>);
  const rest = names.length - NAMES_INLINE;
  return (
    <div className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0">
      {isCurators ? t("affectedNames") : who}:{" "}
      {names.slice(0, NAMES_INLINE).map((n, i) => <React.Fragment key={n}>{i > 0 && ", "}{link(n)}</React.Fragment>)}
      {rest > 0 && " "}
      {rest > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs">{t("more", { count: rest })}</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-[min(60dvh,var(--radix-popover-content-available-height))] w-64 overflow-y-auto text-sm">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("affectedNames")}</p>
            <ul className="flex flex-col gap-1">{names.map((n) => <li key={n}>{link(n)}</li>)}</ul>
          </PopoverContent>
        </Popover>
      )}
      </p>
    </div>
  );
}
