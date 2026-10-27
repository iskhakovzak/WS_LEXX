import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { replaceSearchParams } from "@/hooks/use-search-param";
import { CalendarClock, ListOrdered, Plus, Star, Swords, Trophy, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { http } from "@/lib/api/http";
import { humanizeApiError } from "@/lib/api/errors";
import { STALE } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Kbd } from "@/components/ui/kbd";
import { useToast } from "@/hooks/use-toast";
import { Page, PageHeader, SectionTabs } from "@/components/ds";
import { useStoredState } from "@/components/ratings/shared";
import { LeaderboardTab } from "@/components/ratings/leaderboard-tab";
import { ScorecardsTab } from "@/components/ratings/scorecards-tab";
import { MyProgressTab } from "@/components/ratings/my-progress-tab";
import { QuestsProgressTab } from "@/components/quests/progress-tab";
import { useQuestsMe } from "@/components/quests/api";
import { SeasonTab } from "@/components/gamification/season-tab";
import { QuestsGamificationExtras, QuestsGamificationHeader } from "@/components/gamification/quests-blocks";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { RatingDialog } from "@/components/ratings/rating-dialog";
import { weekLabel, weekOf, type Rating } from "@/components/ratings/scorecard-model";
import { ratingsI18n } from "@/i18n/ns/ratings";
import { questsI18n } from "@/i18n/ns/quests";
import { personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { trackAction } from "@/lib/usage";

type Tab = "leaderboard" | "curator" | "me" | "quests" | "season";
const TABS: readonly Tab[] = ["leaderboard", "curator", "me", "quests", "season"];

export default function RatingsPage() {
  const { user, isCurator, isAdmin, dbUsers } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = ratingsI18n.useT();
  const { t: tc } = commonI18n.useT();
  const { t: tq } = questsI18n.useT();
  const { t: tg } = gamificationI18n.useT();
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  // Quests are a trader's own loop: staff see a trader's quests in the curator profile. Staff who trade themselves (the
  // server gives them their own quests) get the personal tab too.
  const staffQuests = useQuestsMe(!!me && isCurator);
  const questsOn = !!me && (!isCurator || (staffQuests.data?.quests?.length ?? 0) > 0);

  // Staff = traders + extras (owner rule 2026-10-21): everyone with a trader name opens on their own «Мой прогресс»
  // like a trader; the curator tab stays one click away. Who is rated does not change.
  const [tab, setTab] = useStoredState<Tab>("ratings.tab", me ? "me" : isCurator ? "curator" : "leaderboard", TABS);
  // ?tab=quests (dashboard quest strip, rewards block, quest / achievement notifications) wins over the stored tab.
  const search = useSearch();
  useEffect(() => {
    const v = new URLSearchParams(search).get("tab") as Tab | null;
    if (v && TABS.includes(v)) setTab(v);
  }, [search, setTab]);
  // A choice made here is written to ?tab too, so a stale ?tab=quests from a link never wins over it on reload.
  const selectTab = (v: Tab) => { setTab(v); replaceSearchParams({ tab: v }); };
  const [dialog, setDialog] = useState<{ open: boolean; trader?: string; editing?: Rating | null }>({ open: false });
  const [deleting, setDeleting] = useState<Rating | null>(null);

  // Only real traders are rated: staff and the synthetic guest identity are excluded from the pending queue.
  const ratingTraders = useMemo(
    () => dbUsers.filter((u) => u.active && u.role !== "curator" && u.role !== "admin" && u.role !== "guest").map((u) => u.name),
    [dbUsers],
  );

  const ratingsQ = useQuery<Rating[]>({
    queryKey: ["ratings", "all"],
    queryFn: ({ signal }) => http.get<Rating[]>("/api/ratings", { signal }),
    // The full history (~850 rows / 400 KB for staff) feeds trends; mutations invalidate it, so no refetch per visit.
    staleTime: STALE.short,
  });
  const ratings = ratingsQ.data ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: number) => http.del(`/api/ratings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      setDeleting(null);
      toast({ title: ratingsI18n.t("page.deleted") });
    },
    onError: (e: Error) => toast({ title: commonI18n.t("states.error"), description: humanizeApiError(e, ratingsI18n.t("page.deleteFailed")), variant: "destructive" }),
  });

  const openRate = (trader?: string) => setDialog({ open: true, trader, editing: null });

  // N — new rating (curators), outside of text fields / open dialogs.
  useEffect(() => {
    if (!isCurator) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" && e.key.toLowerCase() !== "т") return; // i18n-ignore (Russian-layout N)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      e.preventDefault();
      openRate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCurator]);

  const thisWeek = weekOf();
  const pendingCount = isCurator ? ratingTraders.filter((name) => !ratings.some((r) => r.trader === name && r.week === thisWeek)).length : 0;

  // The views of the page are SectionTabs (design audit wave 3: Segmented is for filters and modes only).
  const tabOptions = [
    { value: "leaderboard" as const, icon: ListOrdered, label: t("page.tabLeaderboard") },
    {
      value: "curator" as const,
      icon: Star,
      label: <><span className="sm:hidden">{t("page.tabCuratorShort")}</span><span className="hidden sm:inline">{t("page.tabCurator")}</span></>,
      count: isCurator && pendingCount > 0 && !ratingsQ.isLoading ? pendingCount : undefined,
    },
    ...(me ? [{ value: "me" as const, icon: UserRound, label: t("page.tabMe") }] : []),
    ...(questsOn ? [{
      value: "quests" as const,
      icon: Swords,
      label: <><span className="sm:hidden">{tq("tab.short")}</span><span className="hidden sm:inline">{tq("tab.label")}</span></>,
    }] : []),
    // Season ranking + curator league: one tab for everyone (traders see aliases, staff names).
    { value: "season" as const, icon: CalendarClock, label: tg("season.tab") },
  ];
  const activeTab: Tab = (tab === "me" && !me) || (tab === "quests" && !questsOn) ? (isCurator ? "curator" : "leaderboard") : tab;
  // Usage (internal): the quests / season tabs opened (the tab lives in local storage, not in the URL).
  useEffect(() => { if (activeTab === "quests") trackAction("quests.tab"); else if (activeTab === "season") trackAction("season.tab"); }, [activeTab]);

  return (
    <Page>
      <PageHeader
        icon={Trophy}
        title={t("page.title")}
        description={t("page.description")}
        actions={isCurator ? (
          <Button onClick={() => openRate()} className="gap-1.5" title={t("page.hotkey")}>
            <Plus className="h-4 w-4" aria-hidden="true" /> {t("dialog.titleNew")}
            <Kbd className="ml-1 hidden sm:inline-flex">N</Kbd>
          </Button>
        ) : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Five tabs overflow a 375 px screen: the bar scrolls sideways and the cut edge fades as a hint. */}
          <SectionTabs ariaLabel={t("page.tabsAria")} tabs={tabOptions} value={activeTab} onChange={selectTab} className="min-w-0 flex-1" />
          {isCurator && pendingCount > 0 && activeTab !== "curator" && (
            <button type="button" className="chip min-h-8 px-3 text-sm" onClick={() => selectTab("curator")}>
              {t("page.pending", { week: weekLabel(thisWeek), count: pendingCount })}
            </button>
          )}
        </div>
      </PageHeader>

      {activeTab === "leaderboard" && <LeaderboardTab me={me} staff={isCurator} />}
      {activeTab === "curator" && (
        <ScorecardsTab
          ratings={ratings}
          isLoading={ratingsQ.isLoading}
          isError={ratingsQ.isError}
          error={ratingsQ.error}
          onRetry={() => ratingsQ.refetch()}
          isCurator={isCurator}
          isAdmin={isAdmin}
          me={me}
          traders={ratingTraders}
          onRate={openRate}
          onEdit={(r) => setDialog({ open: true, editing: r })}
          onDelete={setDeleting}
        />
      )}
      {activeTab === "me" && <MyProgressTab me={me} ratings={ratings} ratingsLoading={ratingsQ.isLoading} />}
      {activeTab === "quests" && <QuestsProgressTab header={<QuestsGamificationHeader />} extra={<QuestsGamificationExtras />} />}
      {activeTab === "season" && <SeasonTab participant={questsOn} />}

      {isCurator && (
        <RatingDialog
          open={dialog.open}
          onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
          traders={ratingTraders}
          ratings={ratings}
          me={me}
          initialTrader={dialog.trader}
          editing={dialog.editing}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("page.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? t("page.deleteDescription", { trader: personName(deleting.trader), week: weekLabel(deleting.week) }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (deleting) deleteMut.mutate(deleting.id); }}
              disabled={deleteMut.isPending}
              className="bg-down text-primary-foreground hover:bg-down/90"
            >
              {deleteMut.isPending ? t("page.deleting") : tc("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
