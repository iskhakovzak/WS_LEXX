/**
 * The compact insight cards next to «Серии»: trade number in the day, time in position, days of the week, after a
 * loss. One clear sentence each, «мало данных» under the sample threshold (model MIN), a drill into «Разрезы» from
 * every bar / row (kit useDrill) and the money colours of «Вид».
 */
import * as React from "react";
import { CalendarDays, Hourglass, ListOrdered, RotateCcw } from "lucide-react";
import { LiveNumber } from "@/components/ds";
import { fmtNum, fmtRate, fmtUsd, fmtWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { insightCardsI18n } from "@/i18n/ns/insightCards";
import { FooterLink, InsightCard, LowData, MiniBars, Verdict, fmtHoldShort, sliceHref, tradesHref, useDrill, useMoneyTone, type InsightScope } from "./kit";
import {
  MIN, afterLossStats, holdStats, holdVerdict, seqStats, weekdayStats, winRateOfBucket,
  type Bucket, type InsightTrade,
} from "./model";

type CardProps = { trades: readonly InsightTrade[]; scope: InsightScope };

const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
const tradesUnit = (n: number) => commonI18n.t("units.trades", { count: n });

/* ─────────────────────── «Номер сделки в дне» ─────────────────────── */

type SeqKey = "1" | "2" | "3" | "4-5" | "6+";

export function SeqCard({ trades, scope }: CardProps) {
  const { t } = insightCardsI18n.useT();
  const s = React.useMemo(() => seqStats(trades), [trades]);
  const drill = useDrill(scope);
  const label = (k: string) => t(`seq.label.${k as SeqKey}`);
  const best = s.buckets.find((b) => b.key === s.best);
  const worst = s.buckets.find((b) => b.key === s.worst);
  const verdict = !best || !worst ? null
    : worst.net >= 0 ? t("seq.allUp", { best: label(best.key) })
    : best.net <= 0 ? t("seq.allDown", { worst: label(worst.key) })
    : t("seq.mixed", { best: label(best.key), worst: label(worst.key) });

  return (
    <InsightCard
      icon={ListOrdered}
      title={t("seq.title")}
      subtitle={t("seq.subtitle")}
      footer={<FooterLink label={t("toFacets")} href={sliceHref(scope)} />}
    >
      {!s.enough ? (
        <LowData have={s.sample} need={MIN.seqTrades} />
      ) : (
        <>
          {verdict && <Verdict>{verdict}</Verdict>}
          <MiniBars
            items={s.buckets.map((b) => ({
              key: b.key,
              label: label(b.key),
              value: b.net,
              empty: b.trades === 0,
              mark: b.key === s.best || b.key === s.worst,
              aria: t("seq.barAria", { label: label(b.key), net: usd(b.net), trades: tradesUnit(b.trades) }),
              tip: <BarTip title={label(b.key)} net={b.net} trades={b.trades} />,
              onClick: () => drill("seq", [b.key]),
            }))}
          />
        </>
      )}
    </InsightCard>
  );
}

function BarTip({ title, net, trades }: { title: string; net: number; trades: number }) {
  const tone = useMoneyTone();
  return (
    <span className="tabular-nums">
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground"> · </span>
      <span className={tone.text(net)}>{usd(net)}</span>
      <span className="text-muted-foreground"> · {tradesUnit(trades)}</span>
    </span>
  );
}

/* ─────────────────────── «Время в позиции» ─────────────────────── */

function HoldRow({ label, sec, max, n, tone }: { label: string; sec: number | null; max: number; n: number; tone: "up" | "down" }) {
  const { t } = insightCardsI18n.useT();
  const w = sec != null && max > 0 ? Math.max(4, (sec / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2" role="group" aria-label={t("holdTime.rowAria", { label, hold: fmtHoldShort(sec), trades: tradesUnit(n) })}>
      <span className="truncate text-xs text-muted-foreground" aria-hidden="true">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden="true">
        <span className={cn("block h-full rounded-full", tone === "up" ? "bg-up" : "bg-down")} style={{ width: `${w}%` }} />
      </span>
      <span className="min-w-[4.5rem] text-right text-sm font-semibold tabular-nums" aria-hidden="true">
        <LiveNumber value={sec} format={fmtHoldShort} flash={false} />
      </span>
    </div>
  );
}

export function HoldCard({ trades, scope }: CardProps) {
  const { t } = insightCardsI18n.useT();
  const s = React.useMemo(() => holdStats(trades), [trades]);
  const v = holdVerdict(s.ratio);
  const x = s.ratio == null ? "" : fmtNum(v === "good" ? 1 / s.ratio : s.ratio, 1);
  const max = Math.max(s.winners ?? 0, s.losers ?? 0);

  return (
    <InsightCard
      icon={Hourglass}
      title={t("holdTime.title")}
      subtitle={t("holdTime.subtitle")}
      footer={<FooterLink label={t("holdTime.toLosers")} href={tradesHref(scope, { outcome: "loss", sort: "hold", dir: "desc", view: "list" })} />}
    >
      {!s.enough ? (
        <LowData have={Math.min(s.nWin, s.nLoss)} need={MIN.holdEach} />
      ) : (
        <>
          {v && <Verdict className={v === "bad" ? "text-down" : undefined}>{t(`holdTime.${v}`, { x })}</Verdict>}
          <div className="mt-auto flex flex-col gap-2.5">
            <HoldRow label={t("holdTime.winners")} sec={s.winners} max={max} n={s.nWin} tone="up" />
            <HoldRow label={t("holdTime.losers")} sec={s.losers} max={max} n={s.nLoss} tone="down" />
          </div>
        </>
      )}
    </InsightCard>
  );
}

/* ─────────────────────── «Дни недели» ─────────────────────── */

/** «1» (Mon) … «7» (Sun) → Date#getDay index for fmtWeekday. */
const dayIndex = (key: string) => Number(key) % 7;

export function WeekdayCard({ trades, scope }: CardProps) {
  const { t } = insightCardsI18n.useT();
  const s = React.useMemo(() => weekdayStats(trades), [trades]);
  const drill = useDrill(scope);

  return (
    <InsightCard
      icon={CalendarDays}
      title={t("weekday.title")}
      subtitle={t("weekday.subtitle")}
      footer={<FooterLink label={t("toFacets")} href={sliceHref(scope)} />}
    >
      {!s.enough ? (
        <LowData have={s.sample} need={MIN.weekdayTrades} />
      ) : (
        <>
          {s.best && s.worst && (
            <Verdict>{t("weekday.verdict", { best: fmtWeekday(dayIndex(s.best), "long"), worst: fmtWeekday(dayIndex(s.worst), "long") })}</Verdict>
          )}
          <MiniBars
            items={s.days.map((b: Bucket) => {
              const name = fmtWeekday(dayIndex(b.key), "long");
              return {
                key: b.key,
                label: fmtWeekday(dayIndex(b.key), "short"),
                value: b.net,
                empty: b.trades === 0,
                mark: b.key === s.best || b.key === s.worst,
                aria: t("weekday.barAria", { day: name, net: usd(b.net), trades: tradesUnit(b.trades) }),
                tip: <BarTip title={name} net={b.net} trades={b.trades} />,
                onClick: () => drill("days", [b.key]),
              };
            })}
          />
        </>
      )}
    </InsightCard>
  );
}

/* ─────────────────────── «После убытка» ─────────────────────── */

function AfterRow({ label, b, tone, onClick }: { label: string; b: Bucket; tone: "up" | "down"; onClick: () => void }) {
  const { t } = insightCardsI18n.useT();
  const money = useMoneyTone();
  const rate = winRateOfBucket(b);
  const avg = b.trades ? Math.round((b.net / b.trades) * 100) / 100 : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("afterLoss.rowAria", { label, rate: fmtRate(rate), trades: tradesUnit(b.trades) })}
      className="tile tile-interactive flex w-full flex-col gap-1.5 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-baseline justify-between gap-2" aria-hidden="true">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums">
          <LiveNumber value={rate} format={(n) => fmtRate(n)} flash={false} />
        </span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden="true">
        <span className={cn("block h-full rounded-full", tone === "up" ? "bg-up/80" : "bg-down/80")} style={{ width: `${Math.round((rate ?? 0) * 100)}%` }} />
      </span>
      <span className="truncate text-2xs text-muted-foreground tabular-nums" aria-hidden="true">
        {tradesUnit(b.trades)} · <span className={money.text(avg)}>{avg == null ? "—" : usd(avg)}</span>
      </span>
    </button>
  );
}

export function AfterLossCard({ trades, scope }: CardProps) {
  const { t } = insightCardsI18n.useT();
  const s = React.useMemo(() => afterLossStats(trades), [trades]);
  const drill = useDrill(scope);
  const a = fmtRate(winRateOfBucket(s.afterLoss));
  const b = fmtRate(winRateOfBucket(s.afterWin));

  return (
    <InsightCard
      icon={RotateCcw}
      title={t("afterLoss.title")}
      subtitle={t("afterLoss.subtitle")}
      footer={<FooterLink label={t("toFacets")} href={sliceHref(scope)} />}
    >
      {!s.enough ? (
        <LowData have={Math.min(s.afterLoss.trades, s.afterWin.trades)} need={MIN.afterEach} />
      ) : (
        <>
          {s.verdict && <Verdict className={s.verdict === "tilt" ? "text-down" : undefined}>{t(`afterLoss.${s.verdict}`, { a, b })}</Verdict>}
          <div className="mt-auto flex flex-col gap-2">
            <AfterRow label={t("afterLoss.afterLoss")} b={s.afterLoss} tone="down" onClick={() => drill("prev", ["after-loss"])} />
            <AfterRow label={t("afterLoss.afterWin")} b={s.afterWin} tone="up" onClick={() => drill("prev", ["after-win"])} />
          </div>
        </>
      )}
    </InsightCard>
  );
}
