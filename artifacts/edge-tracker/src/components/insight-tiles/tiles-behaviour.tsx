/**
 * Behaviour tiles: «Номер сделки в дне», «После убытка / прибыли», «Время в позиции». Each: one numeral, one verdict
 * against the trader's own baseline, an interval badge, the trend versus the previous equal period and one action that
 * does something (What-if with the rule prefilled, the slice in «Разрезы», the exact trades).
 */
import * as React from "react";
import { FlaskConical, ListFilter, Timer } from "lucide-react";
import { commonI18n } from "@/i18n/ns/common";
import { fmtNum, fmtRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import { TileBars } from "./bars";
import {
  ActionChip, Actions, Caption, ConfidenceBadge, DetailGrid, Huge, InlineBars, LowData, Num, Phrase, Tile, TrendChip,
  fmtHold, pp, toneText, usd, usdAbs, useTone, type TileVariant,
} from "./kit";
import { TILE_MIN, afterInsight, holdInsight, seqInsight, seqTradesOf, summaryOf, type BucketSummary } from "./insights";
import { ruleText, seqLabel, tradesHref, useDrill, whatIfHref, type InsightScope } from "./nav";
import type { InsightTrade } from "./model";

type Props = { trades: readonly InsightTrade[]; prev?: readonly InsightTrade[] | null; scope: InsightScope; variant?: TileVariant };
const tradesUnit = (n: number) => commonI18n.t("units.trades", { count: n });

/** Win rate, avg win / loss and the best / worst trade of a bucket. */
function SummaryGrid({ s, extra = [] }: { s: BucketSummary; extra?: { label: string; value: React.ReactNode }[] }) {
  const { t } = insightTilesI18n.useT();
  return (
    <DetailGrid
      items={[
        ...extra,
        { label: t("detail.trades"), value: s.trades },
        { label: t("detail.winRate"), value: fmtRate(s.winRate) },
        { label: t("detail.avgWin"), value: <span className="text-up">{usd(s.avgWin)}</span> },
        { label: t("detail.avgLoss"), value: <span className="text-down">{usd(s.avgLoss)}</span> },
        { label: t("detail.best"), value: s.best ? <>{s.best.ticker} <Num tone="up">{usd(s.best.net)}</Num></> : "—" },
        { label: t("detail.worst"), value: s.worst ? <>{s.worst.ticker} <Num tone="down">{usd(s.worst.net)}</Num></> : "—" },
      ]}
    />
  );
}

/* ─────────────────────── «Номер сделки в дне» ─────────────────────── */

export function SeqTile({ trades, prev, scope, variant }: Props) {
  const { t } = insightTilesI18n.useT();
  const tone = useTone();
  const s = React.useMemo(() => seqInsight(trades, prev), [trades, prev]);
  const drill = useDrill(scope);
  const worstSummary = React.useMemo(() => (s.worst ? summaryOf(seqTradesOf(trades, s.worst.key)) : null), [trades, s.worst]);
  const label = t("seq.label");
  if (!s.enough || !s.best || !s.worst) return <Tile variant={variant} id="seq" size="third" label={label} verdict={<LowData have={s.sample} need={TILE_MIN.seqTrades} />} />;

  const best = s.best, worst = s.worst;
  const marks = s.buckets.findIndex((b) => b.key === worst.key);
  const text = worst.net < 0
    ? t("seq.verdictLeak", { label: seqLabel(worst.key), amount: "{amount}", period: t("period", { period: scope.periodLong }), diff: "{diff}" })
    : t("seq.verdictUp", { label: seqLabel(worst.key), amount: "{amount}" });

  return (
    <Tile
      variant={variant}
      id="seq"
      size="third"
      label={label}
      badge={<ConfidenceBadge claim={s.claim} fmt={usd} />}
      hero={
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <Huge size="lg">{seqLabel(best.key)}</Huge>
          <span className="flex flex-col gap-1 pb-1">
            <Caption text={best.net > 0 ? t("seq.caption") : t("seq.captionDown")} />
            <span className={cn("font-[family-name:var(--app-font-code)] text-xs tabular-nums", toneText(tone(best.net)))}>{usd(best.net)}</span>
          </span>
        </div>
      }
      verdict={
        <p className="ins-verdict">
          <InlineBars values={s.buckets.map((b) => b.net)} mark={marks} tone={tone} />
          <Phrase text={text} nodes={{ amount: <Num tone={tone(worst.net)}>{usd(worst.net)}</Num>, diff: <Num>{usdAbs(worst.vsBaseline)}</Num> }} />
        </p>
      }
      chart={
        <TileBars
          height={72}
          items={s.buckets.map((b) => ({
            key: b.key,
            label: seqLabel(b.key),
            value: b.net,
            empty: b.trades === 0,
            mark: b.key === best.key || b.key === worst.key,
            aria: t("seq.barAria", { label: seqLabel(b.key), net: usd(b.net), trades: tradesUnit(b.trades) }),
            tip: <><b>{seqLabel(b.key)}</b> <span className={toneText(tone(b.net))}>{usd(b.net)}</span> · {tradesUnit(b.trades)}</>,
            onClick: () => drill("seq", [b.key]),
          }))}
        />
      }
      detail={worstSummary && <SummaryGrid s={worstSummary} extra={[{ label: t("detail.baseline"), value: usd(s.baseline) }]} />}
      meta={<TrendChip trend={s.trend} fmt={usd} />}
      actions={
        <Actions>
          {s.rule && <ActionChip primary icon={FlaskConical} label={t("action.whatIfRule", { rule: ruleText(s.rule) })} href={whatIfHref(scope, [s.rule])} />}
          <ActionChip icon={ListFilter} label={t("action.trades")} onClick={() => drill("seq", [worst.key])} />
        </Actions>
      }
    />
  );
}

/* ─────────────────────── «После убытка / прибыли» ─────────────────────── */

function Meter({ label, rate, avg, tone, onClick }: { label: string; rate: number | null; avg: number | null; tone: "up" | "down"; onClick: () => void }) {
  const money = useTone();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <b className="font-semibold">{fmtRate(rate)}</b>
          <span className={cn("ml-2", toneText(money(avg)))}>{usd(avg)}</span>
        </span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden="true">
        <span className={cn("block h-full rounded-full", tone === "up" ? "bg-up/80" : "bg-down/80")} style={{ width: `${Math.round((rate ?? 0) * 100)}%` }} />
      </span>
    </button>
  );
}

export function AfterTile({ trades, prev, scope, variant }: Props) {
  const { t } = insightTilesI18n.useT();
  const s = React.useMemo(() => afterInsight(trades, prev), [trades, prev]);
  const drill = useDrill(scope);
  const label = t("after.label");
  if (!s.enough || !s.verdict) {
    return <Tile variant={variant} id="after" size="third" label={label} verdict={<LowData have={Math.min(s.afterLoss.trades, s.afterWin.trades)} need={TILE_MIN.afterEach} />} />;
  }
  const a = fmtRate(s.afterLoss.winRate), b = fmtRate(s.afterWin.winRate);
  return (
    <Tile
      variant={variant}
      id="after"
      size="third"
      label={label}
      badge={<ConfidenceBadge claim={s.claim} fmt={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pp(v)}`} />}
      hero={
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <Huge size="lg" label={`${a}`}>{a}</Huge>
          <Caption text={t("after.caption")} className="pb-1" />
        </div>
      }
      verdict={
        <p className={cn("ins-verdict", s.verdict === "tilt" && "[&_b]:text-down")}>
          <Phrase text={t(`after.${s.verdict}`, { a: "{a}", b: "{b}" })} nodes={{ a: <Num>{a}</Num>, b: <Num>{b}</Num> }} />
        </p>
      }
      chart={
        <div className="flex flex-col gap-1.5" aria-label={t("after.ringAria", { a, b })} role="group">
          <Meter label={t("after.afterLoss")} rate={s.afterLoss.winRate} avg={s.afterLoss.avg} tone="down" onClick={() => drill("prev", ["after-loss"])} />
          <Meter label={t("after.afterWin")} rate={s.afterWin.winRate} avg={s.afterWin.avg} tone="up" onClick={() => drill("prev", ["after-win"])} />
        </div>
      }
      detail={
        <DetailGrid
          items={[
            { label: `${t("after.afterLoss")} · ${t("detail.trades")}`, value: s.afterLoss.trades },
            { label: t("detail.avgWin"), value: <span className="text-up">{usd(s.afterLoss.avgWin)}</span> },
            { label: t("detail.avgLoss"), value: <span className="text-down">{usd(s.afterLoss.avgLoss)}</span> },
            { label: `${t("after.afterWin")} · ${t("detail.trades")}`, value: s.afterWin.trades },
            { label: t("detail.avgWin"), value: <span className="text-up">{usd(s.afterWin.avgWin)}</span> },
            { label: t("detail.avgLoss"), value: <span className="text-down">{usd(s.afterWin.avgLoss)}</span> },
          ]}
        />
      }
      meta={<TrendChip trend={s.trend} fmt={(d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${pp(d)}`} />}
      actions={
        <Actions>
          {s.rule && <ActionChip primary icon={FlaskConical} label={t("action.whatIfRule", { rule: ruleText(s.rule) })} href={whatIfHref(scope, [s.rule])} />}
          <ActionChip icon={ListFilter} label={t("action.trades")} onClick={() => drill("prev", ["after-loss"])} />
        </Actions>
      }
    />
  );
}

/* ─────────────────────── «Время в позиции» ─────────────────────── */

function HoldRow({ label, sec, max, tone }: { label: string; sec: number | null; max: number; tone: "up" | "down" }) {
  const w = sec != null && max > 0 ? Math.max(4, (sec / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,6.5rem)_1fr_auto] items-center gap-2 text-xs">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden="true">
        <span className={cn("block h-full rounded-full", tone === "up" ? "bg-up" : "bg-down")} style={{ width: `${w}%` }} />
      </span>
      <span className="min-w-[3.5rem] text-right font-semibold tabular-nums">{fmtHold(sec)}</span>
    </div>
  );
}

export function HoldTile({ trades, prev, scope, variant }: Props) {
  const { t } = insightTilesI18n.useT();
  const s = React.useMemo(() => holdInsight(trades, prev), [trades, prev]);
  const label = t("hold.label");
  if (!s.enough || !s.verdict || s.ratio == null) {
    return <Tile variant={variant} id="hold" size="third" label={label} verdict={<LowData have={Math.min(s.nWin, s.nLoss)} need={TILE_MIN.holdEach} />} />;
  }
  const x = s.verdict === "good" ? 1 / s.ratio : s.ratio;
  const times = `${fmtNum(x, 1)}×`;
  const caption = s.verdict === "bad" ? t("hold.captionBad") : s.verdict === "good" ? t("hold.captionGood") : t("hold.captionEven");
  const max = Math.max(s.winners ?? 0, s.losers ?? 0);
  const fmtX = (v: number) => `${fmtNum(v, 2)}×`;
  return (
    <Tile
      variant={variant}
      id="hold"
      size="third"
      label={label}
      badge={<ConfidenceBadge claim={s.claim} fmt={fmtX} />}
      hero={
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <Huge size="lg">{times}</Huge>
          <Caption text={caption} className="pb-1" />
        </div>
      }
      verdict={
        <p className={cn("ins-verdict", s.verdict === "bad" && "[&_.ins-accent]:text-down")}>
          <Phrase
            text={t(`hold.${s.verdict}`, { winners: "{winners}", losers: "{losers}" })}
            nodes={{ winners: <Num tone="up">{fmtHold(s.winners)}</Num>, losers: <Num tone="down">{fmtHold(s.losers)}</Num> }}
          />
        </p>
      }
      chart={
        <div className="flex flex-col gap-2.5">
          <HoldRow label={t("hold.winners")} sec={s.winners} max={max} tone="up" />
          <HoldRow label={t("hold.losers")} sec={s.losers} max={max} tone="down" />
        </div>
      }
      detail={
        <div className="flex h-full flex-col justify-end gap-2">
          <DetailGrid
            items={[
              { label: t("hold.winners"), value: s.nWin },
              { label: t("hold.losers"), value: s.nLoss },
              { label: t("detail.avgWin"), value: <span className="text-up">{usd(s.avgWin)}</span> },
              { label: t("detail.avgLoss"), value: <span className="text-down">{usd(s.avgLoss)}</span> },
            ]}
          />
          {s.longestLoser && (
            <p className="text-2xs text-muted-foreground tabular-nums">
              {t("hold.longest", { ticker: s.longestLoser.ticker, hold: fmtHold(s.longestLoser.hold), net: usd(s.longestLoser.net) })}
            </p>
          )}
        </div>
      }
      meta={<TrendChip trend={s.trend} fmt={(d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmtNum(Math.abs(d), 2)}×`} />}
      actions={
        <Actions>
          <ActionChip icon={Timer} label={t("hold.toLosers")} href={tradesHref(scope, { outcome: "loss", sort: "hold", dir: "desc", view: "list" })} />
        </Actions>
      }
    />
  );
}
