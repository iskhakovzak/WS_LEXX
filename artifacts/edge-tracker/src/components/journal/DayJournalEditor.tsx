import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, NotebookPen, Plus } from "lucide-react";
import { Panel } from "@/components/ds";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { KEYS } from "@/lib/api/keys";
import { nyDate } from "@/lib/trading-date";
import { useDayReport } from "@/components/day-report/api";
import {
  emptySummary, eodApi, splitMissing, useEodDay, useEodMutation, type EodDayPayload, type MissingItem,
} from "@/components/eod/eod-api";
import {
  type JournalEntry, type StorageMode, JournalConflict, emptyEntry, hasReview, isEntryEmpty, useJournalRange, useSaveJournalDay,
} from "./use-journal-days";
import type { RuleViolation } from "./DayTrades";
import { stepWeekday } from "./utils";
import { fmtDate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { journalI18n } from "@/i18n/ns/journal";
import { personName } from "@/i18n";
import { MOOD_LABELS, DISCIPLINE_LABELS, MISTAKE_TAGS, GOOD_TAGS, EMOTION_TAGS, CALM_EMOTIONS, sameTag } from "./vocab";
import {
  ChipGroup, LessonStep, MorningCheckin, PlanBlock, ReviewField, SaveIndicator, ScaleField, Step, followedAnswer, type SaveState,
} from "./day-journal-parts";
import { CloseBar, CuratorFeedback, EodSelfReview } from "./day-journal-close";

export { MOOD_LABELS, DISCIPLINE_LABELS, MISTAKE_TAGS, GOOD_TAGS, EMOTION_TAGS, followedAnswer };

const TEXT_LIMIT = 4000; // eod summary fields (repeat / stop) are capped server-side

/**
 * GET /api/eod/day additions (Волна 0, items 0.4 / 0.5): `closeOpensAt` — today before the market close, the NY time
 * the day opens for closing («16:00», «13:00» on a short day); `closedVia` — "daily" when «Разобрал» (dashboard /
 * Telegram) closed the day: the form then extends it (send the summary without reopening); `traderNote` — the note
 * left with «Разобрал». Absent on older API builds.
 */
type EodDayView = EodDayPayload & { closeOpensAt?: string | null; closedVia?: "daily" | "journal" | null; traderNote?: string | null };

/**
 * «Дневник дня»: a short guided reflection on top of the automatically imported trades —
 * plan of the day → mood / discipline / emotions → what worked / what didn't → lesson + rule violations →
 * focus for tomorrow (written into the next trading day's plan). Autosaves; closes the day for the curator.
 */
export function DayJournalEditor({
  trader,
  date,
  today,
  entry,
  editable,
  mode,
  isLoading,
  legacyNote,
  hasTrades,
  violations,
  untaggedIds,
  onOpenTradeReview,
}: {
  trader: string;
  date: string;
  today: string;
  entry: JournalEntry | null;
  editable: boolean;
  mode: StorageMode;
  isLoading: boolean;
  legacyNote: string;
  hasTrades: boolean;
  /** Auto-detected rule violations on the day's trades. */
  violations: RuleViolation[];
  /** Broker trades without a setup (soft reminder). */
  untaggedIds: number[];
  /** Optional per-trade review (setup / grade / followed plan / lesson). */
  onOpenTradeReview?: () => void;
}) {
  const { toast } = useToast();
  const { t } = journalI18n.useT();
  const save = useSaveJournalDay();
  const key = `${trader}|${date}`;
  const isFuture = date > today;
  const nextDate = stepWeekday(date, 1);
  const eodQ = useEodDay(trader, date, !!trader && !isFuture);
  const eod: EodDayView | null = eodQ.data ?? null;

  const initialFor = useCallback((): { draft: JournalEntry; fromLegacy: boolean } => {
    if (entry && !isEntryEmpty(entry)) return { draft: entry, fromLegacy: false };
    if (editable && legacyNote.trim()) return { draft: { ...emptyEntry(trader, date), lessons: legacyNote }, fromLegacy: true };
    return { draft: emptyEntry(trader, date), fromLegacy: false };
  }, [entry, editable, legacyNote, trader, date]);

  const [draft, setDraft] = useState<JournalEntry>(() => initialFor().draft);
  const [fromLegacy, setFromLegacy] = useState(() => initialFor().fromLegacy);
  const [status, setStatus] = useState<SaveState>({ kind: "idle" });
  const focusRef = useRef("");
  const [focusText, setFocusText] = useState("");
  const onFocusText = useCallback((t: string) => { focusRef.current = t; setFocusText(t); }, []);

  const dirtyRef = useRef(false);
  const draftRef = useRef(draft);
  const keyRef = useRef(key);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  draftRef.current = draft;

  const persist = useCallback(
    (e: JournalEntry, quiet = true) => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      // One write at a time: a second PUT with the old `updatedAt` would be refused as a conflict.
      if (inFlightRef.current) { timerRef.current = setTimeout(() => persist(draftRef.current, quiet), 400); return; }
      inFlightRef.current = true;
      dirtyRef.current = false;
      setStatus({ kind: "saving" });
      save.mutate(e, {
        onSuccess: (out) => {
          if (keyRef.current === `${e.trader}|${e.date}`) {
            // Carry the server version forward so the next autosave is not mistaken for a stale tab.
            draftRef.current = { ...draftRef.current, updatedAt: out.entry.updatedAt ?? null, pendingSync: out.entry.pendingSync };
            setDraft(draftRef.current);
            setStatus({ kind: "saved", at: new Date() });
            setFromLegacy(false);
          }
          if (!quiet) toast({ title: journalI18n.t("editor.saved"), description: fmtDate(e.date, "dayMonth") });
        },
        onError: (err) => {
          if (err instanceof JournalConflict) {
            const cur = err.current ?? emptyEntry(e.trader, e.date);
            if (keyRef.current === `${e.trader}|${e.date}`) {
              setDraft(cur);
              draftRef.current = cur;
              dirtyRef.current = false;
              setStatus({ kind: "idle" });
            }
            toast({ title: journalI18n.t("editor.conflictTitle"), description: journalI18n.t("editor.conflictDesc") });
            return;
          }
          dirtyRef.current = true;
          setStatus({ kind: "error", message: (err as Error)?.message ?? commonI18n.t("states.error") });
          toast({ title: journalI18n.t("editor.saveFailed"), description: (err as Error)?.message, variant: "destructive" });
        },
        onSettled: () => { inFlightRef.current = false; },
      });
    },
    [save, toast],
  );

  // Switch day/trader: flush unsaved changes of the previous day, then load the new one.
  useEffect(() => {
    if (keyRef.current !== key) {
      if (dirtyRef.current && editable) persist(draftRef.current);
      keyRef.current = key;
      const init = initialFor();
      setDraft(init.draft);
      setFromLegacy(init.fromLegacy);
      setStatus({ kind: "idle" });
      dirtyRef.current = false;
      return;
    }
    if (!dirtyRef.current) {
      const init = initialFor();
      setDraft(init.draft);
      setFromLegacy(init.fromLegacy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entry, legacyNote]);

  useEffect(() => () => {
    if (dirtyRef.current && timerRef.current) {
      clearTimeout(timerRef.current);
      save.mutate(draftRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<JournalEntry>) => {
    if (!editable) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    dirtyRef.current = true;
    setStatus({ kind: "idle" });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(draftRef.current), 1200);
  };

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        persist(draftRef.current, false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, persist]);

  const toggleTag = (tag: string) => {
    const has = draft.tags.some((x) => sameTag(x, tag));
    update({ tags: has ? draft.tags.filter((x) => !sameTag(x, tag)) : [...draft.tags, tag] });
  };

  // ── Close / reopen the day (EOD) ─────────────────────────────────────────
  const qc = useQueryClient();
  const close = useEodMutation(
    (b: { discipline: number | null; summary: ReturnType<typeof emptySummary> }) => eodApi.close(date, b),
    (out) => {
      // One closure: a closed journal day is the reviewed evening card on the dashboard and the «review» quest (ILYA-06).
      void qc.invalidateQueries({ queryKey: KEYS.dailyMe(nyDate()) });
      void qc.invalidateQueries({ queryKey: KEYS.questsMe() });
      const s = out.streaks;
      toast({
        title: journalI18n.t("editor.dayClosed", { date: fmtDate(date, "dayMonth") }),
        description: s.closedStreak > 1
          ? journalI18n.t("editor.sentToCuratorStreak", { days: commonI18n.t("units.days", { count: s.closedStreak }) })
          : journalI18n.t("editor.sentToCurator"),
      });
    },
  );
  const reopen = useEodMutation(() => eodApi.reopen(date));
  const doClose = async () => {
    if (!eod) return;
    // Let the pending autosave land first: closing touches the journal row, a later PUT would look like a stale tab.
    if (dirtyRef.current) persist(draftRef.current);
    for (let i = 0; i < 50 && (inFlightRef.current || dirtyRef.current || timerRef.current); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const d = draftRef.current;
    close.mutate(
      {
        discipline: d.discipline,
        summary: {
          ...emptySummary(),
          ...(eod.day?.summary ?? {}),
          mood: d.mood,
          repeat: d.well.trim().slice(0, TEXT_LIMIT),
          stop: d.mistakes.trim().slice(0, TEXT_LIMIT),
          tomorrow: focusRef.current.trim().slice(0, 6000),
        },
      },
      {
        onError: (e) => {
          type Extra = { missing?: MissingItem[]; opensAt?: string };
          const err = e as Error & { status?: number; body?: Extra & { details?: Extra } };
          const extra: Extra = { ...err.body, ...err.body?.details };
          const n = extra.missing?.length ?? 0;
          toast({
            title: journalI18n.t("editor.notClosed"),
            description: extra.opensAt
              ? journalI18n.t("editor.closeAfterMarket", { time: extra.opensAt })
              : err.status === 422 && n ? journalI18n.t("editor.missingSetup", { count: n }) : err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const reviewFilled = hasReview(draft);
  const progress = [draft.mood != null, !!draft.well.trim(), !!draft.mistakes.trim(), !!draft.lessons.trim(), !!focusText.trim()];

  return (
    <Panel
      title={t("editor.title")}
      icon={NotebookPen}
      description={editable ? (isFuture ? t("editor.descFuture") : t("editor.descToday")) : t("editor.descReadOnly", { trader: personName(trader) })}
      actions={<SaveIndicator status={status} mode={mode} editable={editable} onRetry={() => persist(draftRef.current, false)} />}
    >
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {eod?.day?.reviewedAt && <CuratorFeedback day={eod.day} />}

          <PlanBlock
            value={draft.plan}
            editable={editable}
            prominent={isFuture || (date === today && !hasTrades)}
            onChange={(plan) => update({ plan })}
          />

          {isFuture ? (
            <p className="text-sm text-muted-foreground">{t("editor.reviewLater")}</p>
          ) : !editable && isEntryEmpty(entry) ? (
            eod?.day?.closedAt ? <EodSelfReview day={eod.day} quick={eod.closedVia === "daily"} note={eod.traderNote ?? null} /> : (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("editor.notFilledBy", { trader: personName(trader) })}</p>
            )
          ) : (
            <>
              {fromLegacy && (
                <p className="rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
                  {t("editor.legacyMoved")}
                </p>
              )}

              <Step n={1} title={t("editor.step1")} aside={<MorningCheckin trader={trader} date={date} />}>
                <div className="grid gap-4 md:grid-cols-2">
                  <ScaleField label={t("editor.mood")} labels={MOOD_LABELS} value={draft.mood} editable={editable} onChange={(v) => update({ mood: v })} />
                  <ScaleField label={t("editor.discipline")} labels={DISCIPLINE_LABELS} value={draft.discipline} editable={editable} onChange={(v) => update({ discipline: v })} />
                </div>
                <ChipGroup
                  label={t("editor.emotions")}
                  options={EMOTION_TAGS}
                  selected={draft.tags}
                  editable={editable}
                  toneOf={(tag) => (CALM_EMOTIONS.has(tag) ? "up" : "warn")}
                  onToggle={toggleTag}
                />
              </Step>

              <Step n={2} title={t("editor.step2")}>
                <div className="grid gap-3 md:grid-cols-2">
                  <ReviewField id="journal-well" label={t("editor.well")} tone="up" value={draft.well} editable={editable}
                    placeholder={t("editor.wellPlaceholder")} onChange={(v) => update({ well: v })} />
                  <ReviewField id="journal-mistakes" label={t("editor.mistakes")} tone="down" value={draft.mistakes} editable={editable}
                    placeholder={t("editor.mistakesPlaceholder")} onChange={(v) => update({ mistakes: v })} />
                </div>
              </Step>

              <Step n={3} title={t("editor.step3")}>
                <LessonStep draft={draft} editable={editable} violations={violations} update={update} toggleTag={toggleTag} />
              </Step>

              <Step n={4} title={t("editor.step4", { date: fmtDate(nextDate, "dayMonth") })}>
                <TomorrowFocus
                  key={`${trader}|${nextDate}`}
                  trader={trader}
                  date={date}
                  nextDate={nextDate}
                  editable={editable}
                  onText={onFocusText}
                />
              </Step>
            </>
          )}

          {!isFuture && eod && (
            <CloseBar
              eod={eod} blocking={splitMissing(eod).blocking}
              editable={editable}
              hasTrades={hasTrades}
              reviewFilled={reviewFilled}
              progress={progress.filter(Boolean).length}
              untaggedIds={untaggedIds}
              closing={close.isPending}
              reopening={reopen.isPending}
              onClose={() => { void doClose(); }}
              onReopen={() => reopen.mutate(undefined, { onError: (e) => toast({ title: t("editor.reopenFailed"), description: (e as Error).message, variant: "destructive" }) })}
              onOpenTradeReview={onOpenTradeReview}
              showNote={!(!editable && isEntryEmpty(entry) && !!eod.day?.closedAt)}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * «Фокус на завтра» = the plan of the next trading day (same journal row the next morning opens with).
 * Own autosave against that day's entry; mounted with a key per day so switching days flushes cleanly.
 */
function TomorrowFocus({
  trader, date, nextDate, editable, onText,
}: { trader: string; date: string; nextDate: string; editable: boolean; onText: (t: string) => void }) {
  const { toast } = useToast();
  const { t } = journalI18n.useT();
  const range = useJournalRange(trader, nextDate, nextDate, !!trader);
  const loaded = range.entries.find((e) => e.trader === trader && e.date === nextDate) ?? null;
  const save = useSaveJournalDay();
  const qc = useQueryClient();
  const report = useDayReport(trader, date, editable && !!trader);
  const suggestions = (report.data?.date === date ? report.data.plan : []).slice(0, 3);

  const [text, setText] = useState(loaded?.plan ?? "");
  const baseRef = useRef<JournalEntry | null>(loaded);
  const textRef = useRef(text);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  textRef.current = text;

  useEffect(() => { onText(text); }, [text, onText]);
  useEffect(() => {
    if (dirty.current || inFlight.current) return;
    baseRef.current = loaded;
    setText(loaded?.plan ?? "");
  }, [loaded]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current) return;
    if (inFlight.current) { timer.current = setTimeout(() => flush(), 400); return; }
    dirty.current = false;
    inFlight.current = true;
    const base = baseRef.current ?? emptyEntry(trader, nextDate);
    save.mutate({ ...base, trader, date: nextDate, plan: textRef.current }, {
      onSuccess: (out) => {
        baseRef.current = out.entry;
        // The pick is tomorrow's focus on the dashboard / plan / playbook (curator > own > auto, DENIS-03).
        void qc.invalidateQueries({ queryKey: KEYS.dailyMe(nyDate()) });
      },
      onError: (err) => {
        if (err instanceof JournalConflict) {
          baseRef.current = err.current;
          dirty.current = true; // re-apply our text on top of the newer version
          timer.current = setTimeout(() => flush(), 50);
          return;
        }
        dirty.current = true;
        toast({ title: journalI18n.t("editor.focusNotSaved"), description: (err as Error).message, variant: "destructive" });
      },
      onSettled: () => { inFlight.current = false; },
    });
  }, [save, toast, trader, nextDate, qc]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (dirty.current) flushRef.current(); }, []);

  const change = (v: string) => {
    setText(v);
    textRef.current = v;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 1200);
  };

  if (!editable) {
    return text.trim()
      ? <p className="whitespace-pre-wrap rounded-xl bg-[var(--glass-bg)] p-3 text-sm leading-relaxed">{text}</p>
      : <p className="text-xs text-muted-foreground">{t("editor.notFilled")}</p>;
  }
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={t("editor.focusAria")}
        value={text}
        maxLength={6000}
        onChange={(e) => change(e.target.value)}
        onBlur={() => flushRef.current()}
        placeholder={t("editor.focusPlaceholder")}
        className="min-h-[72px] leading-relaxed"
      />
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <div className="text-2xs text-muted-foreground">{t("editor.suggestions")}</div>
          <ul className="flex flex-col gap-1">
            {suggestions.map((s) => {
              const added = text.includes(s.text);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => change(`${text.trim() ? `${text.trimEnd()}\n` : ""}• ${s.text}`)}
                    className="tile tile-interactive flex w-full items-start gap-2 px-3 py-2 text-left text-xs disabled:opacity-60"
                  >
                    {added ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-up" aria-hidden="true" /> : <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                    <span>{s.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-2xs text-muted-foreground">{t("editor.focusSavesAs", { date: fmtDate(nextDate, "dayMonth") })}</p>
    </div>
  );
}
