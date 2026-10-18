/**
 * «Найди вход» — a run of 10 short drills on playbook setups. Each drill: bars up to the decision window (tinted), the
 * player clicks / taps the entry (bar + price, kept inside the window and the bar's range), confirms (Enter), then the
 * reveal: the reference entry next to the pick, a 0–100 score, a short explanation, the real ticker and date, the
 * bars after. Next drill (Enter). The run ends with a summary (accuracy, hits, mastery change). The next drill is
 * fetched while the player reads the reveal, so one drill takes well under 30 s.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Crosshair, LogOut, RotateCcw, Timer, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Kbd, ListSkeleton, Pill, StatCard, StatGrid, toneText } from "@/components/ds";
import { fmtDate, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { humanizeApiError } from "@/lib/api/errors";
import { trainerI18n } from "@/i18n/ns/trainer";
import type { FindEntryAnswer, FindEntryDrill } from "@/lib/trainer/types";
import { fakeClock, fromWire, hhmm } from "./model";
import { BarFeed, SimChart, type ChartToggles } from "./sim-chart";
import { EMPTY_OVERLAY, type OverlayData } from "./sim-overlay";
import { DRILL_SECONDS, RUN_LENGTH, clampPick, pickDiff, runSummary, scoreTone, type DrillResult } from "./drill-model";
import { trainerApi, trainerKeys } from "./trainer-api";
import { useFinePointer } from "./use-fine-pointer";

/** Server text params → i18n params (nulls dropped). */
function textParams(p: Record<string, string | number | null> | undefined): Record<string, string | number> | undefined {
  if (!p) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) if (v != null) out[k] = v;
  return out;
}

const TOGGLES: ChartToggles = { vwap: true, levels: false, ma: false };
const NO_LEVELS = { pdh: null, pdl: null, pdc: null, pmh: null, pml: null };

type Phase = { k: "loading" } | { k: "empty" } | { k: "error"; message: string } | { k: "pick" } | { k: "answered"; answer: FindEntryAnswer } | { k: "summary" };

export function FindEntryRun({ setupId, onExit }: { setupId: number | null; onExit: () => void }) {
  const { t } = trainerI18n.useT();
  const qc = useQueryClient();
  const fine = useFinePointer();
  const [drill, setDrill] = React.useState<FindEntryDrill | null>(null);
  const [feed, setFeed] = React.useState<BarFeed | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ k: "loading" });
  const [pick, setPick] = React.useState<{ barIndex: number; price: number } | null>(null);
  const [results, setResults] = React.useState<DrillResult[]>([]);
  const [sending, setSending] = React.useState(false);
  const [left, setLeft] = React.useState(DRILL_SECONDS);
  const prefetched = React.useRef<Promise<FindEntryDrill | null> | null>(null);

  const fetchNext = React.useCallback(() => trainerApi.drillNext(setupId), [setupId]);

  const load = React.useCallback(async () => {
    setPhase({ k: "loading" });
    setPick(null);
    try {
      const pending = prefetched.current;
      prefetched.current = null;
      const d = (pending ? await pending : null) ?? (await fetchNext());
      setDrill(d);
      setFeed(new BarFeed(d.bars.map((b) => fromWire([b.t, b.o, b.h, b.l, b.c, b.v]))));
      setLeft(DRILL_SECONDS);
      setPhase({ k: "pick" });
    } catch (err) {
      const status = (err as { status?: number }).status;
      setPhase(status === 404 ? { k: "empty" } : { k: "error", message: humanizeApiError(err, t("drill.loadError")) });
    }
  }, [fetchNext, t]);

  React.useEffect(() => { void load(); }, [load]);

  // Soft 30-second budget per drill (shown, never forced).
  React.useEffect(() => {
    if (phase.k !== "pick") return;
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [phase.k, drill?.id]);

  const onPick = React.useCallback((idx: number, price: number) => {
    if (!drill || phase.k !== "pick") return;
    setPick(clampPick(drill, idx, price));
  }, [drill, phase.k]);

  const confirm = React.useCallback(async () => {
    if (!drill || !pick || sending || phase.k !== "pick") return;
    setSending(true);
    try {
      const answer = await trainerApi.drillAnswer(drill.id, pick);
      feed?.push(answer.barsAfter.map((b) => fromWire([b.t, b.o, b.h, b.l, b.c, b.v])));
      setResults((r) => [...r, { drillId: drill.id, setupName: drill.setupName, score: answer.score, masteryDelta: answer.masteryDelta }]);
      setPhase({ k: "answered", answer });
      if (results.length + 1 < RUN_LENGTH) prefetched.current = fetchNext().catch(() => null);
    } catch (err) {
      setPhase({ k: "error", message: humanizeApiError(err, t("drill.answerError")) });
    } finally {
      setSending(false);
    }
  }, [drill, pick, sending, phase.k, feed, results.length, fetchNext, t]);

  const next = React.useCallback(() => {
    if (results.length >= RUN_LENGTH) {
      setPhase({ k: "summary" });
      void qc.invalidateQueries({ queryKey: trainerKeys.all });
      void qc.invalidateQueries({ queryKey: ["gamification"], refetchType: "none" });
      return;
    }
    void load();
  }, [results.length, load, qc]);

  const again = React.useCallback(() => { setResults([]); void load(); }, [load]);

  // Enter: confirm the pick / next drill.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.tagName === "A")) return;
      if (phase.k === "pick" && pick) { e.preventDefault(); void confirm(); }
      else if (phase.k === "answered") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.k, pick, confirm, next]);

  const overlay: OverlayData = React.useMemo(() => {
    if (!drill) return EMPTY_OVERLAY;
    const picks: NonNullable<OverlayData["picks"]>[number][] = [];
    const answered = phase.k === "answered" ? phase.answer : null;
    const yours = answered?.yours ?? pick;
    if (yours) picks.push({ idx: yours.barIndex, price: yours.price, kind: "yours", text: t("drill.yours") });
    if (answered) picks.push({ idx: answered.ideal.barIndex, price: answered.ideal.price, kind: "ideal", text: t("drill.ideal") });
    return { ...EMPTY_OVERLAY, cursor: drill.window.to, zone: { ...drill.window, text: t("drill.zone") }, picks };
  }, [drill, pick, phase, t]);

  if (phase.k === "summary") return <RunSummary results={results} onAgain={again} onExit={onExit} />;

  const n = Math.min(results.length + (phase.k === "answered" ? 0 : 1), RUN_LENGTH);
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="accent"><Crosshair aria-hidden="true" />{t("findEntry.title")}</Pill>
        {drill && <span className="min-w-0 truncate text-sm font-medium">{drill.setupCode ? `${drill.setupCode} · ` : ""}{drill.setupName}</span>}
        {drill && <Pill tone={drill.side === "long" ? "up" : "down"}>{t(`drill.side.${drill.side}`)}</Pill>}
        <span className="text-xs tabular-nums text-muted-foreground">{t("drill.progress", { n, total: RUN_LENGTH })}</span>
        {phase.k === "pick" && (
          <span className={cn("flex items-center gap-1 text-xs tabular-nums", left === 0 ? "text-warn" : "text-muted-foreground")} aria-live="off">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />{left === 0 ? t("drill.timeUp") : t("drill.seconds", { count: left })}
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onExit}><LogOut aria-hidden="true" /> {t("drill.exit")}</Button>
      </div>

      {phase.k === "empty" ? (
        <EmptyState icon={Crosshair} title={t("drill.empty")} action={<Button onClick={onExit}>{t("drill.toHome")}</Button>} />
      ) : phase.k === "error" ? (
        <EmptyState icon={Crosshair} title={phase.message} action={<Button onClick={() => void load()}>{t("drill.retry")}</Button>} secondaryAction={<Button variant="ghost" onClick={onExit}>{t("drill.toHome")}</Button>} />
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="glass-panel relative h-[42dvh] min-h-[260px] overflow-hidden rounded-2xl p-1.5 sm:h-[55dvh] sm:p-2 lg:h-[calc(100dvh-13rem)] lg:min-h-[460px]">
            {feed && drill ? (
              <SimChart key={drill.id} feed={feed} mode="intraday" startIdx={drill.window.from} levels={NO_LEVELS} overlay={overlay} toggles={TOGGLES} className="min-h-[280px] cursor-crosshair" onPick={onPick} />
            ) : <ListSkeleton rows={6} />}
          </div>
          <aside className="glass-panel flex flex-col gap-2.5 rounded-2xl p-3 sm:gap-3 sm:p-[var(--panel-p)]">
            {phase.k === "answered" ? (
              <AnswerPanel answer={phase.answer} last={results.length >= RUN_LENGTH} onNext={next} fine={fine} />
            ) : (
              <>
                <div className={cn("tile rounded-xl p-3 text-sm", pick && "font-medium tabular-nums")} aria-live="polite">
                  {pick && drill
                    ? t("drill.pick", { time: hhmm(fakeClock(drill.bars[pick.barIndex]?.t ?? 0).min), price: fmtPrice(pick.price) })
                    : drill ? t(drill.side === "long" ? "drill.taskLong" : "drill.taskShort") : t("drill.loading")}
                </div>
                <Button size="lg" className="min-h-12" disabled={!pick || sending || phase.k !== "pick"} onClick={() => void confirm()}>
                  <Check aria-hidden="true" /> {sending ? t("drill.checking") : t("drill.confirm")} {fine && <Kbd className="border-white/30 bg-white/10 text-white/90">Enter</Kbd>}
                </Button>
                <p className="hidden text-2xs text-muted-foreground sm:block">{t("drill.hint")}</p>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export function AnswerPanel({ answer, last, onNext, fine }: { answer: FindEntryAnswer; last: boolean; onNext: () => void; fine: boolean }) {
  const { t, tryT } = trainerI18n.useT();
  // Server keys look like `trainer.findEntry.verdict.<v>` (this namespace without its name).
  const explain = tryT(answer.explanation.key.replace(/^trainer\./, ""), textParams(answer.explanation.params));
  const diff = pickDiff(answer);
  const fallback = diff.when === "onTime"
    ? t("explain.fallbackOnTime", { pct: diff.pricePct })
    : t(diff.when === "early" ? "explain.fallbackEarly" : "explain.fallbackLate", { count: diff.bars, pct: diff.pricePct });
  return (
    <div className="flex flex-col gap-2.5 sm:gap-3" role="status">
      <div className="tile flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl px-3 py-2 sm:block sm:p-3">
        <p className="text-2xs text-muted-foreground">{t("drill.score")}</p>
        <p className={cn("text-3xl font-semibold tabular-nums leading-tight sm:text-4xl", toneText(scoreTone(answer.score)))}>{answer.score}<span className="text-base text-muted-foreground">/100</span></p>
        {answer.masteryDelta !== 0 && (
          <p className={cn("text-xs font-medium", answer.masteryDelta > 0 ? "text-up" : "text-muted-foreground")}>{t("drill.mastery", { value: answer.masteryDelta > 0 ? `+${answer.masteryDelta}` : String(answer.masteryDelta) })}</p>
        )}
      </div>
      <p className="text-sm">{explain ?? fallback}</p>
      <p className="text-xs text-muted-foreground">
        {t("drill.revealed", { ticker: answer.revealed.ticker, date: fmtDate(answer.revealed.date, "medium") })} · {t(`drill.source.${answer.revealed.source}`)}
      </p>
      <Button size="lg" className="min-h-12" onClick={onNext} autoFocus={false}>
        {last ? <Trophy aria-hidden="true" /> : <ArrowRight aria-hidden="true" />} {last ? t("drill.toSummary") : t("drill.next")} {fine && <Kbd className="border-white/30 bg-white/10 text-white/90">Enter</Kbd>}
      </Button>
    </div>
  );
}

export function RunSummary({ results, onAgain, onExit }: { results: DrillResult[]; onAgain: () => void; onExit: () => void }) {
  const { t } = trainerI18n.useT();
  const s = runSummary(results);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-[var(--grid-gap)]">
      <section className="glass-panel rounded-2xl p-[var(--panel-p)]">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Trophy className="h-4 w-4 text-warn" aria-hidden="true" />{t("summary.title")}</h2>
        <StatGrid cols={3} className="mt-3">
          <StatCard label={t("summary.accuracy")} value={s.accuracy != null ? `${s.accuracy}` : "—"} tone={s.accuracy != null ? scoreTone(s.accuracy) : undefined} hint={t("summary.accuracyHint")} />
          <StatCard label={t("summary.hits")} value={`${s.hits}/${s.count}`} />
          <StatCard label={t("summary.mastery")} value={s.mastery > 0 ? `+${s.mastery}` : String(s.mastery)} tone={s.mastery > 0 ? "up" : "neutral"} />
        </StatGrid>
        <ol className="mt-3 flex flex-col gap-1">
          {results.map((r, i) => (
            <li key={`${r.drillId}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{r.setupName}</span>
              <span className={cn("w-10 text-right font-semibold tabular-nums", toneText(scoreTone(r.score)))}>{r.score}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="lg" onClick={onAgain}><RotateCcw aria-hidden="true" /> {t("summary.again", { count: RUN_LENGTH })}</Button>
          <Button size="lg" variant="ghost" onClick={onExit}>{t("drill.toHome")}</Button>
        </div>
      </section>
    </div>
  );
}
