import { afterAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { tierDescription, tierLabel, traderLadder } from "./format";

const SEED = [
  { key: "trainee", name: "Стажёр", description: "Симулятор / минимальный размер" },
  { key: "junior", name: "Джун", description: "Интрадей, малый лот" },
  { key: "trader", name: "Трейдер", description: "Интрадей + овернайт" },
  { key: "senior", name: "Сеньор", description: "Полный BP, свинг" },
  { key: "lead", name: "Лид", description: "Максимальный BP, менторство" },
];

describe("scaling tier texts (UMID-04, MAKSIM-28)", () => {
  afterAll(async () => { await setLang("ru"); });

  it("seeded tier names and descriptions follow the UI language, «Лид» included", async () => {
    await setLang("en");
    expect(SEED.map((t) => tierLabel(t))).toEqual(["Intern", "Junior", "Trader", "Senior", "Lead"]);
    expect(tierDescription(SEED[2])).toBe("Intraday + overnight");
    for (const t of SEED) expect(`${tierLabel(t)} ${tierDescription(t)}`).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("a tier the admin renamed or described keeps its own words", async () => {
    await setLang("en");
    expect(tierLabel({ key: "junior", name: "Новичок" })).toBe("Новичок");
    expect(tierDescription({ key: "junior", description: "Свой текст" })).toBe("Свой текст");
    expect(tierDescription({ key: "junior", description: null })).toBeNull();
  });

  it("the trader ladder ends at Сеньор unless the person is already a Лид", () => {
    expect(traderLadder(SEED, "trader").map((t) => t.key)).toEqual(["trainee", "junior", "trader", "senior"]);
    expect(traderLadder(SEED, "lead")).toHaveLength(5);
    expect(traderLadder(SEED, null)).toHaveLength(4);
  });
});
