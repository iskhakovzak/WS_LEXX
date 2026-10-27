/**
 * Money tiles: «Дни недели» (which weekday takes the money), «Комиссии» (how thin the edge is: fee share of the gross,
 * per-share figures, break-even win rate against the actual one) and «Сегодня» (the live day net with a sparkline,
 * against the trader's average day).
 */
import * as React from "react";
import { FileText, ListChecks, ListFilter } from "lucide-react";
import { LiveNumber } from "@/components/ds";
import { commonI18n } from "@/i18n/ns/common";
import { fmtRate, fmtUsd, fmtWeekday } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import { TileBars } from "./bars";
import {
  ActionChip, Actions, Caption, ConfidenceBadge, DetailGrid, Huge, InlineBars, LowData, Num, Phrase, Spark, Tile, TrendChip,
  pp, toneText, usd, useTone, type TileVariant,
} from "./kit";
import { TILE_MIN, feesInsight, summaryOf, todayInsight, weekdayInsight, weekdayTradesOf } from "./insights";
import { idsHref, useDrill, type InsightScope } from "./nav";
import type { InsightTrade } from "./model";

type Props = { trades: readonly InsightTrade[]; prev?: readonly InsightTrade[] | null; scope: InsightScope; variant?: TileVariant };
const tradesUnit = (n: number) => commonI18n.t("units.trades", { count: n });
/** «1» (Mon) … «7» (Sun) → Date#getDay index for fmtWeekday. */
const dayIndex = (key: string) => Number(key) % 7;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signedPp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pp(v)}`;

/* ─────────────────────── «Дни недели» ─────────────────────── */

export function WeekdayTile({ trades, prev, scope, variant }: Props) {
  const { t } = insightTilesI18n.useT();
  const tone = useTone();
  const s = React.useMemo(() => weekdayInsight(trades, prev), [trades, prev]);
  const drill = useDrill(scope);
  const worstSummary = React.useMemo(() => (s.worst ? summaryOf(weekdayTradesOf(trades, s.worst.key)) : null), [trades, s.worst]);
  const label = t("weekdays.label");
  if (!s.enough || !s.best || !s.worst) return <Tile variant={variant} id="weekdays" size="half" label={label} verdict={<LowData have={s.sample} need={TILE_MIN.weekdayTrades} />} />;

  const best = s.best, worst = s.worst;
  const worstName = cap(fmtWeekday(dayIndex(worst.key), "long"));
  const text = worst.net < 0
    ? t("weekdays.verdictLeak", { day: worstName, amount: "{amount}", period: t("period", { period: scope.periodLong }), wr: fmtRate(worst.winRate), trades: tradesUnit(worst.trades) })
    : t("weekdays.verdictUp", { day: worstName, amount: "{amount}" });
  return (
    <Tile
      variant={variant}
      id="weekdays"
      size="half"
      label={label}
      badge={<ConfidenceBadge claim={s.claim} fmt={usd} />}
      hero={
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <Huge size="lg">{cap(fmtWeekday(dayIndex(best.key), "short"))}</Huge>
          <span className="flex flex-col gap-1 pb-1">
            <Caption text={t("weekdays.caption")} />
            <span className={cn("font-[family-name:var(--app-font-code)] text-xs tabular-nums", toneText(tone(best.net)))}>{usd(best.net)}</span>
          </span>
        </div>
      }
      verdict={
        <p className="ins-verdict">
          <InlineBars values={s.days.map((d) => d.net)} mark={s.days.findIndex((d) => d.key === worst.key)} tone={tone} />
          <Phrase text={text} nodes={{ amount: <Num tone={tone(worst.net)}>{usd(worst.net)}</Num> }} />
        </p>
      }
      chart={
        <TileBars
          height={72}
          items={s.days.map((d) => {
            const name = cap(fmtWeekday(dayIndex(d.key), "long"));
            return {
              key: d.key,
              label: cap(fmtWeekday(dayIndex(d.key), "short")),
              value: d.net,
              empty: d.trades === 0,
              mark: d.key === best.key || d.key === worst.key,
              aria: t("weekdays.barAria", { day: name, net: usd(d.net), trades: tradesUnit(d.trades) }),
              tip: <><b>{name}</b> <span className={toneText(tone(d.net))}>{usd(d.net)}</span> · {tradesUnit(d.trades)}</>,
              onClick: () => drill("days", [d.key]),
            };
          })}
        />
      }
      detail={
        worstSummary && (
          <DetailGrid
            items={[
              { label: t("detail.trades"), value: worstSummary.trades },
              { label: t("detail.winRate"), value: fmtRate(worstSummary.winRate) },
              { label: t("detail.avgWin"), value: <span className="text-up">{usd(worstSummary.avgWin)}</span> },
              { label: t("detail.avgLoss"), value: <span className="text-down">{usd(worstSummary.avgLoss)}</span> },
              { label: t("detail.best"), value: worstSummary.best ? <>{worstSummary.best.ticker} <Num tone="up">{usd(worstSummary.best.net)}</Num></> : "—" },
              { label: t("detail.worst"), value: worstSummary.worst ? <>{worstSummary.worst.ticker} <Num tone="down">{usd(worstSummary.worst.net)}</Num></> : "—" },
            ]}
          />
        )
      }
      meta={<TrendChip trend={s.trend} fmt={usd} />}
      actions={
        <Actions>
          <ActionChip icon={ListFilter} label={t("action.trades")} onClick={() => drill("days", [worst.key])} />
        </Actions>
      }
    />
  );
}

/* ─────────────────────── «Комиссии» ─────────────────────── */

export function FeesTile({ trades, prev, scope, variant }: Props) {
  const { t } = insightTilesI18n.useT();
  const s = React.useMemo(() => feesInsight(trades, prev), [trades, prev]);
  const label = t("fees.label");
  if (!s.enough || s.margin == null || s.beRate == null) return <Tile variant={variant} id="fees" size="third" label={label} verdict={<LowData have={s.trades} need={TILE_MIN.feeTrades} />} />;

  const shareKnown = s.feeShare != null;
  const perShare = (v: number | null) => fmtUsd(v, { decimals: 4 });
  return (
    <Tile
      variant={variant}
      id="fees"
      size="third"
      label={label}
      badge={<ConfidenceBadge claim={s.claim} fmt={signedPp} />}
      hero={
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <Huge size="lg">{shareKnown ? fmtRate(s.feeShare) : fmtUsd(s.fees, { decimals: "auto" })}</Huge>
          <Caption text={shareKnown ? t("fees.caption") : t("fees.captionLoss")} className="max-w-[14rem] pb-1" />
        </div>
      }
      verdict={
        <div className="flex flex-col gap-1">
          <p className={cn("ins-verdict", s.margin < 0 && "[&_.ins-accent]:text-down")}>
            <Phrase
              text={t(s.margin >= 0 ? "fees.above" : "fees.below", { be: "{be}", wr: "{wr}", margin: pp(s.margin), window: scope.periodShort ?? scope.periodLong })}
              nodes={{ be: <Num>{fmtRate(s.beRate)}</Num>, wr: <Num>{fmtRate(s.winRate)}</Num> }}
            />
          </p>
          {s.marginGross != null && <p className="text-xs text-muted-foreground">{t("fees.gross", { margin: signedPp(s.marginGross) })}</p>}
        </div>
      }
      chart={
        <div className="flex flex-col gap-2 text-xs">
          <MarginBar wr={s.winRate ?? 0} be={s.beRate} />
          <p className="flex justify-between text-2xs text-muted-foreground tabular-nums">
            <span>{t("detail.winRate")} {fmtRate(s.winRate)}</span>
            <span>{t("fees.beRate")} {fmtRate(s.beRate)}</span>
          </p>
          <p className="text-muted-foreground tabular-nums">{t("fees.perShare", { fee: perShare(s.feePerShare), gross: perShare(s.grossPerShare) })}</p>
        </div>
      }
      detail={
        <DetailGrid
          items={[
            { label: t("fees.grossTotal"), value: <span className={s.gross >= 0 ? "text-up" : "text-down"}>{usd(s.gross)}</span> },
            { label: t("fees.feesTotal"), value: <span className="text-down">{fmtUsd(-s.fees, { decimals: "auto" })}</span> },
            { label: t("detail.net"), value: <span className={s.net >= 0 ? "text-up" : "text-down"}>{usd(s.net)}</span> },
            { label: t("detail.trades"), value: s.trades },
            { label: t("detail.winRate"), value: fmtRate(s.winRate) },
            { label: t("fees.beRate"), value: fmtRate(s.beRate) },
          ]}
        />
      }
      meta={<TrendChip trend={s.trend} fmt={signedPp} />}
      actions={
        s.eaten.count > 0 && (
          <Actions>
            <ActionChip icon={ListChecks} label={`${t("fees.eatenAction")} · ${s.eaten.count}`} href={idsHref(s.eaten.ids, scope)} />
          </Actions>
        )
      }
    />
  );
}

/** The actual win rate against the break-even one on one 0–100% track: the gap is the margin. */
function MarginBar({ wr, be }: { wr: number; be: number }) {
  const { t } = insightTilesI18n.useT();
  const lo = Math.min(wr, be), hi = Math.max(wr, be);
  return (
    <div className="relative h-6" role="img" aria-label={`${t("fees.beRate")} ${fmtRate(be)} · ${t("detail.winRate")} ${fmtRate(wr)}`}>
      <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/[0.07]" />
      <span className={cn("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full", wr >= be ? "bg-up/70" : "bg-down/70")} style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />
      <span className="absolute top-0 h-6 w-px bg-foreground/60" style={{ left: `${be * 100}%` }} />
      <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground" style={{ left: `${wr * 100}%` }} />
    </div>
  );
}

/* ─────────────────────── «Сегодня» ─────────────────────── */

export function TodayTile({ trades, today, liveNet, scope }: { trades: readonly InsightTrade[]; today: string; liveNet: number | null | undefined; scope: InsightScope }) {
  const { t } = insightTilesI18n.useT();
  const tone = useTone();
  const s = React.useMemo(() => todayInsight(trades, today), [trades, today]);
  const net = liveNet ?? s.net;
  const avg = s.avgDay;
  const text = avg == null ? t("today.noBase") : s.trades === 0 && !liveNet ? t("today.none", { avg: "{avg}" }) : net >= avg ? t("today.above", { avg: "{avg}" }) : t("today.below", { avg: "{avg}" });
  return (
    <Tile
      id="today"
      size="quarter"
      label={t("today.label")}
      extra={<span className="ins-label tabular-nums">{tradesUnit(s.trades)}</span>}
      hero={
        <Huge size="md" tone={tone(net)}>
          <LiveNumber value={net} format={(n) => fmtUsd(n, { signed: true })} resetKey={today} flash={false} />
        </Huge>
      }
      verdict={<p className="ins-verdict"><Phrase text={text} nodes={{ avg: <Num tone={tone(avg)}>{usd(avg)}</Num> }} /></p>}
      chart={<Spark series={s.series} tone={tone(s.net)} label={t("today.sparkAria")} className="w-full" />}
      meta={s.beat != null && s.trades > 0 && <span className="text-2xs text-muted-foreground tabular-nums">{t("today.beat", { share: fmtRate(s.beat) })}</span>}
      actions={
        <Actions>
          <ActionChip icon={FileText} label={t("action.dayReport")} href={links.dayReport(today, scope.trader ?? undefined)} />
        </Actions>
      }
    />
  );
}
