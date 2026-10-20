/**
 * Волна 2, cluster R — pure parts: stage rule templates (2.6) and their sync with migration 0235, the one errors
 * vocabulary (2.8) and its sync with the migration, the examples pick (2.6), the plan overlay (2.12).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAGE_RULE_TEMPLATES, parseRuleStage, ruleStartFor, shownRuleName, stageRuleApplies } from "../rulesTemplates";
import { ERROR_VOCAB, bulkTags, codesOf, diffCodes, errorCodeOf, vocabSpellings, withCode } from "../tradingErrors";
import { compareCandidates, isWinner, pickExamples, tierFor, type ExampleCandidate } from "../playbook/examplesSeed";
import { levelsFromInPlay, pickOverlay } from "../chartPlanOverlay";
import { validateThreshold, kindMeta } from "../rulesCatalog";

const here = path.dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(path.join(here, "../../db/migrations/0235_stage_rules_one_errors_store_ticker_drawings.sql"), "utf8");

describe("2.6 stage rule templates", () => {
  it("the migration seeds exactly STAGE_RULE_TEMPLATES (key, stage, kind, threshold)", () => {
    const re = /\('((?:junior|trader|senior)\.[a-z_]+)',\s*'(\w+)',\s*'(\w+)',\s*'(\{[^']*\})',\s*'([^']+)'\)/g;
    const seeded = [...SQL.matchAll(re)].map((m) => ({ key: m[1], stage: m[2], kind: m[3], threshold: JSON.parse(m[4]!) }));
    expect(seeded).toEqual(STAGE_RULE_TEMPLATES.map((t) => ({ key: t.key, stage: t.stage, kind: t.kind, threshold: t.threshold })));
    // every seeded name is the RU dictionary name (so the API can show it in the reader's language)
    for (const m of SQL.matchAll(re)) expect(shownRuleName(m[5]!, m[1], "en")).not.toBe(m[5]);
  });

  it("every template is a valid rule of the catalog", () => {
    for (const t of STAGE_RULE_TEMPLATES) {
      expect(kindMeta(t.kind)).toBeTruthy();
      expect(validateThreshold(t.kind, t.threshold, "ru").ok).toBe(true);
    }
    expect(STAGE_RULE_TEMPLATES.filter((t) => t.stage === "junior").map((t) => t.kind)).toEqual(
      ["max_daily_loss_usd", "max_trades_per_day", "no_size_up_after_loss", "no_trade_after_n_losses", "no_overnight"],
    );
  });

  it("a stage rule applies only to its stage; an untagged desk rule to everyone", () => {
    expect(stageRuleApplies(null, "junior")).toBe(true);
    expect(stageRuleApplies(null, null)).toBe(true);
    expect(stageRuleApplies("junior", "junior")).toBe(true);
    expect(stageRuleApplies("junior", "trader")).toBe(false);
    expect(stageRuleApplies("trader", null)).toBe(false);
  });

  it("a stage rule counts from the later of its creation day and the stage day", () => {
    expect(ruleStartFor("2026-10-20", "trader", "2026-11-02")).toBe("2026-11-02");
    expect(ruleStartFor("2026-10-20", "trader", "2026-09-01")).toBe("2026-10-20");
    expect(ruleStartFor("2026-10-20", null, "2026-11-02")).toBe("2026-10-20");
    expect(ruleStartFor("2026-10-20", "junior", null)).toBe("2026-10-20");
    expect(ruleStartFor(null, "junior", "2026-11-02")).toBe("2026-11-02");
  });

  it("names: the seeded one in the reader's language until renamed", () => {
    expect(shownRuleName("Без овернайта", "junior.no_overnight", "en")).toBe("No overnight");
    expect(shownRuleName("Без овернайта", "junior.no_overnight", "uz")).toBe("Overnaytsiz");
    expect(shownRuleName("Мой стоп", "junior.no_overnight", "en")).toBe("Мой стоп");
    expect(shownRuleName("Мой стоп", null, "en")).toBe("Мой стоп");
  });

  it("request stage values", () => {
    expect(parseRuleStage(undefined)).toBeUndefined();
    expect(parseRuleStage(null)).toBeNull();
    expect(parseRuleStage("all")).toBeNull();
    expect(parseRuleStage("junior")).toBe("junior");
    expect(parseRuleStage("trainee")).toBe("invalid");
  });
});

describe("2.8 one errors vocabulary", () => {
  it("migration 0235 lists the same spellings → codes as ERROR_VOCAB", () => {
    const rows = [...SQL.matchAll(/\('([^']+)',\s*'(\w+)',\s*'([^']+)',\s*'(low|medium|high|critical)'\)/g)];
    const fromSql = new Map(rows.map((m) => [m[1]!.toLowerCase(), m[2]!]));
    expect(new Map(vocabSpellings())).toEqual(fromSql);
    for (const m of rows) {
      const v = ERROR_VOCAB.find((x) => x.code === m[2])!;
      expect([m[3], m[4]]).toEqual([v.canonical, v.severity]);
    }
  });

  it("the old M / journal words and the «Ошибки» categories are one code", () => {
    expect(errorCodeOf("FOMO")).toBe("fomo");
    expect(errorCodeOf(" fomo / погоня ")).toBe("fomo");
    expect(errorCodeOf("Реванш")).toBe("revenge");
    expect(errorCodeOf("Отыгрыш после убытка")).toBe("revenge");
    expect(errorCodeOf("Двигал стоп")).toBe("movedStop");
    expect(errorCodeOf("Спокойствие")).toBeNull();
    expect([...codesOf("FOMO, Спокойствие, Реванш, fomo")]).toEqual(["fomo", "revenge"]);
  });

  it("diff and mirror helpers", () => {
    expect(diffCodes(["fomo", "revenge"], ["revenge", "oversize"])).toEqual({ added: ["oversize"], removed: ["fomo"] });
    expect(withCode(["FOMO", "Тильт"], "fomo", true)).toEqual(["FOMO", "Тильт"]);
    expect(withCode(["Тильт"], "fomo", true)).toEqual(["Тильт", "FOMO / погоня"]);
    expect(withCode(["FOMO", "Тильт", "fomo / погоня"], "fomo", false)).toEqual(["Тильт"]);
  });

  it("bulk add / remove tags: a mistake matches any spelling", () => {
    expect(bulkTags(["FOMO", "Тильт"], ["FOMO / погоня", "x"], "addTags")).toEqual(["FOMO", "Тильт", "x"]);
    expect(bulkTags(["FOMO", "Тильт", "X"], ["FOMO / погоня", "x"], "removeTags")).toEqual(["Тильт"]);
  });
});

describe("2.6 examples pick", () => {
  const c = (o: Partial<ExampleCandidate>): ExampleCandidate => ({ tradeId: 1, setupId: 10, trader: "A", day: "2026-10-01", grade: null, r: null, net: 50, ...o });

  it("winners only; best by grade, then R, then $", () => {
    expect(isWinner({ r: null, net: -1 })).toBe(false);
    expect(isWinner({ r: 1.2, net: null })).toBe(true);
    const list = [c({ tradeId: 1, grade: "B", r: 3 }), c({ tradeId: 2, grade: "A", r: 1 }), c({ tradeId: 3, grade: "A", r: 2 })].sort(compareCandidates);
    expect(list.map((x) => x.tradeId)).toEqual([3, 2, 1]);
    expect(tierFor({ grade: "A", r: null })).toBe(1);
    expect(tierFor({ grade: "B", r: 2.5 })).toBe(1);
    expect(tierFor({ grade: "B", r: 1 })).toBe(2);
  });

  it("fills a setup up to perSetup, one per trader-day, skipping excluded and already-full setups", () => {
    const cands = [
      c({ tradeId: 1, grade: "A+", day: "2026-10-01" }),
      c({ tradeId: 2, grade: "A", day: "2026-10-01" }), // same trader-day as 1
      c({ tradeId: 3, grade: "B", day: "2026-10-02" }),
      c({ tradeId: 4, grade: "C", day: "2026-10-03" }),
      c({ tradeId: 5, grade: "A", day: "2026-10-04", net: -5 }), // loser
      c({ tradeId: 6, grade: "A", day: "2026-10-05", setupId: 11 }),
      c({ tradeId: 7, grade: "A", day: "2026-10-06", setupId: 12 }),
    ];
    const picks = pickExamples(cands, new Map([[11, 0], [12, 3]]), new Set(["11:6"]), 3);
    expect(picks).toEqual([
      { tradeId: 1, setupId: 10, tier: 1 }, { tradeId: 3, setupId: 10, tier: 2 }, { tradeId: 4, setupId: 10, tier: 2 },
    ]);
    // idempotent: with those added, nothing more
    expect(pickExamples(cands, new Map([[10, 3], [11, 0], [12, 3]]), new Set(["10:1", "10:3", "10:4", "11:6"]), 3)).toEqual([]);
  });
});

describe("2.12 plan overlay", () => {
  const doc = { inPlay: [{ ticker: "aapl", levels: { support: [180.5, "179"], resistance: [185, 185, -1, "x"] } }] };
  it("levels of the ticker from «В игре»; own plan first, then the desk plan", () => {
    expect(levelsFromInPlay(doc.inPlay, "AAPL")).toEqual([
      { price: 180.5, kind: "support" }, { price: 179, kind: "support" }, { price: 185, kind: "resistance" },
    ]);
    expect(levelsFromInPlay(doc.inPlay, "MSFT")).toBeNull();
    expect(pickOverlay("AAPL", doc, [{ ticker: "AAPL", levels: { support: [1] } }]).source).toBe("own");
    expect(pickOverlay("MSFT", doc, [{ ticker: "MSFT", levels: { support: [300] } }])).toEqual({ source: "desk", levels: [{ price: 300, kind: "support" }] });
    expect(pickOverlay("TSLA", null, null)).toEqual({ source: null, levels: [] });
  });
});
