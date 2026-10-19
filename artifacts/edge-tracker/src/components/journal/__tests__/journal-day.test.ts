// Journal day texts and prefills (persona walkthrough 2026-10-19): the R average says which trades it covers
// (DENIS-12 / ROMAN-25); «Торговал по правилам?» starts as «Нет» when the auto check found violations (DENIS-13).
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { rAverageText } from "../DaySummary";
import { followedAnswer } from "../DayJournalEditor";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const stats = { r: 1.91, rCount: 5, expectancyR: 0.38, wins: 5, losses: 4, be: 0 };

describe("rAverageText", () => {
  it("only some trades have R → the average names its base", () => {
    expect(rAverageText(stats)).toBe("Сумма R +1.91R · +0.38R на сделку с R (5 из 9)");
  });
  it("every trade has R → the plain average", () => {
    expect(rAverageText({ ...stats, rCount: 9, expectancyR: 0.21 })).toBe("Сумма R +1.91R · в среднем +0.21R на сделку");
  });
  it("English", async () => {
    await setLang("en", { source: "init" });
    expect(rAverageText(stats)).toBe("Total R +1.91R · +0.38R per trade with R (5 of 9)");
  });
});

describe("followedAnswer (prefill law)", () => {
  it("unanswered + violations → «Нет»; unanswered without → nothing; a stored answer is kept", () => {
    expect(followedAnswer(null, 2)).toBe(false);
    expect(followedAnswer(null, 0)).toBeNull();
    expect(followedAnswer(true, 2)).toBe(true);
  });
});
