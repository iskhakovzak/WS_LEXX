/**
 * «Ментор» (/coach) — the personal AI mentor that leads the trader: the daily rhythm (brief + check-in before the
 * session, debrief after it, the weekly review), the conversation, the commitments with their score from the trades,
 * and what the mentor knows about me. Staff get their own mentor too. Phone: one column, the rhythm first.
 * Data: GET /api/mentor (components/mentor/api.ts).
 */
import { Compass } from "lucide-react";
import { ErrorState, Page, PageHeader, PanelSkeleton, Pill } from "@/components/ds";
import { useMentor } from "@/components/mentor/api";
import { RhythmCard } from "@/components/mentor/rhythm-card";
import { MentorChat } from "@/components/mentor/mentor-chat";
import { CommitmentsCard } from "@/components/mentor/commitments-card";
import { MemoryCard } from "@/components/mentor/memory-card";
import { defaultTab } from "@/components/mentor/model";
import { mentorI18n } from "@/i18n/ns/mentor";

const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

export default function CoachPage() {
  const { t, tryT } = mentorI18n.useT();
  const q = useMentor();
  const s = q.data;
  const blocked = s?.status.blocked ? tryT(`blocked.${s.status.blocked}`) ?? t("blocked.other") : null;
  return (
    <Page>
      <PageHeader
        title={t("title")}
        icon={Compass}
        description={t("description")}
        meta={s ? (
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone="accent">{t(`phase.${s.phase}`)}</Pill>
            {s.status.allowed && s.status.budget.limit > 0 && <span className="text-xs tabular-nums">{t("budget", { pct: Math.round(s.status.budget.leftShare * 100) })}</span>}
          </span>
        ) : undefined}
      />
      {q.isError && !s ? (
        <ErrorState title={t("loadFailed")} error={q.error} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-busy="true">
          <div className="flex flex-col gap-4 lg:col-span-7"><PanelSkeleton /><PanelSkeleton /></div>
          <div className="flex flex-col gap-4 lg:col-span-5"><PanelSkeleton /></div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {blocked && <p className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground" role="status">{blocked}</p>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
              <RhythmCard state={s} initial={defaultTab(s.phase, weekdayOf(s.today))} />
              <MentorChat thread={s.thread} allowed={s.status.allowed} />
            </div>
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
              <CommitmentsCard active={s.commitments.active} closed={s.commitments.closed} canEdit />
              <MemoryCard facts={s.facts} notes={s.notes} />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
