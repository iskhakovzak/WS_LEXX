/**
 * «Серия» — the hero tile: the current streak as one giant numeral with «побед подряд» under it, the last 20 closed
 * trades as capsules diverging from a hairline (up = profit, down = loss, height = size of the net), what the current run
 * is worth in $, and the records. Each capsule is a link to the trade with a tooltip; the strip is one tab stop with
 * arrow keys / Home / End inside (roving tabindex). Phones show the last 10 capsules (≥ 24px targets).
 */
import * as React from "react";
import { useLocation } from "wouter";
import { FlaskConical, ListChecks } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBeRange } from "@/components/ds/money";
import { fmtDate, fmtRate } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { insightTilesI18n } from "@/i18n/ns/insightTiles";
import { ActionChip, Actions, Caption, DetailGrid, Huge, LowData, Num, Tile, Verdict, toneText, usd, useTone, type TileVariant } from "./kit";
import { TILE_MIN, streakInsight } from "./insights";
import { idsHref, ruleText, whatIfHref, type InsightScope } from "./nav";
import type { InsightTrade, StreakTrade } from "./model";
import { winRateOf } from "@/lib/trade-math";

const PHONE_CAPSULES = 10;

function Strip({ recent, runFrom }: { recent: StreakTrade[]; runFrom: number }) {
  const { t } = insightTilesI18n.useT();
  const [, navigate] = useLocation();
  const refs = React.useRef<(HTMLAnchorElement | null)[]>([]);
  const [active, setActive] = React.useState(recent.length - 1);
  React.useEffect(() => setActive(recent.length - 1), [recent.length]);
  const max = Math.max(1, ...recent.map((s) => Math.abs(s.net ?? 0)));
  const many = recent.length > PHONE_CAPSULES;
  const hiddenOnPhone = (i: number) => many && i < recent.length - PHONE_CAPSULES;

  // Phone: the first capsules are display: none — the keyboard moves over the visible ones only.
  const visible = (i: number) => !!refs.current[i]?.offsetParent;
  const focusAt = (i: number) => { setActive(i); refs.current[i]?.focus(); };
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < recent.length; i += dir) if (visible(i)) return i;
    return from;
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? step(i, 1) : e.key === "ArrowLeft" ? step(i, -1) : e.key === "Home" ? step(-1, 1) : e.key === "End" ? step(recent.length, -1) : null;
    if (to == null) return;
    e.preventDefault();
    focusAt(to);
  };

  const cols = (n: number) => ({ "--cols": `repeat(${Math.max(n, 1)}, minmax(0, 1fr))` }) as React.CSSProperties;
  const runLeft = (runFrom / recent.length) * 100;
  return (
    <div className="relative pb-7">
      <ol
        aria-label={t("streak.stripAria")}
        className={cn("ins-strip", many ? "[grid-template-columns:repeat(10,minmax(0,1fr))] sm:[grid-template-columns:var(--cols)]" : "[grid-template-columns:var(--cols)]")}
        style={cols(recent.length)}
      >
        {recent.map((s, i) => {
          const href = links.trade(s.id);
          // Square-root scale: a $5 scratch stays visible next to a $300 winner, the order of sizes is kept.
          const h = Math.max(14, Math.sqrt(Math.abs(s.net ?? 0) / max) * 100) / 2;
          const label = t("streak.capsule", { outcome: t(`streak.outcome.${s.outcome}`), ticker: s.ticker, date: fmtDate(s.day, "dayMonth"), net: usd(s.net) });
          return (
            <li key={s.id} className={cn("min-w-0", hiddenOnPhone(i) && "hidden sm:block")}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    ref={(el) => { refs.current[i] = el; }}
                    href={href}
                    data-o={s.outcome}
                    className="ins-cap"
                    tabIndex={i === active ? 0 : -1}
                    onFocus={() => setActive(i)}
                    onKeyDown={(e) => onKey(e, i)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      navigate(href);
                    }}
                  >
                    <i style={s.outcome === "be" ? undefined : { height: `${h}%` }} />
                    <span className="sr-only">{label}</span>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="top" className="tabular-nums">
                  <span className="font-semibold">{s.ticker}</span>{" "}
                  <span className={s.outcome === "win" ? "text-up" : s.outcome === "loss" ? "text-down" : "text-be"}>{usd(s.net)}</span>
                  <span className="text-muted-foreground"> · {fmtDate(s.day, "dayMonth")}</span>
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      {runFrom < recent.length && (
        <>
          {/* Phones show the last PHONE_CAPSULES only: the run mark is placed over those. */}
          {many && (
            <div className="ins-run sm:hidden" style={{ left: `${Math.max(0, (runFrom - (recent.length - PHONE_CAPSULES)) / PHONE_CAPSULES) * 100}%`, right: 0 }} aria-hidden="true">
              <span className="ins-label absolute right-0 top-1.5 whitespace-nowrap">{t("streak.current", { count: recent.length - runFrom })}</span>
            </div>
          )}
          <div className={cn("ins-run", many && "hidden sm:block")} style={{ left: `${runLeft}%`, right: 0 }} aria-hidden="true">
            <span className="ins-label absolute right-0 top-1.5 whitespace-nowrap">{t("streak.current", { count: recent.length - runFrom })}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function StreakTile({ trades, scope, variant }: { trades: readonly InsightTrade[]; scope: InsightScope; variant?: TileVariant }) {
  const { t } = insightTilesI18n.useT();
  const range = useBeRange();
  const tone = useTone();
  const s = React.useMemo(() => streakInsight(trades, range), [trades, range]);
  const cur = s.current;
  const n = s.recent.length;
  const runIds = new Set(s.ids);
  const runFrom = cur.type === "none" ? n : Math.max(0, s.recent.findIndex((x) => runIds.has(x.id)));
  const label = t("streak.label", { count: n });

  if (s.closed < TILE_MIN.streakTrades) {
    return <Tile variant={variant} id="streak" size="hero" label={label} verdict={<LowData have={s.closed} need={TILE_MIN.streakTrades} />} />;
  }

  const nets = s.recent.map((x) => x.net ?? 0);
  const wins = nets.filter((x) => x > 0), losses = nets.filter((x) => x < 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const byNet = s.recent.filter((x) => x.net != null).sort((a, b) => (a.net ?? 0) - (b.net ?? 0));
  const ex = {
    best: byNet.length && (byNet[byNet.length - 1].net ?? 0) > 0 ? byNet[byNet.length - 1] : null,
    worst: byNet.length && (byNet[0].net ?? 0) < 0 ? byNet[0] : null,
  };
  const caption = cur.type === "win" ? t("streak.wins", { count: cur.count }) : cur.type === "loss" ? t("streak.losses", { count: cur.count }) : t("streak.none");
  const verdict = cur.type === "loss" ? t("streak.lossRun")
    : cur.type === "none" ? t("streak.noneVerdict")
    : cur.count >= s.bestWin ? t("streak.record")
    : t("streak.toRecord", { best: s.bestWin, count: s.bestWin - cur.count + 1 });
  const stopRule = { type: "stopAfterLosses" as const, n: 2 };
  // The compact tile keeps the last capsules (the streak is a picture, not only a number).
  const miniFrom = Math.max(0, n - PHONE_CAPSULES);

  return (
    <Tile
      variant={variant}
      mini={<Strip recent={s.recent.slice(miniFrom)} runFrom={Math.max(0, runFrom - miniFrom)} />}
      id="streak"
      size="hero"
      label={label}
      extra={
        <span className="hidden flex-wrap gap-1.5 md:flex">
          {[t("streak.chipRecord", { n: s.bestWin }), t("streak.chipWorst", { n: s.worstLoss }), t("streak.chipGreen", { n: s.greenDays })].map((c) => (
            <span key={c} className="rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-2xs text-muted-foreground tabular-nums">{c}</span>
          ))}
        </span>
      }
      hero={
        <div className="flex items-center gap-4 sm:gap-6">
          <Huge size="xl" tone={cur.type === "loss" ? "down" : undefined}>{cur.count}</Huge>
          <div className="flex min-w-0 flex-col gap-3">
            <Caption xl text={caption} />
            {s.worth != null && s.since && (
              <span className="font-[family-name:var(--app-font-code)] text-xs text-muted-foreground tabular-nums">
                {t("streak.since", { date: fmtDate(s.since, "dayMonth") })} · <span className={toneText(tone(s.worth))}>{usd(s.worth)}</span>
              </span>
            )}
          </div>
        </div>
      }
      verdict={<Verdict text={verdict} />}
      chart={<Strip recent={s.recent} runFrom={runFrom} />}
      detail={
        <DetailGrid
          items={[
            { label: t("detail.trades"), value: n },
            { label: t("detail.winRate"), value: fmtRate(winRateOf(wins.length, losses.length)) },
            { label: t("detail.net"), value: <span className={toneText(tone(nets.reduce((a, b) => a + b, 0)))}>{usd(nets.reduce((a, b) => a + b, 0))}</span> },
            { label: t("detail.avgWin"), value: <span className="text-up">{usd(avg(wins))}</span> },
            { label: t("detail.avgLoss"), value: <span className="text-down">{usd(avg(losses))}</span> },
            { label: t("detail.best"), value: ex.best ? <>{ex.best.ticker} <Num tone="up">{usd(ex.best.net)}</Num></> : "—" },
            { label: t("detail.worst"), value: ex.worst ? <>{ex.worst.ticker} <Num tone="down">{usd(ex.worst.net)}</Num></> : "—" },
          ]}
        />
      }
      meta={
        <span className="text-xs text-muted-foreground md:hidden tabular-nums">
          {t("streak.chipRecord", { n: s.bestWin })} · {t("streak.chipWorst", { n: s.worstLoss })} · {t("streak.chipGreen", { n: s.greenDays })}
        </span>
      }
      actions={
        <Actions>
          {cur.type === "loss" && <ActionChip primary icon={FlaskConical} label={t("action.whatIfRule", { rule: ruleText(stopRule) })} href={whatIfHref(scope, [stopRule])} />}
          {s.ids.length > 0 && <ActionChip icon={ListChecks} label={t("streak.tradesOfRun")} href={idsHref([...s.ids].reverse(), scope)} />}
        </Actions>
      }
    />
  );
}
