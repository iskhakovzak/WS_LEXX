/**
 * Parts of the cheat sheet (cheat-card.tsx): the four rules Вход / Стоп / Цель / Отмена as large rows, «Грейд A,
 * если», the LIVE checklist with its grade (all = A, all but one = B, else C → «Пропусти») and the size calculator
 * (1R ÷ stop per share, rounded down). Nothing is clipped: every text wraps. Ticks and the stop distance live for the
 * session (sessionStorage), so reopening the card during the day keeps them.
 */
import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { Check, CircleSlash, RotateCcw } from "lucide-react";
import { toneText, type Tone } from "@/components/ds";
import { Input } from "@/components/ui/input";
import type { PlaybookToday, TodaySetup } from "@/lib/playbook-today/types";
import { fmtUsd } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { GRADE_RISK, gradeOf, parseStop, sharesFor, type Grade } from "./today-model";

const GRADE_TONE: Record<Grade, Tone> = { A: "up", B: "warn", C: "down" };

export function useSessionState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (next: T | ((prev: T) => T)) => {
    setV((prev) => {
      const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: state only */ }
      return value;
    });
  };
  return [v, set];
}

const LINE_BORDER = { entry: "border-l-primary", stop: "border-l-down", target: "border-l-up", invalidation: "border-l-warn" } as const;
const LINE_TEXT = { entry: "text-primary", stop: "text-down", target: "text-up", invalidation: "text-warn" } as const;

/** Вход / Стоп / Цель / Отмена — one row each, the label above the rule on narrow cards, beside it on wide ones. */
export function CheatLines({ setup }: { setup: TodaySetup }) {
  const { t } = playbookTodayI18n.useT();
  const rows = (["entry", "stop", "target", "invalidation"] as const).map((k) => ({ k, label: t(`card.${k}`), value: setup.cheat[k] })).filter((r) => !!r.value);
  if (!rows.length) return null;
  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.k} className={cn("grid gap-x-3 gap-y-0.5 rounded-xl border-l-[3px] bg-[var(--glass-bg)] px-3 py-2 @md:grid-cols-[5.5rem_minmax(0,1fr)]", LINE_BORDER[r.k])}>
          <dt className={cn("pt-0.5 text-xs font-semibold uppercase tracking-wide", LINE_TEXT[r.k])}>{r.label}</dt>
          <dd className="min-w-0 whitespace-pre-line text-[15px] leading-snug text-foreground [overflow-wrap:anywhere] sm:text-base">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GradeABullets({ items }: { items: string[] }) {
  const { t } = playbookTodayI18n.useT();
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-up">{t("card.gradeA")}</h3>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[15px] leading-snug text-foreground marker:text-up">
        {items.map((g) => <li key={g} className="[overflow-wrap:anywhere]">{g}</li>)}
      </ul>
    </div>
  );
}

function GradeLine({ grade }: { grade: Grade }) {
  const { t } = playbookTodayI18n.useT();
  const tone = GRADE_TONE[grade];
  return (
    <p role="status" className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border px-3 py-2 text-sm", grade === "C" ? "border-down/40 bg-down/10" : grade === "B" ? "border-warn/40 bg-warn/10" : "border-up/40 bg-up/10")}>
      {grade === "C" ? <CircleSlash className={cn("h-4 w-4 shrink-0", toneText(tone))} aria-hidden="true" /> : <Check className={cn("h-4 w-4 shrink-0", toneText(tone))} aria-hidden="true" />}
      <span className={cn("font-semibold", toneText(tone))}>{grade === "C" ? `${t("card.skip")} · ${t("card.grade", { grade })}` : t("card.grade", { grade })}</span>
      <span className="min-w-0 text-foreground/85">{t(`card.gradeHint.${grade}`)}</span>
    </p>
  );
}

export function LiveChecklist({ setup, date, onGrade }: { setup: TodaySetup; date: string; onGrade: (g: Grade | null) => void }) {
  const { t } = playbookTodayI18n.useT();
  const [ticked, setTicked] = useSessionState<number[]>(`pb-today:check:${date}:${setup.id}`, []);
  const items = setup.checklist;
  const done = ticked.filter((i) => i < items.length).length;
  const grade = gradeOf(done, items.length);
  useEffect(() => { onGrade(grade); }, [grade, onGrade]);
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("card.noChecklist")}</p>;
  const toggle = (i: number) => setTicked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("card.checklist")}</h3>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{done}/{items.length}</span>
        {done > 0 && (
          <button type="button" onClick={() => setTicked([])} title={t("card.reset")} aria-label={t("card.reset")} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((text, i) => {
          const on = ticked.includes(i);
          return (
            <li key={`${i}-${text}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(i)}
                className={cn(
                  "flex min-h-10 w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left text-[15px] leading-snug text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-up/10" : "hover:bg-[var(--glass-hover-bg)]",
                )}
              >
                <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border", on ? "border-up bg-up text-background" : "border-[var(--field-border)]")}>
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {grade && <GradeLine grade={grade} />}
    </div>
  );
}

export function SizeCalc({ setupId, oneR, grade, date }: { setupId: number; oneR: PlaybookToday["oneR"]; grade: Grade | null; date: string }) {
  const { t } = playbookTodayI18n.useT();
  const id = useId();
  const [stopText, setStopText] = useSessionState<string>(`pb-today:stop:${setupId}`, "");
  if (!oneR) {
    return (
      <p className="text-sm text-foreground/85">
        {t("card.noOneR")}{" "}
        <Link href={links.myPlan(date)} className="font-medium text-primary hover:underline">{t("card.setOneR")}</Link>
      </p>
    );
  }
  const stop = parseStop(stopText);
  const full = sharesFor(oneR.usd, stop);
  const half = sharesFor(oneR.usd * GRADE_RISK.B, stop);
  const shown = grade === "B" ? half : full;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[15px]">
          <span className="font-semibold tabular-nums text-foreground">{t("card.oneR", { usd: fmtUsd(oneR.usd, { decimals: 0 }) })}</span>
          <span className="text-xs text-muted-foreground"> · {t(`card.oneRSource.${oneR.source}`)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="text-sm text-foreground/85">{t("card.stopLabel")}</label>
          <Input
            id={id}
            inputMode="decimal"
            value={stopText}
            onChange={(e) => setStopText(e.target.value)}
            placeholder={t("card.stopPlaceholder")}
            className="h-10 w-24 text-base tabular-nums"
          />
        </span>
        {stop != null && (
          <output htmlFor={id} className={cn("text-base font-semibold tabular-nums", grade === "C" ? "text-muted-foreground line-through" : "text-foreground")}>
            = {t("card.shares", { count: shown ?? 0 })}
          </output>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {stop != null && grade === "C" ? t("card.noTrade") : stop != null && grade !== "B" && half != null ? t("card.halfR", { shares: t("card.shares", { count: half }) }) : t("card.sizeHint")}
      </p>
    </div>
  );
}
