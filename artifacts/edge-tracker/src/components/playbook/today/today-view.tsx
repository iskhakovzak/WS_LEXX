/**
 * Playbook «Сегодня» — the morning-first landing (default for traders). On top, the focal point: «Мой план на
 * сегодня» (plan strip + the picked setups as full cheat sheets with real example charts; nothing picked → one-step
 * prefill). Below: «Все сетапы дня» — the day map, the setups by window, «Где у тебя преимущество». Phone: the same
 * order in one column. ?id= of an office setup opens its cheat sheet here.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import { EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { UsageMark } from "@/components/shared/usage-tracker";
import { MorningScreener } from "@/components/shared/finviz/screener-card";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import type { PlaybookToday } from "@/lib/playbook-today/types";
import { nyDate } from "@/lib/trading-date";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { CheatCard } from "./cheat-card";
import { DayMap } from "./day-map";
import { SetupDetails } from "./setup-details";
import { PlanToday } from "./plan-today";
import { EdgeSummaryPanel, WindowList } from "./today-landing";
import { sessionMinutes, starPick, suggestPicks } from "./today-model";
import { useNyMinutes, usePlaybookToday, useSavePicks } from "./use-today";

/**
 * «Сегодня торгую». Saved picks are the plan: a star / «Убрать» saves at once (optimistic). While nothing is saved,
 * the prefill (the trader's best unlocked setups of the first window) is a draft the plan prompt takes in one step.
 */
function usePicks(today: PlaybookToday | null | undefined, now: number | null) {
  const saved = useMemo(() => today?.picks ?? [], [today?.picks]);
  const [draft, setDraft] = useState<number[] | null>(null);
  const suggestion = useMemo(() => (today && now != null && !today.picks.length ? suggestPicks(today, now) : []), [today, now]);
  const savedKey = saved.join(",");
  useEffect(() => { setDraft(null); }, [savedKey]);
  const prompt = draft ?? suggestion;
  return { saved, prompt, suggestion, setDraft };
}

export function TodayView({
  header, selectedId, onOpen, onMissing,
}: {
  header: ReactNode;
  selectedId: number | null;
  onOpen: (id: number | null) => void;
  /** ?id= is not an office setup of «Сегодня» (a personal one): the page opens it in the library instead. */
  onMissing?: (id: number) => void;
}) {
  const { t } = playbookTodayI18n.useT();
  const { toast } = useToast();
  const { user } = useAuth();
  const q = usePlaybookToday();
  const today = q.data ?? null;
  const clock = useNyMinutes(today, q.dataUpdatedAt);
  // Weekend / holiday: the plan is for the next session — every window of it is still ahead (ROMAN-10).
  const session = today && clock != null ? sessionMinutes(today.date, nyDate(), clock) : null;
  const now = session?.now ?? clock;
  const save = useSavePicks(today?.date ?? null);
  const canPick = user?.role === "trader";
  const picks = usePicks(today, now);
  const missing = !!today && !!selectedId && !today.setups.some((s) => s.id === selectedId);
  useEffect(() => { if (missing && selectedId) onMissing?.(selectedId); }, [missing, selectedId, onMissing]);

  const failed = useCallback((e: unknown) => toast({ title: t("picks.failed"), description: (e as Error)?.message, variant: "destructive" }), [toast, t]);
  /** A star (list / card) or a prompt tile: with saved picks it saves at once (the saved picks are the plan); before
   * that it joins the prefill draft, which «Взять в план» saves in one step (starPick). */
  const toggle = useCallback((id: number) => {
    const r = starPick(picks.saved, picks.prompt, id);
    if (!r) { toast({ title: t("picks.max") }); return; }
    if (r.mode === "save") save.mutate(r.next, { onError: failed });
    else picks.setDraft(r.next);
  }, [picks, save, toast, t, failed]);
  /** Highlighted stars: the saved plan, or the draft while nothing is saved. */
  const starred = picks.saved.length ? picks.saved : picks.prompt;
  const take = () => {
    save.mutate(picks.prompt, { onSuccess: () => toast({ title: t("picks.savedToast") }), onError: failed });
  };
  const jump = (key: string) => document.getElementById(`pb-window-${key}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  let body: ReactNode;
  if (q.isLoading) {
    body = (
      <div className="flex flex-col gap-[var(--grid-gap)]" aria-busy="true">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1fr)_340px]"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
      </div>
    );
  } else if (q.isError) {
    body = <QueryError error={q.error} onRetry={() => void q.refetch()} message={t("loadFailed")} />;
  } else if (!today || now == null) {
    body = <div className="glass-panel rounded-2xl"><EmptyState icon={BookOpen} title={t("notLive")} /></div>;
  } else {
    const selected = selectedId ? today.setups.find((s) => s.id === selectedId) ?? null : null;
    if (selected) {
      body = (
        <div className="flex min-w-0 flex-col gap-3">
          <UsageMark action="playbook.cheat" meta={{ code: selected.code }} />
          <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => onOpen(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("card.back")}
          </Button>
          <CheatCard
            key={selected.id}
            setup={selected}
            oneR={today.oneR}
            date={today.date}
            canPick={canPick}
            showEdge={canPick}
            picked={starred.includes(selected.id)}
            onTogglePick={() => toggle(selected.id)}
          >
            <SetupDetails setupId={selected.id} />
          </CheatCard>
        </div>
      );
    } else {
      body = (
        <div className="flex min-w-0 flex-col gap-[calc(var(--page-gap)+0.5rem)]">
          <MorningScreener planDate={today.date} />
          {canPick && (
            <PlanToday
              today={today}
              saved={picks.saved}
              draft={picks.prompt}
              suggestion={picks.suggestion}
              saving={save.isPending}
              onToggle={toggle}
              onTake={take}
            />
          )}
          <section aria-labelledby="pb-all-h" className="flex min-w-0 flex-col gap-[var(--grid-gap)]">
            <h2 id="pb-all-h" className="text-lg font-semibold tracking-tight text-foreground">{canPick ? t("all.title") : t("all.titleStaff")}</h2>
            <DayMap windows={today.windows} now={now} onPick={jump} nextSession={session?.ahead ? today.date : null} />
            <div className="grid min-w-0 items-start gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1fr)_340px]">
              <aside className="flex min-w-0 flex-col gap-[var(--grid-gap)] lg:sticky lg:top-[var(--sticky-top)] lg:order-2">
                {canPick ? <EdgeSummaryPanel setups={today.setups} onOpen={(id) => onOpen(id)} /> : <p className="glass-panel rounded-2xl p-[var(--panel-p)] text-sm text-foreground/80">{t("staffNote")}</p>}
              </aside>
              <div className="min-w-0 lg:order-1">
                <WindowList today={today} now={now} draft={starred} canPick={canPick} onOpen={(id) => onOpen(id)} onTogglePick={toggle} />
              </div>
            </div>
          </section>
        </div>
      );
    }
  }
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <UsageMark action="playbook.today" />
      {header}
      {body}
    </div>
  );
}
