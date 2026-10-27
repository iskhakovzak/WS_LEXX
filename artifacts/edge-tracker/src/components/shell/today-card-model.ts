/**
 * The sidebar «Сегодня» footer, as plain data (unit-tested in today-card-model.test.ts): today's net, the number of
 * trades and what is left to the daily stop — from GET /api/risk/me (use-shell-badges RiskToday).
 *
 * Same rule as the dashboard hero (components/dashboard/today-hero RiskCell): a halt is red only on a trading day,
 * when trading is really stopped today. On a weekend or a full-day market holiday the card reads neutrally
 * («Рынок закрыт», «Рынок закрыт · <holiday>»; a stop as «… — статус к следующей сессии»), never a Saturday alarm,
 * and the daily meter is left out (nothing can be used on a closed day).
 *
 * The red halt is only for a person who is really stopped: a trader, or anyone who traded this week (design audit
 * wave 2: an admin with an old drawdown and no trades saw «торговля остановлена» on every screen). Otherwise the stop
 * is a quiet fact; the dashboard hero is the one place of the alarm either way.
 */
import { fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { shellI18n } from "@/i18n/ns/shell";
import { idleHalt, type RiskToday } from "./use-shell-badges";

export type TodayTone = "down" | "warn" | "ok";

/** Is the US market closed for the whole NY day (weekend / full-day holiday)? `reason` = the holiday's name, if any. */
export type MarketDay = { closed: boolean; reason: string | null };

export type TodayCardModel = {
  /** Colour of the meter and of the limit line. Never "down" / "warn" on a closed day. */
  tone: TodayTone;
  /** Signed net P&L, or null before the first trade. */
  pnl: string | null;
  pnlSign: -1 | 0 | 1;
  /** «3 сделки», «Сделок нет» or, on a closed day without trades, «Рынок закрыт» (+ the holiday). */
  tradesLine: string;
  /** Share of the daily stop used, 0…100; null without a daily limit or on a closed day (no meter then). */
  usedPct: number | null;
  /** «До дневного стопа $420», a halt, or the neutral «… — статус к следующей сессии»; null when there is nothing to say. */
  limitLine: string | null;
  /** The limit line is an alarm (red / amber) rather than a muted fact. */
  limitAlarm: boolean;
  /** Screen-reader text of the meter. */
  usedAria: string | null;
};

const STOP_KEY = { stop: "daily", weekly: "weekly", drawdown: "drawdown" } as const;

export function todayCardModel(risk: RiskToday, day: MarketDay, opts: { trader?: boolean } = {}): TodayCardModel {
  const t = shellI18n.t;
  const net = risk.pnlNet ?? 0;
  const pnl = risk.trades > 0 || risk.pnlNet != null ? fmtUsd(net, { signed: true, decimals: "auto" }) : null;
  const pnlSign = net > 0 ? 1 : net < 0 ? -1 : 0;
  const trades = risk.trades > 0 ? commonI18n.t("units.trades", { count: risk.trades }) : null;

  if (day.closed) {
    const closed = day.reason ? `${t("today.marketClosed")} · ${day.reason}` : t("today.marketClosed");
    const stop = risk.halted ? t(`today.stop.${STOP_KEY[risk.haltedBy ?? "stop"]}`) : null;
    return {
      tone: "ok",
      pnl,
      pnlSign,
      tradesLine: trades ?? closed,
      usedPct: null,
      limitLine: stop ? t("today.haltedClosed", { stop }) : trades ? closed : null,
      limitAlarm: false,
      usedAria: null,
    };
  }

  const idle = idleHalt(risk, !!opts.trader);
  const tone: TodayTone = idle ? "ok" : risk.halted || risk.status === "breach" ? "down" : risk.status === "warn" ? "warn" : "ok";
  const usedPct = risk.dailyUsedPct == null ? null : Math.max(0, Math.min(100, risk.dailyUsedPct));
  const limitLine = idle
    ? t("today.haltedIdle", { stop: t(`today.stop.${STOP_KEY[risk.haltedBy ?? "stop"]}`) })
    : risk.halted
    ? t(risk.haltedBy === "drawdown" ? "today.haltedDrawdown" : risk.haltedBy === "weekly" ? "today.haltedWeekly" : "today.halted")
    : risk.dailyRemainingUsd != null ? t("today.toStop", { amount: fmtUsd(risk.dailyRemainingUsd, { decimals: "trim" }) }) : null;
  return {
    tone,
    pnl,
    pnlSign,
    tradesLine: trades ?? t("today.noTrades"),
    usedPct,
    limitLine,
    limitAlarm: tone !== "ok",
    usedAria: usedPct == null ? null : t("today.usedAria", { pct: fmtRate(usedPct / 100) }),
  };
}
