/**
 * The mentor's stop guard: a trader the risk desk stopped is never handed a «trade down to −$X» rule, whatever the
 * model wrote — the brief's rule becomes «do not trade — write to your curator» with the hero's numbers.
 */
import { describe, expect, it } from "vitest";
import { guardStopped } from "../stopGuard";
import type { StopInput } from "../stopGuard";

const ok: StopInput = { stopped: false, stopReason: null, drawdownFromPeakUsd: 120, maxDrawdownUsd: 800, dailyLossLimitUsd: 150, weeklyLossLimitUsd: null, todayNetUsd: 0, weekNetUsd: 0 };
const drawdown: StopInput = { ...ok, stopped: true, stopReason: "drawdown", drawdownFromPeakUsd: 900 };
const brief = { headline: "Calm day", points: ["Current drawdown $0.00"], ruleToday: "Stop after a $150 daily loss", setupIds: [3], setups: [{ id: 3, name: "ORB" }] };

describe("mentor stop guard", () => {
  it("leaves the answer alone when trading is not stopped", () => {
    expect(guardStopped("brief", brief, ok, "en")).toEqual(brief);
  });

  it("a stopped trader's brief: the stop, the drawdown from the peak vs the limit, no trading rule, no setups", () => {
    const g = guardStopped("brief", brief, drawdown, "en");
    expect(g.headline).toBe("Trading is stopped until your curator decides");
    expect(g.ruleToday).toBe("Don't trade until your curator decides — write to your curator.");
    expect(g.points).toEqual([expect.stringContaining("$900")]);
    expect(g.points[0]).toContain("$800");
    expect(g.setupIds).toEqual([]);
    expect(g.setups).toEqual([]);
    expect(JSON.stringify(g)).not.toContain("$150");
    expect(guardStopped("brief", brief, drawdown, "ru").ruleToday).toContain("куратор"); // i18n-ignore (asserts the ru text)
  });

  it("debrief / chat: the stop leads; a stop that outlasts today saves no rule for tomorrow", () => {
    const debrief = { summary: "3 trades", vsPlan: "-", lesson: "-", praise: null, challenge: null, notes: [], ruleTomorrow: { kind: "max_daily_loss", usd: 150 } };
    const d = guardStopped("debrief", debrief, drawdown, "en");
    expect(d.ruleTomorrow).toBeNull();
    expect(d.summary.startsWith("Trading is stopped")).toBe(true);
    expect(guardStopped("debrief", debrief, { ...drawdown, stopReason: "stop", todayNetUsd: -160 }, "en").ruleTomorrow).not.toBeNull();
    expect(guardStopped("chat", { reply: "Size down", notes: [], commitment: null }, drawdown, "en").reply).toMatch(/^Trading is stopped/);
  });
});
