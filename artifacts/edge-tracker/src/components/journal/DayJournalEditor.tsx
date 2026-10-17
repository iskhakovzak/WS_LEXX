import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowUpRight, Check, CheckCircle2, CloudOff, ListChecks, Loader2, Lock, LockOpen, MessageSquareText,
  NotebookPen, Plus, ShieldAlert, Sunrise, X,
} from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useDayReport } from "@/components/day-report/api";
import {
  emptySummary, eodApi, splitMissing, useEodDay, useEodMutation, type EodDayPayload, type MissingItem,
} from "@/components/eod/eod-api";
import {
  type JournalEntry, type StorageMode, JournalConflict, emptyEntry, hasReview, isEntryEmpty, useJournalRange, useSaveJournalDay,
} from "./use-journal-days";
import type { RuleViolation } from "./DayTrades";
import { fmtDayShort, plural, stepWeekday } from "./utils";

export const MOOD_LABELS = ["Тильт", "Плохо", "Ровно", "Хорошо", "В потоке"] as const;
export const DISCIPLINE_LABELS = ["Хаос", "Слабо", "Средне", "Хорошо", "Идеально"] as const;

/** Rule-violation tags (stored in the day's tags; same taxonomy as the per-trade review). */
export const MISTAKE_TAGS = ["FOMO", "Ранний вход", "Поздний выход", "Двигал стоп", "Овертрейдинг", "Реванш", "Без плана", "Большой размер"];
/** Legacy positive tags — still shown when present, no longer offered as chips. */
export const GOOD_TAGS = ["По плану", "Терпение", "Чистый выход", "Резал убыток"];
/** Emotions of the day (stored in the day's tags). */
export const EMOTION_TAGS = ["Спокойствие", "Уверенность", "Азарт", "Нетерпение", "Страх", "Жадность", "Скука", "Раздражение"];
const CALM_EMOTIONS = new Set(["Спокойствие", "Уверенность"]);

const PLAN_TEMPLATE = `Фокус-лист:
-

Ключевые уровни:
-

Лимит убытка на день:
Правило дня: `;

const TEXT_LIMIT = 4000; // eod summary fields (repeat / stop) are capped server-side

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error"; message: string };

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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
  const save = useSaveJournalDay();
  const key = `${trader}|${date}`;
  const isFuture = date > today;
  const nextDate = stepWeekday(date, 1);
  const eodQ = useEodDay(trader, date, !!trader && !isFuture);
  const eod = eodQ.data ?? null;

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
          if (!quiet) toast({ title: "Дневник сохранён", description: fmtDayShort(e.date) });
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
            toast({ title: "Запись изменена в другой вкладке", description: "Загружена актуальная версия — проверьте и допишите, что нужно." });
            return;
          }
          dirtyRef.current = true;
          setStatus({ kind: "error", message: (err as Error)?.message ?? "Ошибка" });
          toast({ title: "Не удалось сохранить дневник", description: (err as Error)?.message, variant: "destructive" });
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

  const toggleTag = (t: string) => {
    const has = draft.tags.some((x) => sameTag(x, t));
    update({ tags: has ? draft.tags.filter((x) => !sameTag(x, t)) : [...draft.tags, t] });
  };

  // ── Close / reopen the day (EOD) ─────────────────────────────────────────
  const close = useEodMutation(
    (b: { discipline: number | null; summary: ReturnType<typeof emptySummary> }) => eodApi.close(date, b),
    (out) => {
      const s = out.streaks;
      toast({
        title: `День ${fmtDayShort(date)} закрыт`,
        description: `Разбор отправлен куратору.${s.closedStreak > 1 ? ` Серия: ${s.closedStreak} ${plural(s.closedStreak, "день", "дня", "дней")} подряд.` : ""}`,
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
          const err = e as Error & { status?: number; body?: { missing?: MissingItem[] } };
          const n = err.body?.missing?.length ?? 0;
          toast({
            title: "День не закрыт",
            description: err.status === 422 && n ? `У ${n} ${plural(n, "сделки", "сделок", "сделок")} нет сетапа или грейда — отметьте их в разборе по сделкам.` : err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const reviewFilled = hasReview(draft);
  const progress = [draft.mood != null, !!draft.well.trim(), !!draft.mistakes.trim(), !!draft.lessons.trim(), !!focusText.trim()];
  const otherTags = draft.tags.filter((t) => ![...MISTAKE_TAGS, ...EMOTION_TAGS].some((x) => sameTag(x, t)));

  return (
    <Panel
      title="Дневник дня"
      icon={NotebookPen}
      description={editable ? (isFuture ? "План на этот день" : "Пара минут после закрытия: что было, чему научился, фокус на завтра") : `Запись трейдера ${trader}`}
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
            <p className="text-sm text-muted-foreground">Разбор откроется после торгового дня.</p>
          ) : !editable && isEntryEmpty(entry) ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{trader} ещё не заполнил разбор за этот день.</p>
          ) : (
            <>
              {fromLegacy && (
                <p className="rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
                  Заметка из прежней версии дневника перенесена в «Урок». Отредактируйте или сохраните (Ctrl+S).
                </p>
              )}

              <Step n={1} title="Как прошёл день" aside={<MorningCheckin trader={trader} date={date} />}>
                <div className="grid gap-4 md:grid-cols-2">
                  <ScaleField label="Настроение" labels={MOOD_LABELS} value={draft.mood} editable={editable} onChange={(v) => update({ mood: v })} />
                  <ScaleField label="Дисциплина" labels={DISCIPLINE_LABELS} value={draft.discipline} editable={editable} onChange={(v) => update({ discipline: v })} />
                </div>
                <ChipGroup
                  label="Эмоции"
                  options={EMOTION_TAGS}
                  selected={draft.tags}
                  editable={editable}
                  toneOf={(t) => (CALM_EMOTIONS.has(t) ? "up" : "warn")}
                  onToggle={toggleTag}
                />
              </Step>

              <Step n={2} title="Что сработало и что нет">
                <div className="grid gap-3 md:grid-cols-2">
                  <ReviewField id="journal-well" label="Что сработало" tone="up" value={draft.well} editable={editable}
                    placeholder="Лучшие решения, точные входы, что повторять…" onChange={(v) => update({ well: v })} />
                  <ReviewField id="journal-mistakes" label="Что не сработало" tone="down" value={draft.mistakes} editable={editable}
                    placeholder="Где поспешил, что стоило денег…" onChange={(v) => update({ mistakes: v })} />
                </div>
              </Step>

              <Step n={3} title="Урок и правила">
                <ReviewField id="journal-lessons" label="Урок дня" tone="accent" value={draft.lessons} editable={editable} rows="min-h-[72px]"
                  placeholder="Одна мысль, которую забираю в завтра…" onChange={(v) => update({ lessons: v })} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-xs text-muted-foreground" id="journal-followed">Торговал по правилам?</span>
                  <div role="group" aria-labelledby="journal-followed" className="flex gap-1.5">
                    {([[true, "Да"], [false, "Нет"]] as const).map(([v, l]) => (
                      <button
                        key={l}
                        type="button"
                        disabled={!editable}
                        aria-pressed={draft.followedPlan === v}
                        onClick={() => update({ followedPlan: draft.followedPlan === v ? null : v })}
                        className={cn(
                          "chip min-h-8 px-3.5 text-sm font-medium disabled:cursor-default",
                          draft.followedPlan === v && (v ? "!bg-up/15 !text-up" : "!bg-down/15 !text-down"),
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {(draft.followedPlan === false || MISTAKE_TAGS.some((m) => draft.tags.some((t) => sameTag(t, m))) || !editable) && (
                  <ChipGroup label="Что нарушил" options={MISTAKE_TAGS} selected={draft.tags} editable={editable} toneOf={() => "down"} onToggle={toggleTag} />
                )}
                {otherTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {otherTags.map((t) =>
                      editable ? (
                        <button key={t} type="button" onClick={() => toggleTag(t)} aria-label={`Убрать тег ${t}`}
                          className="chip inline-flex min-h-7 items-center gap-1 px-2.5 text-xs font-medium !text-foreground">
                          {t}<X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      ) : (
                        <Pill key={t} tone={GOOD_TAGS.includes(t) ? "up" : "neutral"}>{t}</Pill>
                      ),
                    )}
                  </div>
                )}
                {violations.length > 0 && (
                  <ul className="space-y-1 rounded-xl bg-warn/10 px-3 py-2" aria-label="Нарушения, найденные автоматически">
                    {violations.slice(0, 5).map((v) => (
                      <li key={v.id} className="flex items-start gap-2 text-xs">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
                        <span>
                          <span className="font-medium">{v.ruleName ?? "Правило"}</span>
                          {v.ticker && <span className="text-muted-foreground"> · {v.ticker}</span>}
                          {v.message && <span className="text-muted-foreground"> — {v.message}</span>}
                        </span>
                      </li>
                    ))}
                    {violations.length > 5 && <li className="text-2xs text-muted-foreground">и ещё {violations.length - 5}</li>}
                  </ul>
                )}
              </Step>

              <Step n={4} title={`Фокус на завтра · ${fmtDayShort(nextDate)}`}>
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
              eod={eod}
              editable={editable}
              hasTrades={hasTrades}
              reviewFilled={reviewFilled}
              progress={progress.filter(Boolean).length}
              untaggedIds={untaggedIds}
              closing={close.isPending}
              reopening={reopen.isPending}
              onClose={() => { void doClose(); }}
              onReopen={() => reopen.mutate(undefined, { onError: (e) => toast({ title: "Не удалось открыть день", description: (e as Error).message, variant: "destructive" }) })}
              onOpenTradeReview={onOpenTradeReview}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Step({ n, title, aside, children }: { n: number; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/15 text-2xs tabular-nums text-primary" aria-hidden="true">{n}</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function PlanBlock({ value, editable, prominent, onChange }: { value: string; editable: boolean; prominent: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(prominent || !!value.trim());
  useEffect(() => { if (prominent || value.trim()) setOpen(true); }, [prominent, value]);
  if (!editable && !value.trim()) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-medium">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />План / фокус дня
      </button>
    );
  }
  return (
    <div className="space-y-1.5 rounded-xl bg-[var(--glass-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="journal-plan" className="micro-label">План и фокус дня</label>
        {editable && !value.trim() && (
          <Button variant="ghost" size="sm" onClick={() => onChange(PLAN_TEMPLATE)}>
            <Plus aria-hidden="true" />Шаблон
          </Button>
        )}
      </div>
      <Textarea
        id="journal-plan"
        readOnly={!editable}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Что торгую сегодня и при каких условиях не вхожу…"
        className={cn("leading-relaxed", prominent ? "min-h-[140px]" : "min-h-[64px]")}
      />
    </div>
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
  const range = useJournalRange(trader, nextDate, nextDate, !!trader);
  const loaded = range.entries.find((e) => e.trader === trader && e.date === nextDate) ?? null;
  const save = useSaveJournalDay();
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
      onSuccess: (out) => { baseRef.current = out.entry; },
      onError: (err) => {
        if (err instanceof JournalConflict) {
          baseRef.current = err.current;
          dirty.current = true; // re-apply our text on top of the newer version
          timer.current = setTimeout(() => flush(), 50);
          return;
        }
        dirty.current = true;
        toast({ title: "Фокус на завтра не сохранён", description: (err as Error).message, variant: "destructive" });
      },
      onSettled: () => { inFlight.current = false; },
    });
  }, [save, toast, trader, nextDate]);
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
      : <p className="text-xs text-muted-foreground">Не заполнен.</p>;
  }
  return (
    <div className="space-y-2">
      <Textarea
        aria-label="Фокус на завтра"
        value={text}
        maxLength={6000}
        onChange={(e) => change(e.target.value)}
        onBlur={() => flushRef.current()}
        placeholder="1–2 правила или сетапа, на которых держу фокус завтра…"
        className="min-h-[72px] leading-relaxed"
      />
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <div className="text-2xs text-muted-foreground">Подсказки из разбора дня — нажмите, чтобы добавить:</div>
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
      <p className="text-2xs text-muted-foreground">Сохранится как план на {fmtDayShort(nextDate)} — утром он будет первым в дневнике.</p>
    </div>
  );
}

function CuratorFeedback({ day }: { day: NonNullable<EodDayPayload["day"]> }) {
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label="Отзыв куратора">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="font-semibold">Отзыв куратора · {day.reviewedBy}</span>
        <Pill tone="accent">оценка {day.curatorScore ?? "—"}/5</Pill>
        {day.reviewedAt && <span className="text-muted-foreground">{new Date(day.reviewedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
      {day.curatorComment && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{day.curatorComment}</p>}
    </section>
  );
}

function CloseBar({
  eod, editable, hasTrades, reviewFilled, progress, untaggedIds, closing, reopening, onClose, onReopen, onOpenTradeReview,
}: {
  eod: EodDayPayload; editable: boolean; hasTrades: boolean; reviewFilled: boolean; progress: number; untaggedIds: number[];
  closing: boolean; reopening: boolean; onClose: () => void; onReopen: () => void; onOpenTradeReview?: () => void;
}) {
  const { blocking } = splitMissing(eod);
  if (eod.status === "reviewed") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] pt-3 text-xs text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-up" aria-hidden="true" />День закрыт и проверен куратором.
      </div>
    );
  }
  if (eod.status === "closed") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] pt-3 text-xs">
        <Lock className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-muted-foreground">День закрыт — разбор ждёт куратора.</span>
        {editable && (
          <Button variant="ghost" size="sm" className="ml-auto" disabled={reopening} onClick={onReopen}>
            <LockOpen aria-hidden="true" />Открыть заново
          </Button>
        )}
      </div>
    );
  }
  if (!editable) {
    return (
      <div className="flex items-center gap-2 border-t border-[var(--glass-border)] pt-3 text-xs text-muted-foreground">
        <LockOpen className="h-4 w-4" aria-hidden="true" />Трейдер ещё не закрыл этот день.
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-[var(--glass-border)] pt-3">
      {blocking.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
          У {blocking.length} {plural(blocking.length, "ручной сделки", "ручных сделок", "ручных сделок")} нет сетапа или грейда:
          {blocking.map((m) => <span key={m.tradeId} className="font-medium">{m.ticker}</span>)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">Заполнено {progress}/5</span>
        {untaggedIds.length > 0 && (
          <Link href={links.trades({ ids: untaggedIds })} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            у {untaggedIds.length} {plural(untaggedIds.length, "сделки", "сделок", "сделок")} нет сетапа — отметить<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {hasTrades && onOpenTradeReview && (
            <Button variant="ghost" size="sm" onClick={onOpenTradeReview}>
              <ListChecks aria-hidden="true" />Разбор по сделкам
            </Button>
          )}
          <Button
            size="sm"
            disabled={closing || !reviewFilled || blocking.length > 0}
            title={!reviewFilled ? "Заполните хотя бы настроение или пару строк разбора" : undefined}
            onClick={onClose}
          >
            <Lock aria-hidden="true" />{closing ? "Закрываю…" : "Закрыть день"}
          </Button>
        </span>
      </div>
      {!reviewFilled && <p className="text-2xs text-muted-foreground">Чтобы закрыть день, заполните хотя бы настроение или пару строк разбора — куратор увидит его в очереди.</p>}
    </div>
  );
}

function ChipGroup({
  label, options, selected, editable, toneOf, onToggle,
}: {
  label: string; options: string[]; selected: string[]; editable: boolean;
  toneOf: (t: string) => "up" | "down" | "warn"; onToggle: (t: string) => void;
}) {
  const active = (t: string) => selected.some((x) => sameTag(x, t));
  const shown = editable ? options : options.filter(active);
  const id = `chips-${label}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby={id}>
      <span id={id} className="mr-1 text-xs text-muted-foreground">{label}</span>
      {shown.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
      {shown.map((t) => {
        const on = active(t);
        const tone = toneOf(t);
        return (
          <button
            key={t}
            type="button"
            disabled={!editable}
            aria-pressed={on}
            onClick={() => onToggle(t)}
            className={cn(
              "chip min-h-7 px-2.5 text-xs font-medium disabled:cursor-default",
              on && (tone === "up" ? "!border-transparent !bg-up/15 !text-up" : tone === "down" ? "!border-transparent !bg-down/15 !text-down" : "!border-transparent !bg-warn/15 !text-warn"),
            )}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function ScaleField({
  label, labels, value, editable, onChange,
}: {
  label: string;
  labels: readonly string[];
  value: number | null;
  editable: boolean;
  onChange: (v: number | null) => void;
}) {
  const id = `scale-${label}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-medium">{value != null ? labels[value - 1] : "—"}</span>
      </div>
      <div role="group" aria-labelledby={id} className="glass-field flex items-center gap-0.5 p-1">
        {labels.map((l, i) => {
          const v = i + 1;
          const active = value === v;
          return (
            <button
              key={l}
              type="button"
              disabled={!editable}
              aria-pressed={active}
              aria-label={`${v} — ${l}`}
              title={l}
              onClick={() => onChange(active ? null : v)}
              className={cn(
                "min-h-7 flex-1 rounded-full text-xs font-semibold tabular-nums transition-colors disabled:cursor-default",
                active
                  ? v <= 2 ? "bg-down/20 text-down" : v === 3 ? "bg-primary/20 text-primary" : "bg-up/20 text-up"
                  : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
              )}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReviewField({
  id, label, tone, value, editable, placeholder, onChange, rows = "min-h-[104px]",
}: {
  id: string;
  label: string;
  tone: "up" | "down" | "accent";
  value: string;
  editable: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  rows?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn("h-1.5 w-1.5 rounded-full", tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-primary")} aria-hidden="true" />
        {label}
      </label>
      <Textarea
        id={id}
        readOnly={!editable}
        value={value}
        placeholder={editable ? placeholder : "—"}
        onChange={(e) => onChange(e.target.value)}
        className={cn(rows, "leading-relaxed")}
      />
    </div>
  );
}

function SaveIndicator({ status, mode, editable, onRetry }: { status: SaveState; mode: StorageMode; editable: boolean; onRetry: () => void }) {
  if (!editable) return <Pill>Только чтение</Pill>;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      {mode === "local" && (
        <span className="inline-flex items-center gap-1" title="Сервер недоступен — записи хранятся в этом браузере">
          <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />В браузере
        </span>
      )}
      {status.kind === "saving" && (
        <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Сохраняю…</span>
      )}
      {status.kind === "saved" && (
        <span className="inline-flex items-center gap-1 text-up">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Сохранено {status.at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
      {status.kind === "error" && (
        <Button variant="ghost" size="sm" className="text-down" onClick={onRetry}>Ошибка — повторить</Button>
      )}
      {status.kind === "idle" && <span>Автосохранение</span>}
    </div>
  );
}

type CheckinRow = {
  sleepWell: boolean; stressed: boolean; tilted: boolean; focused: boolean; anxious: boolean; revenge: boolean;
  freeText: string | null;
} | null;

const CHECKIN_FLAGS: Array<{ key: keyof NonNullable<CheckinRow>; label: string; good: boolean }> = [
  { key: "sleepWell", label: "Выспался", good: true },
  { key: "focused", label: "Фокус", good: true },
  { key: "stressed", label: "Стресс", good: false },
  { key: "anxious", label: "Тревога", good: false },
  { key: "tilted", label: "Тильт", good: false },
  { key: "revenge", label: "Реванш", good: false },
];

/** Morning check-in (from the dashboard) for this trader/day — one line of context next to the mood. */
function MorningCheckin({ trader, date }: { trader: string; date: string }) {
  const { data } = useQuery({
    queryKey: ["journal-checkin", trader, date],
    enabled: !!trader,
    staleTime: 60_000,
    queryFn: async (): Promise<CheckinRow> => {
      const res = await fetch(apiUrl(`/api/emotional-state/by-date?userId=${encodeURIComponent(trader)}&date=${date}`));
      if (!res.ok) return null;
      return (await res.json()) as CheckinRow;
    },
  });
  if (!data) return null;
  const flags = CHECKIN_FLAGS.filter((f) => data[f.key] === true);
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground" title={data.freeText ?? undefined}>
      <Sunrise className="h-3.5 w-3.5 text-warn" aria-hidden="true" />утром:
      {flags.length === 0 ? <span>без отметок</span> : flags.map((f) => <Pill key={f.key} tone={f.good ? "up" : "down"}>{f.label}</Pill>)}
    </span>
  );
}
