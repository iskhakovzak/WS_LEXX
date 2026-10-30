/**
 * Staff notices of the critical risk signals (the top stop level, revenge) through the existing notification system
 * (lib/notifyUtils notifyUser: in-app row, recipient preferences, optional Telegram through the push budget). Type
 * `risk_signal`, rendered per reader by lib/notificationRenderers/riskSignals.ts. Recipients: the trader's curator /
 * mentor and the risk manager (else every curator / admin — lib/leakGuard/notify). Telegram only when
 * SignalConfig.telegram (desk switch riskSignals.telegram AND a production API with a bot token); without keys nothing
 * is sent. Once per alert: the caller claims staff_notified_at first.
 *
 * The trader is not notified here: the live strip on the dashboard shows every alert, and the 70 % / 100 % stop
 * already have their own notices (lib/riskAlerts risk_warn / risk_breach).
 */
import { notifyUser } from "../notifyUtils";
import { uniqueRecipients } from "../notifyEventsCore";
import { curatorsOf, riskManagersOf } from "../leakGuard/notify";
import type { AlertRow } from "./store";
import type { SignalConfig } from "./types";

export const RISK_SIGNAL_TYPE = "risk_signal";

export async function notifyStaff(a: AlertRow, cfg: SignalConfig): Promise<number> {
  const names = uniqueRecipients([...(await curatorsOf(a.trader)), ...(await riskManagersOf(a.trader))], a.trader);
  const params = { variant: "staff", trader: a.trader, signal: a.signal, level: a.level, ...a.stats };
  for (const userName of names) {
    await notifyUser({
      userName, type: RISK_SIGNAL_TYPE, severity: "critical", source: "risk", actor: a.trader, telegram: cfg.telegram, params,
      link: `/risk?trader=${encodeURIComponent(a.trader)}`, entityType: "risk_signal", entityId: String(a.id),
    });
  }
  return names.length;
}
