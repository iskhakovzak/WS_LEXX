// One «Следующий шаг» on the phone (Волна 1, item 1.3): the step follows the phase of the day.
import { describe, expect, it } from "vitest";
import { eveningBroken, me } from "@/components/daily/__tests__/fixtures";
import { dailyTaskOpen, nextStep } from "../next-step-model";

const plan = { maxLossUsd: 300, maxTrades: 10, ownRule: "behavior:revenge" };
const win = (open: boolean) => ({ from: { date: "2026-10-19", time: "16:00" }, until: { date: "2026-10-20", time: "08:30" }, open });

describe("nextStep", () => {
  it("before the open, no plan → «Напиши план» for the session", () => {
    const s = nextStep({ me: me({ phase: "premarket" }), plan: null });
    expect(s).toMatchObject({ kind: "plan", date: "2026-10-19", href: "/game-plan?view=my&date=2026-10-19" });
  });

  it("before the open with the plan written, and during the session → the contract + focus", () => {
    expect(nextStep({ me: me({ phase: "premarket" }), plan })?.kind).toBe("contract");
    expect(nextStep({ me: me({ phase: "session" }), plan: null })?.kind).toBe("contract");
    // While the plan still loads the morning does not flash «Напиши план».
    expect(nextStep({ me: me({ phase: "premarket" }), plan: undefined })?.kind).toBe("contract");
  });

  it("after the close → «Закрой день» for the finished day, into its journal", () => {
    const s = nextStep({ me: me({ phase: "afterclose", today: "2026-10-16", evening: eveningBroken }), plan: null });
    expect(s).toMatchObject({ kind: "close", date: "2026-10-16", trades: 12, netPnl: -120.5 });
    expect(s?.href).toContain("/journal?date=2026-10-16");
    // The dashboard's EOD status names an older open day → that one.
    expect(nextStep({ me: me({ phase: "weekend", evening: { ...eveningBroken, reviewed: true } }), plan: null, journalOpenDate: "2026-10-15" }))
      .toMatchObject({ kind: "close", date: "2026-10-15" });
  });

  it("closed → «Задача дня ждёт» while its window is open; then tomorrow's plan; then done", () => {
    const closed = me({ phase: "afterclose", evening: { ...eveningBroken, reviewed: true } });
    expect(nextStep({ me: closed, plan: null, daily: { played: false, revealed: null, window: win(true) } })?.kind).toBe("task");
    expect(nextStep({ me: closed, plan: null, daily: { played: true, revealed: null, window: win(true) } })?.kind).toBe("plan");
    expect(nextStep({ me: closed, plan, daily: { played: true, revealed: null, window: win(true) } })).toMatchObject({ kind: "done", href: null });
  });

  it("no daily loop for the viewer → no card", () => {
    expect(nextStep({ me: null, plan: null })).toBeNull();
  });
});

describe("dailyTaskOpen", () => {
  it("open window and not played; older servers without a window → no card", () => {
    expect(dailyTaskOpen({ played: false, revealed: null, window: win(true) })).toBe(true);
    expect(dailyTaskOpen({ played: false, revealed: null, window: win(false) })).toBe(false);
    expect(dailyTaskOpen({ played: false, revealed: null })).toBe(false);
    expect(dailyTaskOpen(null)).toBe(false);
  });
});
