import { describe, expect, it } from "vitest";
import { attentionRows, primaryAction } from "./cost-queue-model";
import type { CostQueueRow, QueueItem, TodayPayload } from "./api";

const next = (trader: string, kind: TodayPayload["nextActions"][number]["kind"], priority: number, href = `/journal?trader=${trader}`) =>
  ({ trader, kind, label: kind, priority, href });
const cost = (trader: string, costNet: number, kinds: CostQueueRow["reasons"][number]["kind"][], resolved = false): CostQueueRow =>
  ({ trader, date: "2026-10-16", costNet, resolved, reasons: kinds.map((kind) => ({ kind, costNet: null, text: { key: `costQueue.detail.${kind}` } })) });
const breach = (trader: string): QueueItem =>
  ({ kind: "breach", id: `breach:${trader}`, trader, title: "", since: null, hoursWaiting: null, href: "", overdue: false, slaHours: 24 });

describe("attentionRows", () => {
  it("open cost rows first (server order), then next steps of other traders, reviewed cost rows last", () => {
    const rows = attentionRows({
      byCost: [cost("A", -900, ["stop_breach"]), cost("B", -300, ["fees"], true), cost("C", -100, ["giveback"])],
      nextActions: [next("D", "eod_review", 50), next("A", "breach_review", 90), next("B", "missing_eod", 40)],
      queue: [breach("A")],
    });
    expect(rows.map((r) => `${r.type}:${r.trader}`)).toEqual(["cost:A", "cost:C", "next:D", "next:B", "cost:B"]);
    const a = rows[0];
    expect(a.type === "cost" && a.breachPending && a.next?.kind).toBe("breach_review");
  });

  it("a trader's other open days follow their most expensive day, marked as a continuation", () => {
    const day = (r: CostQueueRow, date: string): CostQueueRow => ({ ...r, date });
    const rows = attentionRows({
      byCost: [day(cost("A", -900, ["stop_breach"]), "2026-10-16"), day(cost("B", -500, ["fees"]), "2026-10-16"), day(cost("A", -400, ["giveback"]), "2026-10-15"), day(cost("A", -200, ["fees"]), "2026-10-14")],
      nextActions: [],
      queue: [],
    });
    expect(rows.map((r) => `${r.trader}:${r.type === "cost" ? r.item.date : ""}:${r.type === "cost" && r.cont ? "cont" : ""}`))
      .toEqual(["A:2026-10-16:", "A:2026-10-15:cont", "A:2026-10-14:cont", "B:2026-10-16:"]);
    // Every card of A's run (the first one too) is marked as one group; B's single day is not.
    expect(rows.map((r) => r.type === "cost" && !!r.group)).toEqual([true, true, true, false]);
  });

  it("works without byCost (older API): the plain next steps", () => {
    expect(attentionRows({ nextActions: [next("D", "eod_review", 50)], queue: [] }).map((r) => r.key)).toEqual(["next:D"]);
  });
});

describe("primaryAction", () => {
  const eod = { eodId: 7, closedAt: "2026-10-16T22:00:00Z", hoursWaiting: 30 };
  const row = (item: CostQueueRow, opts: { breachPending?: boolean; next?: ReturnType<typeof next> | null; eod?: typeof eod | null } = {}) =>
    ({ type: "cost" as const, key: "k", trader: item.trader, item, next: opts.next ?? null, breachPending: !!opts.breachPending, eod: opts.eod ?? null });

  it("breached stop with a pending review → review it; closed day → its EOD sheet; focus → the journal day; else next step; else the day", () => {
    expect(primaryAction(row(cost("A", -1, ["stop_breach", "fees"]), { breachPending: true }))).toEqual({ kind: "breach" });
    // OLGA-03: the row opens the day it came from, not the profile.
    expect(primaryAction(row(cost("A", -1, ["focus_broken"]), { eod }))).toEqual({ kind: "review", eod });
    expect(primaryAction(row(cost("A", -1, ["stop_breach", "disputed"])))).toEqual({ kind: "day" });
    expect(primaryAction(row(cost("A", -1, ["focus_broken"]), { next: next("A", "eod_review", 50, "/journal?x") }))).toEqual({ kind: "day" });
    expect(primaryAction(row(cost("A", -1, ["fees"]), { next: next("A", "eod_review", 50, "/journal?x") }))).toEqual({ kind: "next", href: "/journal?x" });
    expect(primaryAction(row(cost("A", -1, ["fees"]), { next: next("A", "breach_review", 90, "/curator?trader=A&tab=risk") }))).toEqual({ kind: "day" });
  });
});

describe("attentionRows: the day behind a row and long-overdue 1:1 (OLGA-03, OLGA-18)", () => {
  const eodItem = (trader: string, date: string, eodId: number): QueueItem =>
    ({ kind: "eod", id: `eod:${eodId}`, trader, title: "", since: "2026-10-16T22:00:00Z", hoursWaiting: 30, href: "", overdue: true, slaHours: 24, date, eodId });

  it("a cost row knows the closed day to review", () => {
    const rows = attentionRows({ byCost: [cost("A", -375, ["loss_streak"])], nextActions: [], queue: [eodItem("A", "2026-10-16", 7), eodItem("A", "2026-10-15", 6)] });
    expect(rows[0].type === "cost" && rows[0].eod).toEqual({ eodId: 7, closedAt: "2026-10-16T22:00:00Z", hoursWaiting: 30 });
  });

  it("wards without a 1:1 for > 30 days get their own row unless their shown step already is the 1:1", () => {
    const rows = attentionRows({
      byCost: [cost("A", -100, ["fees"])],
      nextActions: [next("B", "one_on_one", 20), next("C", "eod_review", 70)],
      queue: [],
      oneOnOneDue: [{ trader: "A", days: 62, last: "2026-08-17" }, { trader: "B", days: null, last: null }, { trader: "C", days: 40, last: null }],
    });
    expect(rows.map((r) => r.key)).toEqual(["cost:A:2026-10-16", "next:B", "next:C", "1on1:A", "1on1:C"]);
  });
});
