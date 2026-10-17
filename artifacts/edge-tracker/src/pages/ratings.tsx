import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Plus, Star, Trophy, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Kbd } from "@/components/ui/kbd";
import { useToast } from "@/hooks/use-toast";
import { Page, PageHeader, Segmented } from "@/components/ds";
import { fetchJson, useStoredState } from "@/components/ratings/shared";
import { LeaderboardTab } from "@/components/ratings/leaderboard-tab";
import { ScorecardsTab } from "@/components/ratings/scorecards-tab";
import { MyProgressTab } from "@/components/ratings/my-progress-tab";
import { RatingDialog } from "@/components/ratings/rating-dialog";
import { weekLabel, weekOf, type Rating } from "@/components/ratings/scorecard-model";

type Tab = "leaderboard" | "curator" | "me";
const TABS: readonly Tab[] = ["leaderboard", "curator", "me"];

export default function RatingsPage() {
  const { user, isCurator, isAdmin, dbUsers } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;

  const [tab, setTab] = useStoredState<Tab>("ratings.tab", isCurator ? "curator" : me ? "me" : "leaderboard", TABS);
  const [dialog, setDialog] = useState<{ open: boolean; trader?: string; editing?: Rating | null }>({ open: false });
  const [deleting, setDeleting] = useState<Rating | null>(null);

  // Only real traders are rated: staff and the synthetic guest identity are excluded from the pending queue.
  const ratingTraders = useMemo(
    () => dbUsers.filter((u) => u.active && u.role !== "curator" && u.role !== "admin" && u.role !== "guest").map((u) => u.name),
    [dbUsers],
  );

  const ratingsQ = useQuery<Rating[]>({
    queryKey: ["ratings", "all"],
    queryFn: () => fetchJson<Rating[]>(`${BASE}/api/ratings`),
    // The full history (~850 rows / 400 KB for staff) feeds trends; mutations invalidate it, so no refetch per visit.
    staleTime: 60_000,
  });
  const ratings = ratingsQ.data ?? [];

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/ratings/${id}`, { method: "DELETE" });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "Не удалось удалить оценку");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      setDeleting(null);
      toast({ title: "Оценка удалена" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const openRate = (trader?: string) => setDialog({ open: true, trader, editing: null });

  // N — new rating (curators), outside of text fields / open dialogs.
  useEffect(() => {
    if (!isCurator) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" && e.key.toLowerCase() !== "т") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      e.preventDefault();
      openRate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCurator]);

  const thisWeek = weekOf();
  const pendingCount = isCurator ? ratingTraders.filter((t) => !ratings.some((r) => r.trader === t && r.week === thisWeek)).length : 0;

  const tabOptions = [
    { value: "leaderboard" as const, label: <span className="inline-flex items-center gap-1.5"><BarChart3 className="hidden h-4 w-4 sm:block" aria-hidden="true" />Лидерборд</span> },
    {
      value: "curator" as const,
      label: <span className="inline-flex items-center gap-1.5"><Star className="hidden h-4 w-4 sm:block" aria-hidden="true" /><span className="sm:hidden">Оценки</span><span className="hidden sm:inline">Оценки кураторов</span></span>,
      count: isCurator && pendingCount > 0 && !ratingsQ.isLoading ? pendingCount : undefined,
    },
    ...(me ? [{ value: "me" as const, label: <span className="inline-flex items-center gap-1.5"><UserRound className="hidden h-4 w-4 sm:block" aria-hidden="true" />Мой прогресс</span> }] : []),
  ];
  const activeTab: Tab = tab === "me" && !me ? "leaderboard" : tab;

  return (
    <Page>
      <PageHeader
        icon={Trophy}
        title="Рейтинг трейдеров"
        description="Автоматический лидерборд по сделкам, еженедельные оценки кураторов и личный прогресс"
        actions={isCurator ? (
          <Button onClick={() => openRate()} className="gap-1.5" title="Горячая клавиша N">
            <Plus className="h-4 w-4" aria-hidden="true" /> Оценить трейдера
            <Kbd className="ml-1 hidden sm:inline-flex">N</Kbd>
          </Button>
        ) : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Раздел рейтинга" options={tabOptions} value={activeTab} onChange={setTab} />
          {isCurator && pendingCount > 0 && activeTab !== "curator" && (
            <button type="button" className="chip min-h-8 px-3 text-sm" onClick={() => setTab("curator")}>
              Не оценено на неделе {weekLabel(thisWeek)}: {pendingCount}
            </button>
          )}
        </div>
      </PageHeader>

      {activeTab === "leaderboard" && <LeaderboardTab me={me} />}
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
            <AlertDialogTitle>Удалить оценку?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.trader} · неделя {deleting ? weekLabel(deleting.week) : ""}. Это нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (deleting) deleteMut.mutate(deleting.id); }}
              disabled={deleteMut.isPending}
              className="bg-down text-primary-foreground hover:bg-down/90"
            >
              {deleteMut.isPending ? "Удаляем…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
