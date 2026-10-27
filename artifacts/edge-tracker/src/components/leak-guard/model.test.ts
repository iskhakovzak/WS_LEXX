import { describe, expect, it } from "vitest";
import { fmtCountdown, needsAck, pickBannerEvent, remainingMs, type GuardEvent } from "./model";

const ev = (id: number, over: Partial<GuardEvent>): GuardEvent => ({
  id, day: "2026-10-05", pattern: "after_loss", level: "soft", triggeredAt: "2026-10-05T14:35:00Z", detectedAt: "2026-10-05T14:37:00Z",
  pauseUntil: "2026-10-05T14:45:00Z", late: false, silentReason: null, costPerTrade: 60, costPerTrigger: 30, minutes: 10, ackedAt: null,
  escalatedAt: null, riskNotifiedAt: null, releasedAt: null, releasedBy: null, outcome: null, outcomeNet: null, saved: null, lost: null,
  atRiskTradeIds: [], lagSec: 120, ...over,
});

describe("leak guard banner model", () => {
  it("shows an unacknowledged firm / hard event first and never lets it be hidden", () => {
    const soft = ev(1, { detectedAt: "2026-10-05T14:50:00Z" });
    const firm = ev(2, { level: "firm" });
    expect(pickBannerEvent([soft, firm], new Set())?.id).toBe(2);
    expect(pickBannerEvent([soft, firm], new Set([2]))?.id).toBe(2);
    expect(pickBannerEvent([soft, { ...firm, ackedAt: "2026-10-05T14:38:00Z" }], new Set([1, 2]))).toBeNull();
    expect(needsAck({ level: "hard", ackedAt: null })).toBe(true);
    expect(needsAck({ level: "soft", ackedAt: null })).toBe(false);
  });

  it("counts down on the server clock", () => {
    const until = "2026-10-05T14:45:00Z";
    const client = Date.parse("2026-10-05T14:40:00Z");
    expect(remainingMs(until, client, 0)).toBe(5 * 60_000);
    expect(remainingMs(until, client, 60_000)).toBe(4 * 60_000); // server is a minute ahead
    expect(remainingMs(until, client + 10 * 60_000, 0)).toBe(0);
    expect(remainingMs(null, client, 0)).toBeNull();
    expect(fmtCountdown(5 * 60_000)).toBe("5:00");
    expect(fmtCountdown(61_500)).toBe("1:02");
    expect(fmtCountdown(3_725_000)).toBe("1:02:05");
  });
});
