/**
 * «Где уходят деньги» — the most useful tile: the costliest slice of the book (time of entry, trade number, after a loss /
 * a win, price band, strategy) as one big $ figure with its verdict against the trader's average trade, its interval
 * and trend, then the strongest slice and a short ranked list. Actions: test the fix in «Что если» (when the simulator
 * has a rule for it) and open exactly those trades through «Разрезы». Data comes through the edge-map adapter.
 */
import * as React from "react";
import { FlaskConical, ListFilter } from "lucide-react";
import { fmtRate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { trendOf } from "@/lib/stats-lite";
import { cn } from "@/lib/utils";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import { ActionChip, Actions, Caption, ConfidenceBadge, DetailGrid, Huge, LowData, Num, Phrase, Tile, TrendChip, Verdict, toneText, usd, usdAbs, useTone, type TileVariant } from "./kit";
import { EDGE_MIN, ruleForSlice, sliceNet, useEdgeMap, type EdgeSlice } from "./edge-map";
import { ruleText, sliceLabel, useDrill, whatIfHref, type InsightScope } from "./nav";
import type { InsightTrade } from "./model";

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function SliceRow({ s, max, onOpen }: { s: EdgeSlice; max: number; onOpen: () => void }) {
  const { t } = insightTilesI18n.useT();
  const tone = useTone();
  const w = Math.max(3, (Math.abs(s.net) / max) * 100);
  const name = sliceLabel(s.dim, s.key);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={`${name}: ${usd(s.net)} · ${t(`confidence.${s.confidence}`)}`}
        className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,24%)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,40%)_auto] items-center gap-3 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate text-muted-foreground">{name}</span>
        <span className="relative h-2 rounded-full bg-foreground/[0.06]" aria-hidden="true">
          <span className={cn("absolute inset-y-0 left-0 rounded-full", s.net < 0 ? "bg-down" : "bg-up", s.confidence === "solid" ? "opacity-90" : "opacity-45")} style={{ width: `${w}%` }} />
        </span>
        <span className={cn("min-w-[4.5rem] text-right font-semibold tabular-nums", toneText(tone(s.net)))}>{usd(s.net)}</span>
      </button>
    </li>
  );
}

export function LeaksTile({ trades, prev, scope, variant }: { trades: readonly InsightTrade[]; prev?: readonly InsightTrade[] | null; scope: InsightScope; variant?: TileVariant }) {
  const { t } = insightTilesI18n.useT();
  const tone = useTone();
  const map = useEdgeMap(trades);
  const drill = useDrill(scope);
  const strategies = React.useMemo(() => [...new Set(trades.map((x) => (x.strategy ?? "").trim()).filter(Boolean))], [trades]);
  const leak = map?.leaks[0] ?? null;
  const strength = map?.strengths[0] ?? null;
  const prevLeak = React.useMemo(() => (leak && prev ? sliceNet(prev, leak.dim, leak.key) : null), [leak, prev]);
  const label = t("leaks.label");
  // Too few trades for any slice: on the dashboard the tile still holds its place (its grid never gets a hole).
  if (!map) return !variant ? null : <Tile variant={variant} id="leaks" size="wide" label={label} verdict={<LowData have={trades.length} need={EDGE_MIN.trades} />} />;

  const open = (s: EdgeSlice) => drill(s.dim, [s.key], s.dim === "strategies" ? strategies : []);
  const period = t("period", { period: scope.periodLong });
  // The medium dashboard tile: the ranked list only (the strongest slice is in it); large / /stats: + the strength.
  const ranked = variant === "m" ? [...map.leaks.slice(0, 2), ...map.strengths.slice(0, 2)] : [...map.leaks.slice(0, 3), ...map.strengths.slice(0, 2)];
  const showStrength = variant !== "m";
  const max = Math.max(1, ...ranked.map((s) => Math.abs(s.net)));
  const rule = leak ? ruleForSlice(leak) : null;
  const trend = leak && prevLeak && prevLeak.trades ? trendOf(leak.net, prevLeak.net, { flatWithin: 1 }) : null;

  const verdict = leak ? (
    <Verdict
      large
      text={t(leak.vsBaseline <= 0 ? "leaks.verdictWorse" : "leaks.verdictBetter", { period, trades: commonI18n.t("units.trades", { count: leak.trades }), diff: "{diff}" })}
      nodes={{ diff: <Num tone="down">{usdAbs(leak.vsBaseline)}</Num> }}
    />
  ) : (
    <Verdict large text={t("leaks.noLeak")} />
  );

  return (
    <Tile
      variant={variant}
      id="leaks"
      size="wide"
      phoneVerdictFirst={false}
      label={label}
      badge={leak && <ConfidenceBadge claim={leak} fmt={usd} have={leak.trades} need={EDGE_MIN.trades} />}
      hero={
        leak ? (
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <Huge size="lg" tone={tone(leak.net)}>{usd(leak.net)}</Huge>
            <Caption xl text={`*${lc(sliceLabel(leak.dim, leak.key))}*`} className="pb-1" />
          </div>
        ) : undefined
      }
      verdict={verdict}
      chart={
        ranked.length > 0 && (
          <div className="flex flex-col gap-3">
            {strength && showStrength && (
              <div className="flex flex-col items-start gap-1.5 border-t border-[var(--glass-border)] pt-3">
                <span className="ins-label">{t("leaks.strengthLabel")}</span>
                <p className="ins-verdict text-sm">
                  <Phrase
                    text={t("leaks.strength", { slice: lc(sliceLabel(strength.dim, strength.key)), amount: "{amount}", diff: "{diff}" })}
                    nodes={{ amount: <Num tone="up">{usd(strength.net)}</Num>, diff: <Num>{usdAbs(strength.vsBaseline)}</Num> }}
                  />
                </p>
                <ConfidenceBadge claim={strength} fmt={usd} />
              </div>
            )}
            <ul className="flex flex-col gap-0.5" aria-label={t("leaks.others")}>
              {ranked.map((s) => <SliceRow key={`${s.dim}:${s.key}`} s={s} max={max} onOpen={() => open(s)} />)}
            </ul>
          </div>
        )
      }
      detail={
        leak && (
          <div className="flex h-full flex-col justify-end gap-3">
            <DetailGrid
              items={[
                { label: t("detail.trades"), value: leak.trades },
                { label: t("detail.days"), value: leak.days },
                { label: t("detail.winRate"), value: fmtRate(leak.wins + leak.losses ? leak.wins / (leak.wins + leak.losses) : null) },
                { label: t("detail.avg"), value: <span className={toneText(tone(leak.avg))}>{usd(leak.avg)}</span> },
                { label: t("detail.baseline"), value: <span className={toneText(tone(map.total.avg))}>{usd(map.total.avg)}</span> },
                { label: t("detail.worst"), value: leak.worst ? <>{leak.worst.ticker} <Num tone="down">{usd(leak.worst.net)}</Num></> : "—" },
              ]}
            />
            <p className="text-2xs text-muted-foreground">{t("leaks.tested", { count: map.tested, trades: EDGE_MIN.trades, days: EDGE_MIN.days })}</p>
          </div>
        )
      }
      meta={leak && <TrendChip trend={trend} fmt={(d) => usd(d)} />}
      actions={
        leak && (
          <Actions>
            {rule && <ActionChip primary icon={FlaskConical} label={t("action.whatIfRule", { rule: ruleText(rule) })} href={whatIfHref(scope, [rule])} />}
            <ActionChip icon={ListFilter} label={t("action.trades")} onClick={() => open(leak)} />
          </Actions>
        )
      }
    />
  );
}
