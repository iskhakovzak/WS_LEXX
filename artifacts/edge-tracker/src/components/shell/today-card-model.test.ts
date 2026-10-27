// Sidebar «Сегодня» footer (today-card-model.ts): today's net / trades / what is left to the stop, and never a red
// halt on a weekend or a market holiday (the dashboard hero's rule).
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { todayCardModel } from "./today-card-model";
import type { RiskToday } from "./use-shell-badges";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const base: RiskToday = {
  status: "ok", alerts: 0, halted: false, haltedBy: null, pnlNet: null, trades: 0,
  dailyUsedPct: 0, dailyRemainingUsd: 500, hasLimits: true, weekTrades: 0, live: null,
};
const open = { closed: false, reason: null };
const weekend = { closed: true, reason: null };
const holiday = { closed: true, reason: "Thanksgiving Day" };

describe("todayCardModel", () => {
  it("a trading day: net, trades, the meter and what is left to the stop", () => {
    const m = todayCardModel({ ...base, pnlNet: -120, trades: 3, dailyUsedPct: 24, dailyRemainingUsd: 380, status: "ok" }, open);
    expect(m.pnl).toMatch(/120/);
    expect(m.pnlSign).toBe(-1);
    expect(m.tradesLine).toBe("3 сделки");
    expect(m.usedPct).toBe(24);
    expect(m.limitLine).toMatch(/^До дневного стопа/);
    expect(m.limitAlarm).toBe(false);
    expect(m.usedAria).toMatch(/24/);
  });

  it("no trades yet: «Сделок нет», no P&L", () => {
    const m = todayCardModel(base, open);
    expect(m.tradesLine).toBe("Сделок нет");
    expect(m.pnl).toBeNull();
    expect(m.pnlSign).toBe(0);
  });

  it("halted on a trading day: red, named by the stop", () => {
    const m = todayCardModel({ ...base, halted: true, haltedBy: "drawdown", status: "breach" }, open, { trader: true });
    expect(m.tone).toBe("down");
    expect(m.limitAlarm).toBe(true);
    expect(m.limitLine).toBe("Макс. просадка: торговля остановлена");
    // Not a trader and no trades this week (a staff account with an old drawdown): a quiet fact, no red footer.
    const idle = todayCardModel({ ...base, halted: true, haltedBy: "drawdown", status: "breach" }, open);
    expect(idle.limitAlarm).toBe(false);
    expect(idle.limitLine).toBe("Макс. просадка — подробности в риск-деске");
  });

  it("a weekend: neutral wording, no meter, never a red halt", () => {
    const quiet = todayCardModel(base, weekend);
    expect(quiet.tradesLine).toBe("Рынок закрыт");
    expect(todayCardModel(base, holiday).tradesLine).toBe("Рынок закрыт · Thanksgiving Day");
    expect(quiet.usedPct).toBeNull();
    expect(quiet.limitLine).toBeNull();
    const halted = todayCardModel({ ...base, halted: true, haltedBy: "drawdown", status: "breach", dailyUsedPct: 100 }, weekend);
    expect(halted.tone).toBe("ok");
    expect(halted.limitAlarm).toBe(false);
    expect(halted.usedPct).toBeNull();
    expect(halted.limitLine).toBe("Макс. просадка — статус к следующей сессии");
    expect(halted.limitLine).not.toMatch(/остановлена/);
    const daily = todayCardModel({ ...base, halted: true, haltedBy: "stop" }, { closed: true, reason: null });
    expect(daily.tradesLine).toBe("Рынок закрыт");
    expect(daily.limitLine).toBe("Дневной стоп — статус к следующей сессии");
  });

  it("follows the UI language", async () => {
    await setLang("en", { source: "init" });
    expect(todayCardModel({ ...base, halted: true, haltedBy: "weekly" }, { closed: true, reason: "weekend" }).limitLine).toBe("Weekly stop — status for the next session");
    await setLang("uz", { source: "init" });
    expect(todayCardModel(base, { closed: true, reason: null }).tradesLine).toBe("Bozor yopiq");
  });
});
