// «Задача дня» as an evening task (Волна 1, item 1.8): the trainer card names the ranked window honestly.
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { dailyCardText, dailyWindowRule } from "./daily-window";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const win = (open: boolean) => ({ from: { date: "2026-10-16", time: "16:00" }, until: { date: "2026-10-19", time: "08:30" }, open });
const base = { played: false, revealed: null, activeGameId: null };

describe("dailyCardText", () => {
  it("open after the close: the hint plus «Рейтинг открыт до пн 08:30 NY»", () => {
    const t = dailyCardText({ ...base, window: win(true) });
    expect(t.open).toBe(true);
    expect(t.window).toMatch(/^Рейтинг открыт до \S+ 08:30 NY/);
  });

  it("closed during the session: when the next one opens, never «утром»", () => {
    const t = dailyCardText({ ...base, revealed: { ticker: "AAA", barsDate: "2026-10-01" }, window: win(false) });
    expect(t.open).toBe(false);
    expect(t.hint).toContain("16:00 NY");
    expect(t.hint).not.toMatch(/утром/);
    expect(t.window).toBeNull();
  });

  it("played → the played hint; a game in progress keeps the card open", () => {
    expect(dailyCardText({ ...base, played: true, window: win(false) }).hint).toMatch(/^Сыграно/);
    expect(dailyCardText({ ...base, activeGameId: 7, window: win(false) }).open).toBe(true);
  });

  it("older server without `window`: closed once revealed without playing", () => {
    expect(dailyCardText({ ...base, revealed: { ticker: "AAA", barsDate: "2026-10-01" } }).open).toBe(false);
    expect(dailyCardText(base).open).toBe(true);
  });

  it("the rule line in EN / UZ", async () => {
    await setLang("en", { source: "init" });
    expect(dailyWindowRule(win(true))).toBe("Ranked play runs after the market close: from 16:00 until 08:30 NY of the next trading day");
    await setLang("uz", { source: "init" });
    expect(dailyWindowRule(win(true))).toContain("16:00");
  });
});
