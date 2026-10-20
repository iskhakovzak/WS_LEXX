/**
 * «Мой разбор» (Волна 2 п. 2.9) — the trader's own answer instead of six screens with the same KPIs: one rule for
 * tomorrow (the focal point, linked to tomorrow's plan), where I earn, where I lose — from the own trades of the last
 * 30 (or 90) days. «Подробно» leads to /analytics. Phone-first: one column at 375 px, cards, no tables.
 * Data: GET /api/my-review (components/my-review/api.ts).
 */
import { Link } from "wouter";
import { ArrowRight, CalendarRange, ScanSearch } from "lucide-react";
import { EmptyState, ErrorState, Page, PageHeader, PanelSkeleton, Segmented, usePersistentState } from "@/components/ds";
import { useMyReview } from "@/components/my-review/api";
import { isPeriod, PERIODS, reviewState, totalsLine, type Period } from "@/components/my-review/model";
import { AnswerCard, RuleCard } from "@/components/my-review/sections";
import { myReviewI18n } from "@/i18n/ns/myReview";
import { useFacetView } from "@/components/shared/trade-facets/api";
import { ImxLine, ImxToggle } from "@/components/shared/trade-facets/FacetSummary";

export default function MyReviewPage() {
  const { t } = myReviewI18n.useT();
  const [stored, setPeriod] = usePersistentState<Period>("myReview.days", 30);
  const days: Period = isPeriod(stored) ? stored : 30;
  const FV = useFacetView(); // «Исключить IMX» — the same saved switch as /trades and /stats
  const q = useMyReview(days, FV.view.excludeImx);
  const state = reviewState(q.data);
  const options = PERIODS.map((p) => ({ value: String(p), label: t(`period.d${p}`) }));

  return (
    <Page width="narrow">
      <PageHeader
        title={t("title")}
        icon={ScanSearch}
        description={t("description", { days })}
        meta={q.data && state === "ready" ? (
          <span className="flex flex-col gap-0.5">
            <span className="tabular-nums">{totalsLine(q.data.totals)}</span>
            <ImxLine total={q.data.totals.net} imx={q.data.imx} excluded={!!q.data.imx?.excluded} />
          </span>
        ) : undefined}
        actions={
          <>
          <ImxToggle value={FV.view.excludeImx} onChange={(v) => FV.update((cur) => ({ ...cur, excludeImx: v }))} />
          <Segmented size="sm" ariaLabel={t("period.aria")} value={String(days)} options={options} onChange={(v) => setPeriod(Number(v) === 90 ? 90 : 30)} />
          </>
        }
      />
      {q.isError && !q.data ? (
        <ErrorState title={t("loadFailed")} error={q.error} onRetry={() => void q.refetch()} />
      ) : state === "loading" ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      ) : state === "empty" ? (
        <EmptyState icon={CalendarRange} title={t("empty.title", { days })} description={t("empty.description")} />
      ) : (
        <div className="flex flex-col gap-4">
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
