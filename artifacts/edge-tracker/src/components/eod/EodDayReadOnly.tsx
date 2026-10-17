import { useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquareText } from "lucide-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HORIZON_LABEL } from "@/components/journal/utils";
import { fmtDate, fmtR, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import type { JournalEntry } from "@/components/journal/use-journal-days";
import { EMOTION_TAGS } from "@/components/journal/DayJournalEditor";
import {
  DISCIPLINE_LABELS, MISTAKE_TAGS, MOOD_LABELS, gradeTone, type BrokerDaily, type EodDayPayload, type EodTrade, type Totals,
} from "./eod-api";

/** Date + time with seconds ("17.10.2026, 14:05:09" in RU), the shape of the old bare toLocaleString(). */
const TRADES_PREVIEW = 12;
const EMOTIONS = new Set(EMOTION_TAGS);

/**
 * Read-only rendering of a closed day for the curator: day reflection (journal) → result → trades → positions → verdict.
 * `journal` is the trader's journal entry for the day (lesson, emotions, rule violations); the EOD summary is the fallback.
 */
export function EodDayReadOnly({
  data, broker, journal, compact = false,
}: { data: EodDayPayload; broker?: BrokerDaily | null; journal?: JournalEntry | null; compact?: boolean }) {
  const s = data.day?.summary ?? {};
  const positions = [...data.trades, ...data.carried].filter((t) => data.positions.includes(t.id));
  const posNotes = new Map((s.positions ?? []).map((p) => [p.tradeId, p]));
  const [allTrades, setAllTrades] = useState(false);
  const shownTrades = allTrades ? data.trades : data.trades.slice(0, TRADES_PREVIEW);
  const mood = journal?.mood ?? s.mood ?? null;
  const discipline = journal?.discipline ?? data.day?.discipline ?? null;
  const well = journal?.well?.trim() || s.repeat;
  const bad = journal?.mistakes?.trim() || s.stop;
  const emotions = (journal?.tags ?? []).filter((t) => EMOTIONS.has(t));
  const violations = (journal?.tags ?? []).filter((t) => MISTAKE_TAGS.includes(t));
  const net = data.reconcile.journal.net;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="micro-label">Разбор трейдера</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill tone={discipline != null ? (discipline >= 4 ? "up" : discipline <= 2 ? "down" : "warn") : "neutral"}>
            Дисциплина {discipline != null ? `${discipline}/5 · ${DISCIPLINE_LABELS[discipline - 1]}` : "—"}
          </Pill>
          <Pill tone={mood != null ? (mood >= 4 ? "up" : mood <= 2 ? "down" : "neutral") : "neutral"}>
            Настроение {mood != null ? `${mood}/5 · ${MOOD_LABELS[mood - 1]}` : "—"}
          </Pill>
          {journal?.followedPlan === true && <Pill tone="up">по правилам</Pill>}
          {journal?.followedPlan === false && <Pill tone="down">нарушал правила</Pill>}
          {emotions.map((e) => <Pill key={e} tone={e === "Спокойствие" || e === "Уверенность" ? "up" : "warn"}>{e}</Pill>)}
          {violations.map((v) => <Pill key={v} tone="down">{v}</Pill>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextBlock label="Что сработало" text={well} tone="up" />
          <TextBlock label="Что не сработало" text={bad} tone="down" />
        </div>
        {(journal?.lessons?.trim() || s.tomorrow) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {journal?.lessons?.trim() && <TextBlock label="Урок дня" text={journal.lessons} accent />}
            {s.tomorrow && <TextBlock label="Фокус на завтра" text={s.tomorrow} />}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="micro-label">Сделки · {data.trades.length}</span>
          {net != null && <span className={cn("text-sm font-semibold tabular-nums", toneText(toneOf(net)))}>{fmtUsd(net, { signed: true, decimals: "auto" })}</span>}
          {data.reconcile.journal.fees > 0 && <span className="text-xs tabular-nums text-muted-foreground">комиссии {fmtUsd(-data.reconcile.journal.fees, { signed: true, decimals: "auto" })}</span>}
        </div>
        <ReconcileBlock journal={data.reconcile.journal} broker={broker ?? null} brokerFromTrades={data.reconcile.broker} manualUnmatched={data.reconcile.manualUnmatched} />
        {data.trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Сделок в этот день не было.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {shownTrades.map((t) => <TradeReviewLine key={t.id} t={t} compact={compact} />)}
            </ul>
            {data.trades.length > TRADES_PREVIEW && (
              <Button variant="ghost" size="sm" onClick={() => setAllTrades((v) => !v)}>
                {allTrades ? "Свернуть" : `Показать все ${data.trades.length}`}
              </Button>
            )}
          </>
        )}
      </section>

      {positions.length > 0 && (
        <section className="space-y-2">
          <div className="micro-label">Позиции на ночь · {positions.length}</div>
          <ul className="space-y-1.5">
            {positions.map((t) => {
              const p = posNotes.get(t.id);
              return (
                <li key={t.id} className="rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{t.ticker}</span>
                    <Pill tone="purple">{HORIZON_LABEL[t.horizonEff]}</Pill>
                    {t.date !== data.date && <Pill>с {fmtDate(t.date, "dayMonth")}</Pill>}
                    {p?.thesisValid === true && <Pill tone="up">тезис в силе</Pill>}
                    {p?.thesisValid === false && <Pill tone="down">тезис сломан</Pill>}
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      стоп {p?.stop ?? t.stop ?? "—"} · цель {p?.target ?? "—"}
                    </span>
                  </div>
                  {p?.gapNote && <p className="mt-1 text-foreground/90">Гэп-риск: {p.gapNote}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.day?.reviewedAt && (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="font-semibold">Куратор {data.day.reviewedBy}</span>
            <Pill tone="accent">оценка {data.day.curatorScore ?? "—"}/5</Pill>
            <span className="text-muted-foreground">{fmtDate(data.day.reviewedAt, "shortDateTimeSeconds")}</span>
          </div>
          {data.day.curatorComment && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{data.day.curatorComment}</p>}
        </section>
      )}
    </div>
  );
}

/**
 * One-line reconciliation of the journal with the broker statement. Silent when it matches —
 * a warning only when the totals differ (or when manual trades have no broker pair).
 */
export function ReconcileBlock({
  journal, broker, brokerFromTrades, manualUnmatched,
}: { journal: Totals; broker: BrokerDaily | null; brokerFromTrades: Totals | null; manualUnmatched: number }) {
  const bNet = broker ? broker.net : brokerFromTrades?.net ?? null;
  const bTrades = broker ? broker.trades : brokerFromTrades?.trades ?? null;
  if (bNet == null || journal.net == null) return null;
  const diff = Math.round((journal.net - bNet) * 100) / 100;
  const matches = Math.abs(diff) < 0.01;
  if (matches && manualUnmatched === 0) {
    return (
      <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-up" aria-hidden="true" />Сходится с выпиской брокера
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-1.5 rounded-xl bg-warn/10 px-3 py-2 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
      {!matches && <span>Расхождение с выпиской брокера: <span className="font-semibold tabular-nums">{fmtUsd(diff, { signed: true, decimals: "auto" })}</span> (у брокера {fmtUsd(bNet, { signed: true, decimals: "auto" })}{bTrades != null ? `, ${bTrades} сд.` : ""})</span>}
      {manualUnmatched > 0 && (
        <span className="text-muted-foreground">
          {commonI18n.t("units.trades", { count: manualUnmatched })} без пары в выписке брокера — возможен дубль.
        </span>
      )}
    </p>
  );
}

export function TradeReviewLine({ t, compact }: { t: EodTrade; compact?: boolean }) {
  const isShort = (t.side ?? "").toLowerCase().startsWith("s");
  const manualIncomplete = t.missing.length > 0 && t.source !== "propreports";
  return (
    <li className={cn("rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs", manualIncomplete && "border-warn/50")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold">{t.ticker}</span>
        {t.side && <Pill>{isShort ? "↘ Short" : "↗ Long"}</Pill>}
        {t.setup ? <span className="text-muted-foreground">{t.setup}</span> : <span className="text-muted-foreground">без сетапа</span>}
        {t.confidenceGrade && <Pill tone={gradeTone(t.confidenceGrade)}>{t.confidenceGrade}</Pill>}
        {t.onPlan && <Pill tone="accent">в плане</Pill>}
        {t.followedPlan === true && <Pill tone="up">по плану</Pill>}
        {t.followedPlan === false && <Pill tone="down">не по плану</Pill>}
        <span className="ml-auto flex items-center gap-2 tabular-nums">
          {t.net != null ? (
            <span className={cn("font-semibold", toneText(toneOf(t.net)))}>{fmtUsd(t.net, { signed: true, decimals: "auto" })}</span>
          ) : (
            <span className="text-muted-foreground">{t.resultNorm === "open" ? "открыта" : "—"}</span>
          )}
          {t.r != null && <span className={toneText(toneOf(t.r))}>{fmtR(t.r, 1)}</span>}
        </span>
      </div>
      {(t.mistakes.length > 0 || t.lesson) && !compact && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {t.mistakes.map((m) => <Pill key={m} tone="down">{m}</Pill>)}
          {t.lesson && <span className="text-foreground/90">{t.lesson}</span>}
        </div>
      )}
    </li>
  );
}

function TextBlock({ label, text, tone, accent }: { label: string; text?: string; tone?: "up" | "down"; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl bg-[var(--glass-bg)] p-3", accent && "bg-primary/5")}>
      <div className={cn("micro-label mb-1", tone === "up" && "text-up", tone === "down" && "text-down", accent && "text-primary")}>{label}</div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">{text?.trim() ? text : "—"}</p>
    </div>
  );
}
