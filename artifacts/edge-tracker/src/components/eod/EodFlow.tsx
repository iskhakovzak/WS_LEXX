import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Keyboard, ListChecks, Lock, Moon, X } from "lucide-react";
import { Panel, Pill, Segmented, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { HORIZON_LABEL, isTypingTarget } from "@/components/journal/utils";
import { fmtDate, fmtR, fmtUsd, pluralRu } from "@/lib/format";
import {
  GRADES, MISTAKE_TAGS, emptySummary, eodApi, gradeTone, splitMissing, useBrokerDaily, useEodDay,
  useEodMutation, usePlaybookNames, type EodDayPayload, type EodPosition, type EodSummary, type EodTrade, type Grade,
  type MissingItem,
} from "./eod-api";
import { EodDayReadOnly } from "./EodDayReadOnly";

type Step = "trades" | "positions";

/**
 * Optional «Разбор по сделкам»: setup / grade / followed plan / mistakes / lesson per trade (keyboard-driven),
 * plus overnight positions. The day itself is reflected and closed in «Дневник дня» — this is the deep dive.
 * Setup and grade are optional for broker-imported trades (P1-8); only manual trades must have them to close.
 */
export function EodFlow({ trader, date, onExit }: { trader: string; date: string; today?: string; onExit: () => void }) {
  const { toast } = useToast();
  const dayQ = useEodDay(trader, date);
  const brokerQ = useBrokerDaily(trader, date);
  const data = dayQ.data ?? null;
  const closed = !!data?.day?.closedAt;
  const [step, setStep] = useState<Step>("trades");

  // Positions notes live in the EOD summary; every other summary field is kept as it is.
  const key = `${trader}|${date}`;
  const [positionsDraft, setPositionsDraft] = useState<EodPosition[]>([]);
  const loadedKey = useRef<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!data) return;
    const switched = loadedKey.current !== key;
    if (!switched && dirty.current) return;
    loadedKey.current = key;
    setPositionsDraft(data.day?.summary?.positions ?? []);
    if (switched) setStep("trades");
    dirty.current = false;
  }, [data, key]);

  const saveDay = useEodMutation((b: { discipline: number | null; summary: EodSummary }) => eodApi.saveDay(date, b));
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current || closed || !data) return;
    dirty.current = false;
    saveDay.mutate(
      { discipline: data.day?.discipline ?? null, summary: { ...emptySummary(), ...(data.day?.summary ?? {}), positions: positionsDraft } },
      { onError: (e) => toast({ title: "Не удалось сохранить позиции", description: (e as Error).message, variant: "destructive" }) },
    );
  }, [closed, data, positionsDraft, saveDay, toast]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (dirty.current) flushRef.current(); }, []);
  const changePositions = (v: EodPosition[]) => {
    setPositionsDraft(v);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 1200);
  };
  const exit = () => { flush(); onExit(); };

  const header = (
    <span className="inline-flex items-center gap-2"><ListChecks className="h-4 w-4" aria-hidden="true" />Разбор по сделкам · {fmtDate(date, "long")}</span>
  );
  const exitBtn = <Button variant="ghost" size="sm" onClick={exit}><X aria-hidden="true" />К дневнику</Button>;

  if (dayQ.isLoading) {
    return (
      <Panel title={header}>
        <div className="space-y-2"><Skeleton className="h-8 w-72 rounded-full" /><Skeleton className="h-40 w-full rounded-xl" /></div>
      </Panel>
    );
  }
  if (dayQ.isError || !data) {
    return (
      <Panel title={header} actions={exitBtn}>
        <p className="text-sm text-muted-foreground">{dayQ.isError ? (dayQ.error as Error).message : "Разбор по сделкам появится после обновления сервера."}</p>
      </Panel>
    );
  }

  if (closed) {
    return (
      <Panel
        title={<span className="inline-flex items-center gap-2"><Lock className="h-4 w-4 text-up" aria-hidden="true" />День {fmtDate(date, "long")} закрыт</span>}
        description={data.day?.reviewedAt ? `Проверен куратором ${data.day.reviewedBy}` : "Ожидает проверки куратором. Открыть заново можно в «Дневнике дня»."}
        actions={exitBtn}
      >
        <EodDayReadOnly data={data} broker={brokerQ.data ?? null} />
      </Panel>
    );
  }

  const { blocking } = splitMissing(data);
  const positions = [...data.trades, ...data.carried].filter((t) => data.positions.includes(t.id));
  const tagged = data.trades.filter((t) => !!t.setup).length;

  return (
    <Panel
      title={header}
      description={`Сетап и грейд — по желанию, для статистики по сетапам. Размечено ${tagged} из ${data.trades.length}.`}
      actions={exitBtn}
    >
      <div className="space-y-4">
        {positions.length > 0 && (
          <Segmented<Step>
            size="sm"
            ariaLabel="Раздел разбора"
            value={step}
            onChange={(s) => { flush(); setStep(s); }}
            options={[
              { value: "trades", label: "Сделки", count: data.trades.length },
              { value: "positions", label: "Позиции на ночь", count: positions.length },
            ]}
          />
        )}
        {blocking.length > 0 && (
          <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs">
            Чтобы закрыть день, у {blocking.length} {pluralRu(blocking.length, "сделки", "сделок", "сделок")} нужны сетап и грейд: {blocking.map((m) => m.ticker).join(", ")}.
          </p>
        )}
        {step === "trades" ? (
          <TradeReviewStep data={data} missing={blocking} onDone={() => (positions.length ? setStep("positions") : exit())} />
        ) : (
          <PositionsStep positions={positions} date={date} values={positionsDraft} onChange={changePositions} />
        )}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--glass-border)] pt-3">
          {saveDay.isPending && <span className="text-2xs text-muted-foreground">сохраняю…</span>}
          <Button size="sm" onClick={exit}><CheckCircle2 aria-hidden="true" />Готово — к дневнику</Button>
        </div>
      </div>
    </Panel>
  );
}

// ── Step 2: trade-by-trade review ─────────────────────────────────────────────

function TradeReviewStep({ data, missing, onDone }: { data: EodDayPayload; missing: MissingItem[]; onDone: () => void }) {
  const { toast } = useToast();
  const playbook = usePlaybookNames();
  const trades = data.trades;
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const listRef = useRef<HTMLOListElement | null>(null);

  // Optimistic overrides so keyboard grading feels instant while the PATCH + refetch complete.
  const [edits, setEdits] = useState<Map<number, Partial<EodTrade>>>(new Map());
  const merged = useMemo(() => trades.map((t) => ({ ...t, ...(edits.get(t.id) ?? {}) })), [trades, edits]);
  const setEdit = (id: number, patch: Partial<EodTrade>) =>
    setEdits((m) => { const n = new Map(m); n.set(id, { ...(n.get(id) ?? {}), ...patch }); return n; });

  const onErr = (title: string) => (e: unknown) => toast({ title, description: (e as Error).message, variant: "destructive" });
  const patch = useEodMutation(({ id, body }: { id: number; body: { setup?: string | null; confidenceGrade?: Grade } }) => eodApi.patchTrade(id, body));
  const review = useEodMutation(({ id, body }: { id: number; body: { followedPlan?: boolean | null; mistakes?: string[]; lesson?: string } }) => eodApi.reviewTrade(id, body));

  const setGrade = useCallback((t: EodTrade, g: Grade) => {
    if (t.confidenceGrade === g) return;
    setEdit(t.id, { confidenceGrade: g });
    patch.mutate({ id: t.id, body: { confidenceGrade: g } }, { onError: onErr("Грейд не сохранён") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch]);
  const setSetup = useCallback((t: EodTrade, setup: string) => {
    const v = setup.trim();
    if ((t.setup ?? "") === v) return;
    setEdit(t.id, { setup: v || null });
    patch.mutate({ id: t.id, body: { setup: v || null } }, { onError: onErr("Сетап не сохранён") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch]);
  const setFollowed = useCallback((t: EodTrade, v: boolean | null) => {
    setEdit(t.id, { followedPlan: v });
    review.mutate({ id: t.id, body: { followedPlan: v } }, { onError: onErr("Отметка «по плану» не сохранена") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);
  const setMistakes = (t: EodTrade, mistakes: string[]) => {
    setEdit(t.id, { mistakes });
    review.mutate({ id: t.id, body: { mistakes } }, { onError: onErr("Ошибки не сохранены") });
  };
  const lessonTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const setLesson = (t: EodTrade, lesson: string, immediate = false) => {
    setEdit(t.id, { lesson });
    const prev = lessonTimers.current.get(t.id);
    if (prev) clearTimeout(prev);
    const fire = () => review.mutate({ id: t.id, body: { lesson } }, { onError: onErr("Урок не сохранён") });
    if (immediate) fire();
    else lessonTimers.current.set(t.id, setTimeout(fire, 800));
  };
  useEffect(() => () => { for (const tm of lessonTimers.current.values()) clearTimeout(tm); }, []);

  const move = useCallback((dir: 1 | -1) => {
    setCursor((c) => Math.min(Math.max(0, c + dir), Math.max(0, trades.length - 1)));
  }, [trades.length]);
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Keyboard: J/K (or ↓/↑) move, 1–4 grade, P toggles «по плану», Enter → next trade / next step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = isTypingTarget(e.target);
      const t = merged[cursor];
      if (e.key === "Enter" && typing && (e.target as HTMLElement)?.dataset?.eodLesson) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
        if (cursor >= merged.length - 1) onDone(); else move(1);
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "о" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (k === "k" || k === "л" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (t && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); setGrade(t, GRADES[Number(e.key) - 1]); }
      else if (t && (k === "p" || k === "з")) { e.preventDefault(); setFollowed(t, t.followedPlan === true ? false : t.followedPlan === false ? null : true); }
      else if (e.key === "Enter") { e.preventDefault(); if (cursor >= merged.length - 1) onDone(); else move(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [merged, cursor, move, setGrade, setFollowed, onDone]);

  const names = playbook.data ?? [];
  const missingIds = new Set(missing.map((m) => m.tradeId));

  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground">Сделок за день нет.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
        <span
          className="inline-flex items-center gap-1"
          title="J / K — следующая / предыдущая · 1–4 — грейд A+ A B C · P — по плану да / нет · Enter — дальше"
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />клавиши
        </span>
        <span className="tabular-nums">{cursor + 1} / {trades.length}</span>
      </div>
      <datalist id="eod-setup-names">
        {names.map((n) => <option key={n.id} value={n.name}>{n.folder ?? ""}</option>)}
      </datalist>
      <ol ref={listRef} className="space-y-2">
        {merged.map((t, i) => (
          <TradeReviewRow
            key={t.id}
            ref={(el) => { rowRefs.current[i] = el; }}
            t={t}
            active={i === cursor}
            flagged={missingIds.has(t.id)}
            onFocus={() => setCursor(i)}
            onGrade={(g) => setGrade(t, g)}
            onSetup={(s) => setSetup(t, s)}
            onFollowed={(v) => setFollowed(t, v)}
            onMistakes={(m) => setMistakes(t, m)}
            onLesson={(l, imm) => setLesson(t, l, imm)}
          />
        ))}
      </ol>
    </div>
  );
}

const TradeReviewRow = forwardRef<HTMLLIElement, {
  t: EodTrade; active: boolean; flagged: boolean;
  onFocus: () => void; onGrade: (g: Grade) => void; onSetup: (s: string) => void;
  onFollowed: (v: boolean | null) => void; onMistakes: (m: string[]) => void; onLesson: (l: string, immediate?: boolean) => void;
}>(function TradeReviewRow({ t, active, flagged, onFocus, onGrade, onSetup, onFollowed, onMistakes, onLesson }, ref) {
  const [setupText, setSetupText] = useState(t.setup ?? "");
  useEffect(() => { setSetupText(t.setup ?? ""); }, [t.setup]);
  const isShort = (t.side ?? "").toLowerCase().startsWith("s");
  const complete = t.missing.length === 0 && !!t.setup && GRADES.includes(t.confidenceGrade as Grade);
  const id = `eod-trade-${t.id}`;
  return (
    <li
      ref={ref}
      onFocusCapture={onFocus}
      onClick={onFocus}
      className={cn(
        "rounded-xl border bg-[var(--glass-bg)] p-3 transition-[border-color,box-shadow]",
        active ? "border-primary ring-1 ring-primary" : "border-[var(--glass-border)]",
        flagged && !complete && "border-warn/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-sm font-semibold">{t.ticker}</span>
        {t.side && <Pill>{isShort ? "↘ Short" : "↗ Long"}</Pill>}
        {t.horizonEff !== "intraday" && <Pill tone="purple">{HORIZON_LABEL[t.horizonEff]}</Pill>}
        {t.onPlan && <Pill tone="accent">в плане</Pill>}
        {!t.enteredToday && <Pill>с {fmtDate(t.date, "dayMonth")}</Pill>}
        {complete ? <Pill tone="up"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />размечена</Pill> : flagged ? <Pill tone="warn">нужны сетап и грейд</Pill> : null}
        <span className="ml-auto flex items-center gap-2 tabular-nums">
          <span className="text-muted-foreground">{t.entry ?? "—"} → {t.exit ?? "…"}</span>
          {t.net != null ? (
            <span className={cn("text-sm font-semibold", toneText(toneOf(t.net)))}>{fmtUsd(t.net, { signed: true, decimals: "auto" })}</span>
          ) : (
            <span className="text-muted-foreground">{t.resultNorm === "open" ? "открыта" : "—"}</span>
          )}
          {t.r != null && <span className={toneText(toneOf(t.r))}>{fmtR(t.r, 1)}</span>}
          <Link href={links.trade(t.id)} className="text-primary hover:underline">сделка</Link>
        </span>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="space-y-1">
          <label htmlFor={`${id}-setup`} className="text-2xs text-muted-foreground">Сетап (из плейбука или свой)</label>
          <Input
            id={`${id}-setup`}
            list="eod-setup-names"
            value={setupText}
            placeholder="Gap & Go, ORB, Pricing…"
            onChange={(e) => setSetupText(e.target.value)}
            onBlur={() => onSetup(setupText)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSetup(setupText); (e.target as HTMLInputElement).blur(); } }}
            className={cn("h-8 text-sm", flagged && !t.setup && "border-warn/60")}
          />
        </div>
        <div className="space-y-1">
          <span className="text-2xs text-muted-foreground" id={`${id}-grade`}>Грейд</span>
          <div role="group" aria-labelledby={`${id}-grade`} className="glass-field flex items-center gap-0.5 p-1">
            {GRADES.map((g, i) => (
              <button
                key={g}
                type="button"
                aria-pressed={t.confidenceGrade === g}
                title={`клавиша ${i + 1}`}
                onClick={() => onGrade(g)}
                className={cn(
                  "min-h-7 min-w-9 rounded-full px-2 text-xs font-semibold transition-colors",
                  t.confidenceGrade === g
                    ? gradeTone(g) === "up" ? "bg-up/20 text-up" : gradeTone(g) === "down" ? "bg-down/20 text-down" : gradeTone(g) === "warn" ? "bg-warn/20 text-warn" : "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-2xs text-muted-foreground" id={`${id}-plan`}>По плану (P)</span>
          <div role="group" aria-labelledby={`${id}-plan`} className="flex gap-1">
            {([[true, "Да"], [false, "Нет"]] as const).map(([v, l]) => (
              <button
                key={l}
                type="button"
                aria-pressed={t.followedPlan === v}
                onClick={() => onFollowed(t.followedPlan === v ? null : v)}
                className={cn("chip min-h-8 px-3 text-xs font-medium", t.followedPlan === v && (v ? "!bg-up/15 !text-up" : "!bg-down/15 !text-down"))}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {MISTAKE_TAGS.map((m) => {
          const on = t.mistakes.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => onMistakes(on ? t.mistakes.filter((x) => x !== m) : [...t.mistakes, m])}
              className={cn("chip min-h-6 px-2 text-2xs font-medium", on && "!border-transparent !bg-down/15 !text-down")}
            >
              {m}
            </button>
          );
        })}
      </div>
      <Input
        aria-label="Урок одной строкой"
        data-eod-lesson="1"
        value={t.lesson}
        maxLength={2000}
        placeholder="Урок одной строкой… (Enter — к следующей сделке)"
        onChange={(e) => onLesson(e.target.value)}
        onBlur={(e) => onLesson(e.target.value, true)}
        className="mt-2 h-8 text-sm"
      />
    </li>
  );
});

// ── Step 3: overnight / swing positions ───────────────────────────────────────

function PositionsStep({ positions, date, values, onChange }: { positions: EodTrade[]; date: string; values: EodPosition[]; onChange: (v: EodPosition[]) => void }) {
  if (positions.length === 0) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Moon className="h-4 w-4" aria-hidden="true" />На ночь ничего не остаётся — все позиции закрыты.</p>;
  }
  const get = (id: number): EodPosition => values.find((p) => p.tradeId === id) ?? { tradeId: id, thesisValid: null, stop: null, target: null, gapNote: "" };
  const set = (id: number, patch: Partial<EodPosition>) => {
    const cur = get(id);
    onChange([...values.filter((p) => p.tradeId !== id), { ...cur, ...patch }]);
  };
  const num = (s: string): number | null => { const v = Number(s.replace(",", ".")); return s.trim() === "" || !Number.isFinite(v) ? null : v; };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Для каждой позиции: тезис ещё в силе? Стоп и цель на завтра, риск гэпа.</p>
      <ul className="space-y-2">
        {positions.map((t) => {
          const p = get(t.id);
          const isShort = (t.side ?? "").toLowerCase().startsWith("s");
          return (
            <li key={t.id} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-sm font-semibold">{t.ticker}</span>
                {t.side && <Pill>{isShort ? "↘ Short" : "↗ Long"}</Pill>}
                <Pill tone="purple">{HORIZON_LABEL[t.horizonEff]}</Pill>
                {t.date !== date && <Pill>с {fmtDate(t.date, "dayMonth")}</Pill>}
                <span className="ml-auto tabular-nums text-muted-foreground">вход {t.entry ?? "—"} · стоп {t.stop ?? "—"}{t.qty != null ? ` · ${t.qty} шт` : ""}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_1fr_2fr]">
                <div className="space-y-1">
                  <span className="text-2xs text-muted-foreground">Тезис в силе?</span>
                  <div className="flex gap-1">
                    {([[true, "Да"], [false, "Нет"]] as const).map(([v, l]) => (
                      <button key={l} type="button" aria-pressed={p.thesisValid === v} onClick={() => set(t.id, { thesisValid: p.thesisValid === v ? null : v })}
                        className={cn("chip min-h-8 px-3 text-xs font-medium", p.thesisValid === v && (v ? "!bg-up/15 !text-up" : "!bg-down/15 !text-down"))}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="space-y-1 text-2xs text-muted-foreground">Стоп на завтра
                  <Input inputMode="decimal" value={p.stop ?? ""} placeholder={t.stop != null ? String(t.stop) : "—"} onChange={(e) => set(t.id, { stop: num(e.target.value) })} className="h-8 text-sm" />
                </label>
                <label className="space-y-1 text-2xs text-muted-foreground">Цель
                  <Input inputMode="decimal" value={p.target ?? ""} placeholder="—" onChange={(e) => set(t.id, { target: num(e.target.value) })} className="h-8 text-sm" />
                </label>
                <label className="space-y-1 text-2xs text-muted-foreground">Гэп-риск / новости
                  <Input value={p.gapNote} maxLength={500} placeholder="отчёт до открытия, лок-ап, …" onChange={(e) => set(t.id, { gapNote: e.target.value })} className="h-8 text-sm" />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
