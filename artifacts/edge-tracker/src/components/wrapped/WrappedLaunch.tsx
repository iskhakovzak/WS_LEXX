/**
 * Entry points of «Итоги недели / месяца» (own data only; the viewer chunk loads on the first click):
 *   WrappedButton        «Отчёт недели» header: the selected week of the viewer's own report
 *   WrappedDashLine      dashboard: ONE quiet line after a week / month closes (owner UX law: no banner), gone once
 *                        opened or dismissed (period.ts dashOffer)
 *   WrappedProfilePanel  Settings → Профиль: last week / last month
 */
import * as React from "react";
import { CalendarDays, Images, Sparkles, X } from "lucide-react";
import { Panel, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { wrappedI18n } from "@/i18n/ns/wrapped";
import { nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import { usePeriodHasTrades } from "./api";
import { dashOffer, lastClosedMonth, lastClosedWeek, periodOf, type PeriodKind, type SeenState } from "./period";

const LazyViewer = React.lazy(() => import("./WrappedViewer"));

type Target = { kind: PeriodKind; key: string } | null;

function useMe(): string | null {
  const { user } = useAuth();
  return user && user.role !== "guest" ? user.traderName : null;
}

function Viewer({ target, onClose }: { target: Target; onClose: () => void }) {
  if (!target) return null;
  return (
    <React.Suspense fallback={null}>
      <LazyViewer kind={target.kind} periodKey={target.key} open onOpenChange={(v) => { if (!v) onClose(); }} />
    </React.Suspense>
  );
}

function useSeen(me: string | null) {
  return usePersistentState<SeenState>(`wrapped.seen.${me ?? "me"}`, {});
}

/** «Отчёт недели»: the story of the week on screen (rendered only for the viewer's own week). */
export function WrappedButton({ week, className }: { week: string; className?: string }) {
  const { t } = wrappedI18n.useT();
  const me = useMe();
  const [target, setTarget] = React.useState<Target>(null);
  const [seen, setSeen] = useSeen(me);
  // A week still being traded has no recap yet (Saturday / Sunday: the current week is closed).
  if (!me || week > lastClosedWeek(nyDate())) return null;
  return (
    <>
      <Button variant="outline" size="sm" className={cn("gap-1.5", className)} title={t("open.hint")} onClick={() => { setTarget({ kind: "week", key: week }); setSeen({ ...seen, week }); }} data-print-hide>
        <Images className="h-3.5 w-3.5" aria-hidden="true" /> {t("open.week")}
      </Button>
      <Viewer target={target} onClose={() => setTarget(null)} />
    </>
  );
}

/** Dashboard: one line, only in the days after a week / month closes and only when the period has trades. */
export function WrappedDashLine({ className }: { className?: string }) {
  const { t } = wrappedI18n.useT();
  const me = useMe();
  const [seen, setSeen] = useSeen(me);
  const [target, setTarget] = React.useState<Target>(null);
  const offer = dashOffer(nyDate(), seen);
  const weekP = React.useMemo(() => (offer.week ? periodOf("week", offer.week) : null), [offer.week]);
  const monthP = React.useMemo(() => (offer.month ? periodOf("month", offer.month) : null), [offer.month]);
  const weekHas = usePeriodHasTrades(me, weekP);
  const monthHas = usePeriodHasTrades(me, monthP);
  const week = weekHas ? offer.week : null;
  const month = monthHas ? offer.month : null;
  if (!me || (!week && !month && !target)) return <Viewer target={target} onClose={() => setTarget(null)} />;
  const openWeek = () => { if (week) { setTarget({ kind: "week", key: week }); setSeen({ ...seen, week }); } };
  const openMonth = () => { if (month) { setTarget({ kind: "month", key: month }); setSeen({ ...seen, month }); } };
  const dismiss = () => setSeen({ ...seen, ...(week ? { week } : {}), ...(month ? { month } : {}) });
  const link = "font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
  return (
    <>
      {(week || month) && (
        <p className={cn("flex min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground", className)}>
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          {week && month ? (
            <span className="min-w-0 truncate">
              {t("dash.both")}{" "}
              <button type="button" className={link} onClick={openWeek}>{t("dash.weekLink")}</button>
              {" · "}
              <button type="button" className={link} onClick={openMonth}>{t("dash.monthLink")}</button>
            </span>
          ) : (
            <span className="min-w-0 truncate">
              {week ? t("dash.week") : t("dash.month")}
              {" · "}
              <button type="button" className={link} onClick={week ? openWeek : openMonth}>{t("dash.open")}</button>
            </span>
          )}
          <button type="button" onClick={dismiss} aria-label={t("dash.dismiss")} title={t("dash.dismiss")} className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9 pointer-coarse:w-9">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </p>
      )}
      <Viewer target={target} onClose={() => setTarget(null)} />
    </>
  );
}

/** Settings → Профиль: the last closed week and month. */
export function WrappedProfilePanel() {
  const { t } = wrappedI18n.useT();
  const me = useMe();
  const [target, setTarget] = React.useState<Target>(null);
  if (!me) return null;
  const today = nyDate();
  return (
    <Panel title={t("profile.title")} description={t("profile.description")} icon={Images}>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="gap-1.5" onClick={() => setTarget({ kind: "week", key: lastClosedWeek(today) })}>
          <CalendarDays className="h-4 w-4" aria-hidden="true" /> {t("profile.lastWeek")}
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={() => setTarget({ kind: "month", key: lastClosedMonth(today) })}>
          <CalendarDays className="h-4 w-4" aria-hidden="true" /> {t("profile.lastMonth")}
        </Button>
      </div>
      <Viewer target={target} onClose={() => setTarget(null)} />
    </Panel>
  );
}
