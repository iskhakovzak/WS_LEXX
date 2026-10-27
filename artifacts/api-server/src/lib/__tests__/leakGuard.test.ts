/** Live leak guard (lib/leakGuard): personal gating, live detection with the latency flags, ladder, settlement in $. */
import { describe, expect, it } from "vitest";
import { personalProfile, welchT } from "../leakGuard/profile";
import { detectLive, dueSteps, inQuietHours, levelFor, settle, type StoredEvent } from "../leakGuard/detect";
import { guardConfig } from "../leakGuard/config";
import { summarize } from "../leakGuard/impact";
import { SETTINGS, type SettingKey } from "../settings/registry";
import type { GuardConfig, GuardTrade } from "../leakGuard/types";

const MIN = 60_000;
const cfg: GuardConfig = guardConfig((k: SettingKey) => SETTINGS[k].default, false);
/** 10:00 NY on 2026-10-05 (EDT, UTC−4). */
const at = (day: string, hh: number, mm: number) => Date.parse(`${day}T${String(hh + 4).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);

let nextId = 1;
function trade(day: string, entryHm: [number, number], holdMin: number, net: number, qty = 100, entry = 10): GuardTrade {
  const entryAt = at(day, ...entryHm);
  return {
    id: nextId++, date: day, result: net > 0 ? "win" : net < 0 ? "loss" : "be", net, qty, entry, entryAt,
    exitAt: entryAt + holdMin * MIN, horizon: "intraday",
  };
}

/** 12 days: a loss at 10:00, a re-entry 3 min after it that loses; calm trades later in the day that win. */
function revengeHistory(reentryNet: number): GuardTrade[] {
  const out: GuardTrade[] = [];
  for (let d = 1; d <= 12; d++) {
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    out.push(trade(day, [9, 45], 5, 30 + d)); // first trade of the day: a winner
    out.push(trade(day, [10, 0], 5, -40)); // loss, exit 10:05
    out.push(trade(day, [10, 8], 4, reentryNet - d)); // re-entry 3 min after the loss
    out.push(trade(day, [13, 0], 10, 25 + (d % 3)));
    out.push(trade(day, [14, 0], 10, 20 + (d % 4)));
  }
  return out;
}

describe("personal profile: only patterns that cost THIS trader money", () => {
  it("re-entering right after a loss is costly when those trades lose against the trader's norm", () => {
    const p = personalProfile({ history: revengeHistory(-60), dailyLimit: null, violations: [] }, cfg);
    const al = p.after_loss!;
    expect(al.atRisk).toBe(12);
    expect(al.triggers).toBe(24); // every closed loss is a trigger: the 10:00 loss and the losing re-entry
    expect(al.costly).toBe(true);
    expect(al.costPerTrade!).toBeGreaterThan(50);
    expect(al.tStat!).toBeLessThan(-cfg.minTStat);
    // no limits → no near-stop pattern; the first trade (a winner) does not cost money
    expect(p.near_stop).toBeUndefined();
    expect(p.first_trade!.costly).toBe(false);
  });

  it("is not costly when the re-entries do as well as the norm", () => {
    const p = personalProfile({ history: revengeHistory(32), dailyLimit: null, violations: [] }, cfg);
    expect(p.after_loss!.costly).toBe(false);
  });

  it("Welch t needs two values on each side", () => {
    expect(welchT([1], [1, 2, 3])).toBeNull();
    expect(welchT([-10, -12, -11], [5, 6, 7])!).toBeLessThan(-5);
  });
});

describe("live detection", () => {
  const profile = personalProfile({ history: revengeHistory(-60), dailyLimit: null, violations: [] }, cfg);
  const day = "2026-10-05";
  const loss = trade(day, [10, 30], 5, -55); // exit 10:35
  const base = { trader: "alice", day, profile, cfg, warnAt: null, violations: [] };

  it("a closed loss raises a pause until exit + pauseMinutes, told while it runs", () => {
    const now = at(day, 10, 37);
    const [d] = detectLive({ ...base, now, nowMin: 10 * 60 + 37, today: [loss] }).filter((x) => x.pattern === "after_loss");
    expect(d).toMatchObject({ sourceKey: `trade:${loss.id}`, triggeredAt: loss.exitAt, late: false, stale: false });
    expect(d.pauseUntil).toBe(loss.exitAt! + cfg.pauseMinutes * MIN);
    expect(d.costPerTrade).toBe(profile.after_loss!.costPerTrade);
  });

  it("marks the event late when the re-entry is already in (the sync brought both), stale when the pause is over", () => {
    const reentry = trade(day, [10, 37], 2, -20);
    const late = detectLive({ ...base, now: at(day, 10, 40), nowMin: 640, today: [loss, reentry] }).find((x) => x.pattern === "after_loss")!;
    expect(late.late).toBe(true);
    const stale = detectLive({ ...base, now: at(day, 11, 0), nowMin: 660, today: [loss] }).find((x) => x.pattern === "after_loss")!;
    expect(stale.stale).toBe(true);
  });

  it("raises nothing for a pattern that does not cost the trader money, or when the guard is off", () => {
    const calm = personalProfile({ history: revengeHistory(32), dailyLimit: null, violations: [] }, cfg);
    expect(detectLive({ ...base, profile: calm, now: at(day, 10, 37), nowMin: 637, today: [loss] })).toEqual([]);
    expect(detectLive({ ...base, cfg: { ...cfg, enabled: false }, now: at(day, 10, 37), nowMin: 637, today: [loss] })).toEqual([]);
  });
});

describe("ladder", () => {
  it("defaults: Джун firm, Трейдер and Сеньор soft; a per-trader override wins", () => {
    expect(levelFor("junior", null, cfg)).toBe("firm");
    expect(levelFor("trader", null, cfg)).toBe("soft");
    expect(levelFor("senior", null, cfg)).toBe("soft");
    expect(levelFor("senior", "hard", cfg)).toBe("hard");
    expect(levelFor("junior", "off", cfg)).toBe("off");
    expect(cfg.telegram).toBe(false);
    expect(guardConfig((k: SettingKey) => SETTINGS[k].default, true).telegram).toBe(false); // the desk switch is off by default
  });

  it("firm escalates to the curator without an acknowledgement or after a trade in the pause; hard tells the risk manager; soft never", () => {
    const e = { detectedAt: 0, ackedAt: null, escalatedAt: null, riskNotifiedAt: null, ignoredSoFar: false };
    expect(dueSteps({ ...e, level: "firm" }, (cfg.ackMinutes - 1) * MIN, cfg)).toEqual({ escalateCurator: false, notifyRisk: false });
    expect(dueSteps({ ...e, level: "firm" }, cfg.ackMinutes * MIN, cfg).escalateCurator).toBe(true);
    expect(dueSteps({ ...e, level: "firm", ackedAt: MIN, ignoredSoFar: true }, MIN, cfg).escalateCurator).toBe(true);
    expect(dueSteps({ ...e, level: "hard" }, 0, cfg).notifyRisk).toBe(true);
    expect(dueSteps({ ...e, level: "soft", ignoredSoFar: true }, 60 * MIN, cfg)).toEqual({ escalateCurator: false, notifyRisk: false });
  });

  it("quiet hours, also across midnight", () => {
    expect(inQuietHours(955, { enabled: true, fromMin: 950, toMin: 960 })).toBe(true);
    expect(inQuietHours(961, { enabled: true, fromMin: 950, toMin: 960 })).toBe(false);
    expect(inQuietHours(30, { enabled: true, fromMin: 1200, toMin: 540 })).toBe(true);
    expect(inQuietHours(955, { enabled: false, fromMin: 950, toMin: 960 })).toBe(false);
  });
});

describe("settlement and impact in $", () => {
  const day = "2026-10-06";
  const t0 = at(day, 10, 0);
  const ev: StoredEvent = { pattern: "after_loss", day, triggeredAt: t0, pauseUntil: t0 + 10 * MIN, late: false, costPerTrigger: 42, medianNotional: null };

  it("complied = no entry in the pause → saved ≈ the trader's expected cost of the trigger; open window → not yet", () => {
    expect(settle(ev, [], t0 + 5 * MIN, false, cfg)).toBeNull();
    expect(settle(ev, [trade(day, [10, 30], 5, -10)], t0 + 11 * MIN, false, cfg)).toMatchObject({ outcome: "complied", saved: 42, lost: 0 });
  });

  it("ignored = entries in the pause → lost = their actual loss; still-open at-risk trade waits", () => {
    const r1 = trade(day, [10, 3], 2, -70);
    const r2 = trade(day, [10, 6], 3, 25);
    expect(settle(ev, [r1, r2], t0 + 20 * MIN, false, cfg)).toMatchObject({ outcome: "ignored", saved: 0, lost: 45, actualNet: -45, atRiskIds: [r1.id, r2.id] });
    const open = { ...trade(day, [10, 4], 1, 0), result: "open" as const, net: null };
    expect(settle(ev, [open], t0 + 20 * MIN, false, cfg)).toBeNull();
    expect(settle({ ...ev, late: true }, [r1], t0 + 20 * MIN, false, cfg)).toMatchObject({ outcome: "late", saved: 0, lost: 0 });
  });

  it("first trade at half size complies and saves part of the expected cost; no trade all day → no_trades", () => {
    const ft: StoredEvent = { ...ev, pattern: "first_trade", pauseUntil: null, medianNotional: 2000 };
    expect(settle(ft, [trade(day, [9, 40], 5, -15, 100, 10)], t0, false, cfg)).toMatchObject({ outcome: "complied", saved: 21 });
    expect(settle(ft, [trade(day, [9, 40], 5, -90, 300, 10)], t0, false, cfg)).toMatchObject({ outcome: "ignored", lost: 90 });
    expect(settle(ft, [], t0, false, cfg)).toBeNull();
    expect(settle(ft, [], t0, true, cfg)).toMatchObject({ outcome: "no_trades" });
  });

  it("summarizes compliance, saved and lost per week; late events count apart", () => {
    const s = summarize([
      { day: "2026-10-05", pattern: "after_loss", outcome: "complied", saved: 42, lost: 0, lagSec: 240 },
      { day: "2026-10-06", pattern: "after_loss", outcome: "ignored", saved: 0, lost: 45, lagSec: 360 },
      { day: "2026-10-07", pattern: "near_stop", outcome: "late", saved: 0, lost: 0, lagSec: 600 },
      { day: "2026-10-13", pattern: "after_loss", outcome: "complied", saved: 42, lost: 0, lagSec: 120 },
      { day: "2026-10-13", pattern: "first_trade", outcome: null, saved: null, lost: null, lagSec: null },
    ]);
    expect(s).toMatchObject({ events: 5, settled: 4, complied: 2, ignored: 1, late: 1, saved: 84, lost: 45, compliance: 0.67, medianLagSec: 300 });
    expect(s.weekly).toEqual([
      { week: "2026-10-05", saved: 42, lost: 45, complied: 1, ignored: 1 },
      { week: "2026-10-12", saved: 42, lost: 0, complied: 1, ignored: 0 },
    ]);
  });
});
