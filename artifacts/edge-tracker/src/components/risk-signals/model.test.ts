import { describe, expect, it } from "vitest";
import { alertKey, inDeskHours, livePollInterval, savedView, stripAlerts, type RiskAlert } from "./model";

const alert = (p: Partial<RiskAlert>): RiskAlert => ({
  id: 1, trader: "T", day: "2026-10-21", signal: "loss_streak", level: "3", severity: "warn", tradeId: null,
  triggeredAt: "2026-10-21T14:30:00.000Z", detectedAt: "2026-10-21T14:30:05.000Z", stats: {}, staffNotified: false, seenAt: null,
  settled: false, restNet: null, baselineRest: null, baselineN: null, saved: null, ...p,
});

describe("risk signals model", () => {
  it("polls every 5 s only on weekdays 08:00–16:15 New York", () => {
    expect(inDeskHours(new Date("2026-10-21T14:00:00Z"))).toBe(true); // Wed 10:00 EDT
    expect(livePollInterval(new Date("2026-10-21T14:00:00Z"))).toBe(5000);
    expect(inDeskHours(new Date("2026-10-21T21:00:00Z"))).toBe(false); // 17:00 EDT
    expect(livePollInterval(new Date("2026-10-24T14:00:00Z"))).toBe(false); // Saturday
  });

  it("strip: unseen only, critical first, then newest", () => {
    const list = stripAlerts([
      alert({ id: 1, triggeredAt: "2026-10-21T14:00:00Z" }),
      alert({ id: 2, triggeredAt: "2026-10-21T15:00:00Z" }),
      alert({ id: 3, severity: "critical", signal: "revenge", level: "pace", triggeredAt: "2026-10-21T13:00:00Z" }),
      alert({ id: 4, seenAt: "2026-10-21T15:01:00Z" }),
    ]);
    expect(list.map((a) => a.id)).toEqual([3, 2, 1]);
    expect(alertKey(list[0]!)).toBe("revenge_pace");
  });

  it("saved: a number only with estimated alerts; otherwise why not", () => {
    expect(savedView({ alerts: 2, settled: 2, estimated: 1, hidden: 1, saved: -40, cases: 7 })).toEqual({ kind: "value", saved: -40 });
    expect(savedView({ alerts: 2, settled: 0, estimated: 0, hidden: 0, saved: null, cases: 0 })).toEqual({ kind: "pending" });
    expect(savedView({ alerts: 1, settled: 1, estimated: 0, hidden: 1, saved: null, cases: 0 })).toEqual({ kind: "small" });
    expect(savedView({ alerts: 0, settled: 0, estimated: 0, hidden: 0, saved: null, cases: 0 })).toEqual({ kind: "none" });
  });
});
