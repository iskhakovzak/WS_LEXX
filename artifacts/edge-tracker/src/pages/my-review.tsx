/**
 * «Мой разбор» (Волна 2 п. 2.9) — the trader's own answer instead of six screens with the same KPIs: one rule for
 * tomorrow (the focal point, linked to tomorrow's plan), where I earn, where I lose — from the own trades of the last
 * week / month / quarter (?period=, the period vocabulary; the window always ends today). «Подробно» leads to
 * /analytics. Phone-first: one column at 375 px, cards, no tables. Data: GET /api/my-review (components/my-review/api.ts).
 */
import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, CalendarRange, ScanSearch } from "lucide-react";
import { EmptyState, ErrorState, Page, PageHeader, PanelSkeleton, Toolbar } from "@/components/ds";
import { useMyReview } from "@/components/my-review/api";
import { REVIEW_PRESETS, reviewDays, reviewRange, reviewState, totalsLine } from "@/components/my-review/model";
import { usePeriodParam } from "@/hooks/use-period-param";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { commonI18n } from "@/i18n/ns/common";
import { AnswerCard, RuleCard } from "@/components/my-review/sections";
import { myReviewI18n } from "@/i18n/ns/myReview";
import { useFacetView } from "@/components/shared/trade-facets/api";
import { ImxLine, ImxToggle } from "@/components/shared/trade-facets/FacetSummary";
import { AiReviewCard } from "@/components/shared/ai-review-card";
import { nyDate } from "@/lib/trading-date";

/** A day of the month before `ymd`'s month (the API returns the month review that covers it). */
const lastMonthDay = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};

/** The day count an older build stored (JSON 30 / 90). */
function legacyDays(): unknown {
  try {
    const raw = localStorage.getItem("ws_lexx.myReview.days");
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function MyReviewPage() {
  const { t } = myReviewI18n.useT();
  const today = nyDate();
  // ?period= (design audit wave 3); the old stored day count («30» / «90») is read once.
  const P = usePeriodParam({ presets: REVIEW_PRESETS, fallback: "month", storageKey: "myReview.period", legacy: legacyDays });
  // A linked / stored «Период…» is read as the window it really covers (the last N days, ending today).
  const { period: pv, custom: pc, setCustom } = P;
  useEffect(() => {
    if (pv !== "custom" || !pc) return;
    const r = reviewRange(pc, today);
    if (r.from !== pc.from || r.to !== pc.to) setCustom(r);
  }, [pv, pc, today, setCustom]);
  const days = reviewDays(P.period, P.custom);
  const daysText = commonI18n.t("units.days", { count: days });
  const FV = useFacetView(); // «Исключить IMX» — the same saved switch as /trades and /stats
  const q = useMyReview(days, FV.view.excludeImx);
  const state = reviewState(q.data);

  return (
    // Default width like every screen (design audit §3: «narrow» made the content jump between pages).
    <Page>
      <PageHeader
        title={t("title")}
        icon={ScanSearch}
        description={t("description", { days: daysText })}
        meta={q.data && state === "ready" ? (
          <span className="flex flex-col gap-0.5">
            <span className="tabular-nums">{totalsLine(q.data.totals)}</span>
            <ImxLine total={q.data.totals.net} imx={q.data.imx} excluded={!!q.data.imx?.excluded} />
          </span>
        ) : undefined}
      />
      {/* The scope under the header (design audit wave 3): the period · «Исключить IMX». */}
      <Toolbar>
        <PeriodPicker
          ariaLabel={t("period.aria")}
          presets={REVIEW_PRESETS}
          value={P.period}
          custom={P.custom}
          onPreset={P.setPreset}
          onCustom={(r) => P.setCustom(reviewRange(r, today))}
          today={today}
          size="sm"
        />
        <ImxToggle className="ml-auto" value={FV.view.excludeImx} onChange={(v) => FV.update((cur) => ({ ...cur, excludeImx: v }))} />
      </Toolbar>
      {q.isError && !q.data ? (
        <ErrorState title={t("loadFailed")} error={q.error} onRetry={() => void q.refetch()} />
      ) : state === "loading" ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      ) : state === "empty" ? (
        <EmptyState icon={CalendarRange} title={t("empty.title", { days: daysText })} description={t("empty.description")} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Last month's nightly AI review (the 1st, when the desk turned it on); nothing shows until one exists. */}
          <AiReviewCard subject={{ kind: "month", date: lastMonthDay(nyDate()) }} />
          <RuleCard review={q.data!} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
            <AnswerCard kind="earn" review={q.data!} />
            <AnswerCard kind="lose" review={q.data!} />
          </div>
          <Link
            href="/analytics"
            title={t("moreHint")}
            className="inline-flex min-h-11 w-fit items-center gap-1.5 self-center rounded-xl px-4 text-sm font-medium text-primary hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("more")}<ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      )}
    </Page>
  );
}
