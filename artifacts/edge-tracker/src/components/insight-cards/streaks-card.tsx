/**
 * «Серии»: the current streak (flame in the profit / loss colour), the last 20 closed trades as a strip and three
 * records. Each segment is a link to the trade sheet with a tooltip (ticker · date · net); the strip is one tab stop
 * with arrow keys / Home / End inside (roving tabindex), Enter opens the trade.
 * Phones show the last 10 segments (≥ 24px tap targets, WCAG 2.5.8) under a «Последние 10 сделок» label; the streak
 * numbers are always counted over the whole window.
 */
import * as React from "react";
import { useLocation } from "wouter";
import { Flame, Zap } from "lucide-react";
import { LiveNumber } from "@/components/ds";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDate, fmtUsd } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { personName } from "@/i18n";
import { insightCardsI18n } from "@/i18n/ns/insightCards";
import { FooterLink, InsightCard, LowData, tradesHref, useMoneyTone, type InsightScope } from "./kit";
import { MIN, streaksOf, type InsightTrade, type Outcome, type StreakTrade } from "./model";

const PHONE_SEGMENTS = 10;

const SEG_BG: Record<Outcome, string> = { win: "bg-up/70", loss: "bg-down/70", be: "bg-be/60" };

function RecordStat({ label, value }: { label: string; value: number }) {
  const { t } = insightCardsI18n.useT();
  return (
    <div className="min-w-0" role="group" aria-label={t("streaks.statAria", { label, count: value })}>
      <div className="truncate text-xs text-muted-foreground" title={label} aria-hidden="true">{label}</div>
      <div className="text-sm font-semibold tabular-nums" aria-hidden="true">
        <LiveNumber value={value} flash={false} /> <span className="text-xs font-normal text-muted-foreground">{t("inARow")}</span>
      </div>
    </div>
  );
}

function Strip({ recent }: { recent: StreakTrade[] }) {
  const { t } = insightCardsI18n.useT();
  const [, navigate] = useLocation();
  const refs = React.useRef<(HTMLAnchorElement | null)[]>([]);
  const [active, setActive] = React.useState(recent.length - 1);
  React.useEffect(() => setActive(recent.length - 1), [recent.length]);

  // Phone: the first segments are hidden (display: none) — keyboard moves over the visible ones only.
  const visible = (i: number) => !!refs.current[i]?.offsetParent;
  const focusAt = (i: number) => { setActive(i); refs.current[i]?.focus(); };
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < recent.length; i += dir) if (visible(i)) return i;
    return from;
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); focusAt(step(i, 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); focusAt(step(i, -1)); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(step(-1, 1)); }
    else if (e.key === "End") { e.preventDefault(); focusAt(step(recent.length, -1)); }
  };
  const hiddenOnPhone = (i: number) => recent.length > PHONE_SEGMENTS && i < recent.length - PHONE_SEGMENTS;

  return (
    <ol
      aria-label={t("streaks.stripAria")}
      className={cn(
        "grid gap-1",
        recent.length > PHONE_SEGMENTS ? "grid-cols-10 sm:[grid-template-columns:var(--seg-cols)]" : "[grid-template-columns:var(--seg-cols)]",
      )}
      style={{ "--seg-cols": `repeat(${Math.max(recent.length, 1)}, minmax(0, 1fr))` } as React.CSSProperties}
    >
      {recent.map((s, i) => {
        const href = links.trade(s.id);
        const label = t("streaks.segment", { ticker: s.ticker, date: fmtDate(s.day, "dayMonth"), net: fmtUsd(s.net, { signed: true }) });
        return (
          <li key={s.id} className={cn("min-w-0", hiddenOnPhone(i) && "hidden sm:block")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  ref={(el) => { refs.current[i] = el; }}
                  href={href}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => setActive(i)}
                  onKeyDown={(e) => onKey(e, i)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    navigate(href);
                  }}
                  className={cn(
                    "block h-7 rounded-[5px] transition-[transform,filter] hover:brightness-110 motion-safe:hover:-translate-y-px",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    SEG_BG[s.outcome],
                  )}
                >
                  <span className="sr-only">{`${t(`streaks.outcome.${s.outcome}`)}: ${label}`}</span>
                </a>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="font-medium">{s.ticker}</span>
                <span className="text-muted-foreground"> · {fmtDate(s.day, "dayMonth")} · </span>
                <span className={s.outcome === "win" ? "text-up" : s.outcome === "loss" ? "text-down" : "text-be"}>{fmtUsd(s.net, { signed: true })}</span>
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}

export function StreaksCard({ trades, scope }: { trades: readonly InsightTrade[]; scope: InsightScope }) {
  const { t } = insightCardsI18n.useT();
  const tone = useMoneyTone();
  const s = React.useMemo(() => streaksOf(trades, tone.range), [trades, tone.range]);
  const cur = s.current;
  const isWin = cur.type === "win";
  const isLoss = cur.type === "loss";
  const subtitle = scope.ownerName ? t("streaks.of", { name: personName(scope.ownerName) }) : t("streaks.mine");
  const n = s.recent.length;

  return (
    <InsightCard
      icon={Zap}
      title={t("streaks.title")}
      subtitle={subtitle}
      footer={<FooterLink label={t("allTrades")} href={tradesHref(scope)} />}
    >
      {s.closed < MIN.streakTrades ? (
        <LowData have={s.closed} need={MIN.streakTrades} />
      ) : (
        <>
          <div className={cn("flex items-center gap-3 rounded-xl p-3", isWin ? "bg-up/10" : isLoss ? "bg-down/10" : "tile")}>
            <span
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-full",
                isWin ? "bg-up/20 text-up" : isLoss ? "bg-down/20 text-down" : "bg-[var(--glass-hover-bg)] text-muted-foreground",
              )}
            >
              <Flame className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{t("streaks.current")}</div>
              {cur.count > 0 ? (
                <div className={cn("text-lg font-semibold leading-tight", isWin ? "text-up" : "text-down")}>
                  <LiveNumber value={cur.count} flash={false} className="text-xl" />{" "}
                  {t(isWin ? "streaks.winsWord" : "streaks.lossesWord", { count: cur.count })}
                </div>
              ) : (
                <div className="text-sm font-medium text-foreground">
                  {t("streaks.none")} <span className="font-normal text-muted-foreground">· {t("streaks.noneHint")}</span>
                </div>
              )}
            </div>
          </div>

          {/* my-auto: in a row taller than the card's content the strip sits midway between the streak and the records. */}
          <div className="my-auto">
            <div className="mb-1.5 text-xs text-muted-foreground">
              {n > PHONE_SEGMENTS ? (
                <>
                  <span className="sm:hidden">{t("streaks.lastN", { count: PHONE_SEGMENTS })}</span>
                  <span className="hidden sm:inline">{t("streaks.lastN", { count: n })}</span>
                </>
              ) : (
                t("streaks.lastN", { count: n })
              )}
            </div>
            <Strip recent={s.recent} />
          </div>

          <div className="mt-auto grid grid-cols-3 gap-3">
            <RecordStat label={t("streaks.bestWin")} value={s.bestWin} />
            <RecordStat label={t("streaks.worstLoss")} value={s.worstLoss} />
            <RecordStat label={t("streaks.greenDays")} value={s.greenDays} />
          </div>
        </>
      )}
    </InsightCard>
  );
}
