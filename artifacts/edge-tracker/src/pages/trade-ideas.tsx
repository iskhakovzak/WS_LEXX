import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { replaceSearchParams } from "@/hooks/use-search-param";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { Lightbulb, PieChart, Plus, Scale, Search, Target, Timer, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState, ErrorState, Page, PageHeader, Panel, StatCard, StatGrid } from "@/components/ds";
import { useAuth, WriteOnly } from "@/contexts/auth-context";
import { stringToScreenshotUrls } from "@/components/screenshot-fields";
import { TradeIdeaForm, type TradeIdeaFormData } from "@/components/trade-idea-form";
import { IdeaBoard } from "@/components/ideas/IdeaBoard";
import { IdeaCard } from "@/components/ideas/IdeaCard";
import { IdeaDetailSheet } from "@/components/ideas/IdeaDetailSheet";
import { IdeasToolbar, type IdeasScope, type IdeasSort, type IdeasStageFilter, type IdeasView } from "@/components/ideas/IdeasToolbar";
import { IDEAS_KEY, useIdeaMutations, useIdeas, useTracking } from "@/components/ideas/hooks";
import {
  STAGES, ideaHorizon, ideaOutcome, ideaPlan, readPref, stageOf, writePref,
  type Horizon, type IdeaTracking, type Stage, type TradeIdea,
} from "@/components/ideas/model";
import { fmtDate, fmtNum, fmtR, fmtRate } from "@/lib/format";
import { nyDate, addDays } from "@/lib/trading-date";
import { useQueryClient } from "@tanstack/react-query";
import { useUndoDelete } from "@/hooks/use-undo-delete";
import { UndoToast } from "@/components/undo-toast";
import { ideasI18n } from "@/i18n/ns/ideas";
import { commonI18n } from "@/i18n/ns/common";
import { personName, comparePersonNames } from "@/i18n";

type View = IdeasView;
type Scope = IdeasScope;
type Sort = IdeasSort;
type StageFilter = IdeasStageFilter;

function urlPick<T extends string>(name: string, allowed: readonly string[], fallback: T): T {
  try {
    const v = new URLSearchParams(window.location.search).get(name);
    return v && (!allowed.length || allowed.includes(v)) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

const PREF = { view: "ideas.view", scope: "ideas.scope", sort: "ideas.sort", author: "ideas.author" };

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const el = t;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=dialog]");
}

function toFormInitial(i: TradeIdea): Partial<TradeIdeaFormData> {
  return {
    ticker: i.ticker, side: i.side ?? "Long", setup: i.setup ?? "", entryZone: i.entryZone ?? "",
    target: i.target ?? "", stop: i.stop ?? "", thesis: i.thesis ?? "",
    score: i.score != null ? String(i.score) : "", screenshotUrls: stringToScreenshotUrls(i.screenshotUrl),
    tags: i.tags ?? "", trader: i.trader ?? "",
    playbookId: i.playbookId, watchlistId: i.watchlistId,
    riskAmount: i.riskAmount ?? "", setupQuality: i.setupQuality ?? "",
    horizon: ideaHorizon(i), validUntil: i.validUntil ?? "",
  };
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-busy="true" aria-label={ideasI18n.t("page.loadingIdeas")}>
      {[0, 1, 2, 3, 4].map((c) => (
        <div key={c} className={c > 1 ? "hidden flex-col gap-2 xl:flex" : "flex flex-col gap-2"}>
          <Skeleton className="h-5 w-24 rounded-full" />
          {[0, 1].map((k) => <Skeleton key={k} className="h-40 w-full rounded-xl" />)}
        </div>
      ))}
    </div>
  );
}

export default function TradeIdeas() {
  const { user, isCurator, isAdmin, canEdit } = useAuth();
  const { t } = ideasI18n.useT();
  const { t: tc } = commonI18n.useT();
  const me = user?.traderName ?? "";
  const isReviewer = isCurator || isAdmin;
  const [, setLocation] = useLocation();
  const reduceMotion = useReducedMotion();
  const m = useIdeaMutations();
  const qc = useQueryClient();
  const undo = useUndoDelete(() => qc.invalidateQueries({ queryKey: IDEAS_KEY }));

  const { data: ideas = [], isLoading, isError, error, refetch } = useIdeas();
  const trackable = ideas.some((i) => i.status !== "draft");
  const { data: trackingData, isFetching: trackingFetching } = useTracking(trackable);
  const tracking: Record<string, IdeaTracking> = trackingData?.items ?? {};

  // ── view state (remembered) ──
  const [view, setViewState] = useState<View>(() =>
    readPref<View>(PREF.view, ["board", "list"], typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "board"));
  const [scope, setScopeState] = useState<Scope>(() => readPref<Scope>(PREF.scope, ["all", "mine"], "all"));
  const [sort, setSortState] = useState<Sort>(() => readPref<Sort>(PREF.sort, ["new", "score", "rr"], "new"));
  const [author, setAuthorState] = useState<string>(() => { try { return localStorage.getItem(PREF.author) || "all"; } catch { return "all"; } });
  // Stage / horizon / ticker filters ride in the URL (?stage= ?hz= ?ticker=): a reload or a shared link keeps them.
  const [stageFilter, setStageFilter] = useState<StageFilter>(() => urlPick<StageFilter>("stage", ["draft", "review", "active", "won", "lost", "rejected"], "all"));
  const [query, setQuery] = useState("");
  const [tickerFilter, setTickerFilter] = useState<string | null>(() => urlPick("ticker", [], "").toUpperCase() || null);
  const [horizon, setHorizon] = useState<"all" | Horizon>(() => urlPick<"all" | Horizon>("hz", ["intraday", "overnight", "swing"], "all"));
  const tickerRef = useRef<string | null>(null);
  useEffect(() => {
    tickerRef.current = tickerFilter;
    replaceSearchParams({ ticker: tickerFilter, stage: stageFilter, hz: horizon }, { stage: "all", hz: "all" });
  }, [tickerFilter, stageFilter, horizon]);
  const setView = (v: View) => { setViewState(v); writePref(PREF.view, v); };
  const setScope = (v: Scope) => { setScopeState(v); writePref(PREF.scope, v); };
  const setSort = (v: Sort) => { setSortState(v); writePref(PREF.sort, v); };
  const setAuthor = (v: string) => { setAuthorState(v); writePref(PREF.author, v); };

  // ── dialogs / sheet ──
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TradeIdea | null>(null);
  // `?new=1&ticker=XYZ` (watchlist, offerings, analyst) pre-fills the composer's ticker.
  const [prefillTicker, setPrefillTicker] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TradeIdea | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const stageById = useMemo(() => {
    const map = new Map<number, Stage>();
    for (const i of ideas) map.set(i.id, stageOf(i, tracking[String(i.id)]));
    return map;
  }, [ideas, tracking]);

  const authors = useMemo(
    () => Array.from(new Set(ideas.map((i) => i.trader).filter((t): t is string => !!t))).sort(comparePersonNames),
    [ideas],
  );

  // Filters except stage (stage counts are computed on this set).
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ideas.filter((i) => {
      if (scope === "mine" && i.trader !== me) return false;
      if (author !== "all" && i.trader !== author) return false;
      if (tickerFilter && i.ticker !== tickerFilter) return false;
      if (horizon !== "all" && ideaHorizon(i) !== horizon) return false;
      if (q) {
        const hay = [i.ticker, i.setup, i.thesis, i.tags, i.trader, personName(i.trader), i.longName].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [ideas, scope, me, author, tickerFilter, horizon, query]);

  const sorted = useMemo(() => {
    const arr = [...scoped];
    if (sort === "score") arr.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else if (sort === "rr") arr.sort((a, b) => (ideaPlan(b).rr ?? -1) - (ideaPlan(a).rr ?? -1));
    else arr.sort((a, b) => new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime());
    return arr;
  }, [scoped, sort]);

  const groups = useMemo(() => {
    const g: Record<Stage, TradeIdea[]> = { draft: [], review: [], active: [], won: [], lost: [], rejected: [] };
    for (const i of sorted) g[stageById.get(i.id) ?? "review"].push(i);
    return g;
  }, [sorted, stageById]);

  const listItems = useMemo(
    () => (stageFilter === "all" ? sorted : sorted.filter((i) => stageById.get(i.id) === stageFilter)),
    [sorted, stageFilter, stageById],
  );

  // Order used for J/K navigation in the sheet — mirrors what is on screen.
  const navOrder = useMemo(
    () => (view === "board" ? STAGES.flatMap((s) => groups[s.key]) : listItems),
    [view, groups, listItems],
  );

  // ── KPIs (on the scoped set) ──
  // Hit rate = won / (won + lost); break-even is counted separately (same rule as the win rate on trades).
  const kpi = useMemo(() => {
    let closedWon = 0, closedLost = 0, be = 0, expired = 0;
    for (const i of scoped) {
      const o = ideaOutcome(i, tracking[String(i.id)]);
      if (o === "win") closedWon++; else if (o === "loss") closedLost++; else if (o === "be") be++;
      if (i.expired) expired++;
    }
    const decided = closedWon + closedLost;
    const rrs = scoped.filter((i) => i.status !== "draft").map((i) => ideaPlan(i).rr).filter((r): r is number => r != null);
    const mfes = scoped.map((i) => tracking[String(i.id)]?.mfeR).filter((r): r is number => r != null);
    const inProfit = groups.active.filter((i) => (tracking[String(i.id)]?.rNow ?? 0) > 0).length;
    const myReviewQueue = groups.review.filter((i) => i.trader !== me).length;
    return {
      review: groups.review.length,
      myReviewQueue,
      active: groups.active.length,
      inProfit,
      expired,
      hitRate: decided > 0 ? closedWon / decided : null,
      closed: decided + be, closedWon, be,
      avgRR: rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : null,
      avgMfe: mfes.length ? mfes.reduce((a, b) => a + b, 0) / mfes.length : null,
    };
  }, [groups, scoped, tracking, me]);

  const selected = selectedId != null ? ideas.find((i) => i.id === selectedId) ?? null : null;
  const selectedStage = selected ? stageById.get(selected.id) ?? null : null;

  // ── URL deep links (handled on load and whenever the query changes while mounted) ──
  //   ?new=1            → open the composer        ?ticker=XYZ → ticker filter
  //   ?idea=ID / ?highlight=ID (activity feed, global search) → open that idea's sheet
  const search = useSearch();
  const handledIdeaParam = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(search);
    let strip = false;
    const t = params.get("ticker")?.trim().toUpperCase() || null;
    if (params.get("new") === "1") {
      if (canEdit) { setEditing(null); setPrefillTicker(t); setFormOpen(true); }
      params.delete("new"); strip = true;
    }
    if (t && t !== tickerRef.current) {
      tickerRef.current = t;
      setTickerFilter(t);
      if (!params.get("stage")) setStageFilter("all");
    }
    const raw = params.get("idea") ?? params.get("highlight");
    if (raw && !isLoading && raw !== handledIdeaParam.current) {
      handledIdeaParam.current = raw;
      const id = Number(raw);
      if (Number.isInteger(id) && ideas.some((i) => i.id === id)) {
        setSelectedId(id); setSheetOpen(true);
        params.delete("highlight"); params.set("idea", String(id));
      } else {
        params.delete("highlight"); params.delete("idea");
      }
      strip = true;
    }
    if (!raw) handledIdeaParam.current = null;
    if (strip) {
      const qs = params.toString();
      try { window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : "")); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, isLoading, ideas.length, canEdit]);

  function syncUrl(id: number | null) {
    handledIdeaParam.current = id != null ? String(id) : null;
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete("highlight");
      if (id != null) params.set("idea", String(id)); else params.delete("idea");
      const qs = params.toString();
      window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
    } catch { /* ignore */ }
  }

  function openIdea(i: TradeIdea) { setSelectedId(i.id); setSheetOpen(true); syncUrl(i.id); }
  function closeSheet(v: boolean) { setSheetOpen(v); if (!v) syncUrl(null); }
  function step(delta: number) {
    if (selectedId == null || navOrder.length === 0) return;
    const idx = navOrder.findIndex((i) => i.id === selectedId);
    const next = navOrder[(idx + delta + navOrder.length) % navOrder.length];
    if (next) { setSelectedId(next.id); syncUrl(next.id); }
  }

  function openCreate() { setEditing(null); setPrefillTicker(tickerFilter); setFormOpen(true); }
  function openEdit(i: TradeIdea) { setEditing(i); setFormOpen(true); }
  // Only close here: `editing` is cleared after the close animation (onCloseAutoFocus), so the title doesn't flip
  // to «Новая идея» while the dialog fades out.
  function closeForm() { setFormOpen(false); }

  const formInitial = useMemo(
    () => (editing ? toFormInitial(editing) : prefillTicker ? { ticker: prefillTicker } : undefined),
    [editing, prefillTicker],
  );

  // ── keyboard: N new, / search, J/K next/prev in sheet ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (sheetOpen && !formOpen && !deleting) {
        const t = e.target as HTMLElement | null;
        const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
        // Russian-layout twins of J / K / N (physical keys), not UI text.
        if (!typing && (e.key === "j" || e.key === "о")) { e.preventDefault(); step(1); } // i18n-ignore
        if (!typing && (e.key === "k" || e.key === "л")) { e.preventDefault(); step(-1); } // i18n-ignore
        return;
      }
      if (isTypingTarget(e.target) || formOpen) return;
      if ((e.key === "n" || e.key === "т") && canEdit) { e.preventDefault(); openCreate(); } // i18n-ignore
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const submitting = m.create.isPending || m.update.isPending;
  function handleSave(data: TradeIdeaFormData, publish: boolean) {
    if (editing) {
      m.update.mutate({ id: editing.id, data, publish: publish && editing.status === "draft" }, { onSuccess: closeForm });
    } else {
      m.create.mutate({ data, publish }, { onSuccess: closeForm });
    }
  }

    const resetFilters = () => { setScope("all"); setAuthor("all"); setHorizon("all"); setSort("new"); setTickerFilter(null); setQuery(""); setStageFilter("all"); };

  // Day groups for list view (only when sorted by date). Days are NY trading dates, like everywhere on the desk.
  const dayGroups = useMemo(() => {
    if (sort !== "new") return [{ key: "all", label: "", items: listItems }];
    const today = nyDate();
    const yesterday = addDays(today, -1);
    const out: { key: string; label: string; items: TradeIdea[] }[] = [];
    for (const i of listItems) {
      const d = new Date(i.publishedAt ?? i.createdAt);
      const key = i.ideaDate ?? nyDate(d);
      const label = key === today ? tc("time.today") : key === yesterday ? tc("time.yesterday")
        : fmtDate(key, "long");
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(i); else out.push({ key, label, items: [i] });
    }
    return out;
  }, [listItems, sort, tc]);

  const anim = reduceMotion ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const } };

  const noIdeas = !isLoading && !isError && ideas.length === 0;
  return (
    <Page>
      <PageHeader
        title={t("page.title")}
        icon={Lightbulb}
        description={isLoading ? t("page.loading") : t("page.summary", { active: kpi.active, review: kpi.review, total: ideas.length })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setLocation("/trade-idea-stats")} className="gap-1.5">
              <PieChart className="h-4 w-4" aria-hidden="true" /> {t("page.stats")}
            </Button>
            <WriteOnly>
              <Button size="sm" onClick={openCreate} className="hidden gap-1.5 sm:inline-flex" title={t("page.newIdeaTitle")}>
                <Plus className="h-4 w-4" aria-hidden="true" /> {t("page.newIdea")}
                <kbd className="ml-0.5 rounded-full bg-white/20 px-1.5 text-2xs font-medium">N</kbd>
              </Button>
            </WriteOnly>
          </>
        }
      />

      {/* An empty page shows its empty state alone: no KPI row of zeros and no filters until the first idea (design audit). */}
      {!noIdeas && <>
      <StatGrid>
        <StatCard
          label={isReviewer ? t("page.awaitingReview") : t("page.onReview")}
          value={kpi.review}
          icon={Timer}
          tone={kpi.review > 0 ? "warn" : "neutral"}
          hint={isReviewer ? (kpi.myReviewQueue > 0 ? t("page.fromTeam", { count: kpi.myReviewQueue }) : t("page.queueEmpty")) : t("page.awaitingCurator")}
          onClick={() => { setView("list"); setStageFilter("review"); }}
        />
        <StatCard
          label={t("page.active")}
          value={kpi.active}
          icon={TrendingUp}
          tone={kpi.active > 0 ? "accent" : "neutral"}
          hint={kpi.active > 0 ? t("page.inProfit", { count: kpi.inProfit }) : t("page.activeHint")}
          onClick={() => { setView("list"); setStageFilter("active"); }}
        />
        <StatCard
          label={t("page.accuracy")}
          value={fmtRate(kpi.hitRate)}
          icon={Target}
          tone={kpi.hitRate == null ? "neutral" : kpi.hitRate >= 0.5 ? "up" : "down"}
          hint={kpi.closed > 0
            ? [
                t("page.accuracyHint", { won: kpi.closedWon, decided: kpi.closed - kpi.be }),
                kpi.be ? t("page.accuracyBe", { count: kpi.be }) : null,
                kpi.expired ? t("page.accuracyExpired", { count: kpi.expired }) : null,
              ].filter(Boolean).join(" · ")
            : t("page.accuracyEmpty")}
          onClick={() => { setView("list"); setStageFilter("won"); }}
        />
        <StatCard
          label={t("page.avgRr")}
          value={fmtNum(kpi.avgRR, 2)}
          icon={Scale}
          tone={kpi.avgRR == null ? "neutral" : kpi.avgRR >= 2 ? "up" : kpi.avgRR >= 1 ? "warn" : "down"}
          hint={kpi.avgMfe != null ? t("page.avgMfe", { r: fmtR(kpi.avgMfe, 1) }) : t("page.avgRrHint")}
        />
      </StatGrid>

      <IdeasToolbar
        f={{ query, view, scope, author, horizon, sort, stage: stageFilter, ticker: tickerFilter }}
        set={{ setQuery, setView, setScope, setAuthor, setHorizon, setSort, setStage: setStageFilter, setTicker: setTickerFilter }}
        me={me}
        authors={authors}
        stageCounts={{ draft: groups.draft.length, review: groups.review.length, active: groups.active.length, won: groups.won.length, lost: groups.lost.length, rejected: groups.rejected.length }}
        total={sorted.length}
        resultCount={view === "list" ? listItems.length : scoped.length}
        updating={trackingFetching}
        searchRef={searchRef}
        onReset={resetFilters}
      />
      </>}

      {isLoading && <BoardSkeleton />}

      {isError && <ErrorState title={t("page.loadFailed")} error={error} onRetry={refetch} />}

      {noIdeas && (
        <Panel>
          <EmptyState
            icon={Lightbulb}
            title={t("page.emptyTitle")}
            description={t("page.emptyDescription")}
            action={canEdit ? <Button onClick={openCreate} className="gap-1.5"><Plus className="h-4 w-4" />{t("page.createFirst")}</Button> : undefined}
          />
        </Panel>
      )}

      {!isLoading && !isError && ideas.length > 0 && scoped.length === 0 && (
        <Panel>
          <EmptyState
            icon={Search}
            title={tc("states.nothingFound")}
            description={scope === "mine" ? t("page.noMine") : t("page.tryFilters")}
            action={<Button variant="outline" size="sm" onClick={resetFilters}>{tc("actions.resetFilters")}</Button>}
          />
        </Panel>
      )}

      {!isLoading && !isError && scoped.length > 0 && view === "board" && (
        <motion.div key="board" {...anim}>
          <IdeaBoard groups={groups} tracking={tracking} onOpen={openIdea} query={query.trim()} selectedId={sheetOpen ? selectedId : null} />
        </motion.div>
      )}

      {!isLoading && !isError && scoped.length > 0 && view === "list" && (
        <motion.div key={`list-${stageFilter}`} {...anim} className="flex flex-col gap-5">
          {listItems.length === 0 && (
            <Panel>
              <EmptyState title={t("page.emptyStage")} description={STAGES.find((s) => s.key === stageFilter)?.hint} />
            </Panel>
          )}
          {dayGroups.map((g) => (
            <section key={g.key} className="flex flex-col gap-2" aria-label={g.label || t("page.ideasAria")}>
              {g.label && (
                <div className="flex items-center gap-3 px-1">
                  <h2 className="text-sm font-semibold text-foreground">{g.label}</h2>
                  <div className="h-px flex-1 bg-[var(--field-border)]" />
                  <span className="text-xs tabular-nums text-muted-foreground">{g.items.length}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {g.items.map((i) => (
                  <IdeaCard
                    key={i.id}
                    idea={i}
                    stage={stageById.get(i.id) ?? "review"}
                    tracking={tracking[String(i.id)]}
                    onOpen={openIdea}
                    query={query.trim()}
                    showStage
                    selected={sheetOpen && selectedId === i.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </motion.div>
      )}

      {/* Mobile: bottom-reachable primary action */}
      <WriteOnly>
        <Button
          onClick={openCreate}
          aria-label={t("page.newIdea")}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-nav h-14 w-14 rounded-full p-0 shadow-lg sm:hidden"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </Button>
      </WriteOnly>

      <IdeaDetailSheet
        idea={selected}
        stage={selectedStage}
        tracking={selected ? tracking[String(selected.id)] : null}
        open={sheetOpen && !!selected}
        onOpenChange={closeSheet}
        onEdit={(i) => openEdit(i)}
        onDelete={(i) => setDeleting(i)}
        onPrev={navOrder.length > 1 ? () => step(-1) : undefined}
        onNext={navOrder.length > 1 ? () => step(1) : undefined}
        sameTickerCount={selected ? ideas.filter((i) => i.ticker === selected.ticker).length : 0}
        onFilterTicker={(t) => { setTickerFilter(t); setSheetOpen(false); syncUrl(null); }}
      />

      <Dialog open={formOpen} onOpenChange={(v) => { if (!v) closeForm(); }}>
        <DialogContent
          className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto overscroll-contain rounded-2xl"
          onCloseAutoFocus={() => { setEditing(null); setPrefillTicker(null); }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? t("page.editTitle", { ticker: editing.ticker }) : t("page.newIdea")}</DialogTitle>
            <DialogDescription>
              {editing
                ? editing.review_status === "needs_work" ? t("page.editNeedsWork") : t("page.editVisible")
                : t("page.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <TradeIdeaForm
            initial={formInitial}
            onSubmit={(d) => handleSave(d, false)}
            onSubmitAndPublish={!editing || editing.status === "draft" ? (d) => handleSave(d, true) : undefined}
            submitLabel={editing && editing.status !== "draft" ? tc("actions.save") : t("form.saveDraft")}
            onCancel={closeForm}
            submitting={submitting}
            draftKey={`idea:${editing?.id ?? "new"}`}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("page.deleteTitle", { ticker: deleting?.ticker ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("page.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={m.remove.isPending}
              onClick={() => {
                if (!deleting) return;
                const id = deleting.id;
                const ticker = deleting.ticker;
                m.remove.mutate(id, {
                  onSuccess: () => {
                    if (selectedId === id) { setSheetOpen(false); syncUrl(null); }
                    undo.scheduleUndo(id, "trade-ideas", t("page.undoLabel", { ticker }));
                  },
                  onSettled: () => setDeleting(null),
                });
              }}
              className="border border-down/30 bg-down/15 text-down hover:bg-down/25"
            >
              {tc("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {undo.pending && (
        <UndoToast key={undo.pending.id} label={undo.pending.label} onUndo={undo.restore} onDismiss={undo.dismiss} restoring={undo.restoring} actionText={t("page.undoDeleted")} />
      )}
    </Page>
  );
}
