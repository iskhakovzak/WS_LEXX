/**
 * Live risk signal notices to staff (lib/riskSignals/notify.ts), rendered per reader (texts: `notifications`
 * namespace, `risk_signal.*`):
 *   staff  { trader, signal, level, …the alert's numbers: pct / lossUsd / limitUsd (stop), ratio / medianUsd / entries /
 *          usual / windowMin / lossUsd (revenge), losses (streak), ticker (off plan), time / event (window) }
 * Names, tickers and event names are data.
 */
import type { NotificationRenderer } from "../notificationText";
import { fmtMoney } from "../notifyEventsCore";
import { personNameFor } from "../people/latinNames";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const riskSignal: NotificationRenderer = ({ params, lang, tr }) => {
  const signal = str(params.signal);
  const trader = str(params.trader);
  if (!signal || !trader) return null;
  const level = str(params.level) ?? "";
  const vars = {
    trader: personNameFor(trader, lang),
    pct: Math.round(num(params.pct)), loss: fmtMoney(num(params.lossUsd)), limit: fmtMoney(num(params.limitUsd)),
    ratio: num(params.ratio).toFixed(1), median: fmtMoney(num(params.medianUsd)), entries: num(params.entries), usual: num(params.usual).toFixed(1),
    minutes: num(params.windowMin), losses: num(params.losses), ticker: str(params.ticker) ?? "", time: str(params.time) ?? level, event: str(params.event) ?? "",
  };
  const title = tr(`risk_signal.title.${signal}`, vars);
  if (!title) return null;
  const body = (signal === "revenge" ? tr(`risk_signal.body.revenge_${level === "pace" ? "pace" : "size"}`, vars) : tr(`risk_signal.body.${signal}`, vars)) ?? "";
  const tail = tr("risk_signal.tail") ?? "";
  const full = [body, tail].filter(Boolean).join(" ");
  return { title, body: full, telegram: full ? `<b>${esc(title)}</b>\n${esc(full)}` : `<b>${esc(title)}</b>` };
};

export const riskSignalRenderers: Record<string, NotificationRenderer> = {
  risk_signal: riskSignal,
};
