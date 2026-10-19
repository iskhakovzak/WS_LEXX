import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import {
  applyTemplate, blockDone, docToDraft, draftToDoc, emptyTicker, focusText, isDraftEmpty, prefillFocus, prefillLimits, splitFocus, validateDraft,
} from "./plan-draft";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("plan draft", () => {
  it("round-trips a document", () => {
    const doc = draftToDoc(
      docToDraft({
        marketView: "Гэп вверх",
        focus: "Только A+",
        maxLossUsd: 300,
        maxTrades: 8,
        inPlay: [
          {
            ticker: "nvda",
            catalyst: "отчёт",
            bias: "bull",
            grade: "A",
            horizon: "intraday",
            levels: { support: [121.5], resistance: [125, 127.8] },
            plan: "",
            risk_note: "",
            scenarioA: "пробой 125",
            trigger: "5м над 125",
            invalidation: "под 123.8",
            tvLink: "https://www.tradingview.com/x/AbCd1234/",
            media: [{ id: 7, caption: "дневка" }],
          },
        ],
        media: [{ id: 3, caption: "" }],
        tvLinks: [],
      }),
    );
    expect(doc.inPlay[0]).toMatchObject({ ticker: "NVDA", scenarioA: "пробой 125", trigger: "5м над 125", media: [{ id: 7, caption: "дневка" }] });
    expect(doc.inPlay[0]!.levels.resistance).toEqual([125, 127.8]);
    expect(doc).toMatchObject({ focus: "Только A+", maxLossUsd: 300, maxTrades: 8, media: [{ id: 3, caption: "" }] });
  });

  it("validates tickers, duplicates, levels and limits", () => {
    const d = docToDraft(null);
    d.inPlay = [emptyTicker({ ticker: "AAPL" }), emptyTicker({ ticker: "aapl" }), emptyTicker({ ticker: "" })];
    d.spyS = "abc";
    d.maxTrades = "2.5";
    const e = validateDraft(d);
    expect(e.spyS).toBeTruthy();
    expect(e.maxTrades).toBeTruthy();
    expect(e[`inPlay.${d.inPlay[1]!.key}.ticker`]).toMatch(/уже/);
    expect(e[`inPlay.${d.inPlay[2]!.key}.ticker`]).toBeTruthy();
  });

  it("applies a template without overwriting written blocks", () => {
    const d = docToDraft({ focus: "Моё правило" });
    const next = applyTemplate(d, { focus: "Шаблон", riskNotes: "Red day stop", inPlay: [] });
    expect(next.focus).toBe("Моё правило");
    expect(next.riskNotes).toBe("Red day stop");
    expect(blockDone(next)).toMatchObject({ focus: true, risk: true, tickers: false });
    expect(isDraftEmpty(docToDraft(null))).toBe(true);
  });
});

describe("rule of the day (ownRule)", () => {
  it("keeps never-chosen / none / a mistake apart through the round trip", () => {
    expect("ownRule" in draftToDoc(docToDraft({}))).toBe(false);
    expect(draftToDoc(docToDraft({ ownRule: null })).ownRule).toBeNull();
    expect(draftToDoc(docToDraft({ ownRule: "structure:averaging" })).ownRule).toBe("structure:averaging");
  });

  it("a prefilled rule alone does not make a plan worth a row", () => {
    expect(isDraftEmpty({ ...docToDraft({}), ownRule: "behavior:revenge" })).toBe(true);
    // «Риск — заполнено» needs a real limit (ILYA-12), not the prefilled rule.
    expect(blockDone({ ...docToDraft({}), ownRule: "behavior:revenge" }).risk).toBe(false);
    expect(blockDone({ ...docToDraft({}), maxLoss: "150" }).risk).toBe(true);
  });
});

describe("desk limits prefill (ILYA-12 / ROMAN-06)", () => {
  const roman = { dailyLossLimit: 1200, maxOpenPositions: 8, maxRiskPerTrade: 400 };
  it("an untouched plan starts from the desk limits as real values", () => {
    expect(prefillLimits(docToDraft({}), roman)).toMatchObject({ maxLoss: "1200", maxTrades: "8", riskPerTrade: "400" });
    expect(prefillLimits(docToDraft({}), { dailyLossLimit: 150, maxOpenPositions: null, maxRiskPerTrade: 50 })).toMatchObject({ maxLoss: "150", maxTrades: "", riskPerTrade: "50" });
  });
  it("any limit the trader wrote wins; no limits → nothing changes", () => {
    const own = { ...docToDraft({}), maxLoss: "300" };
    expect(prefillLimits(own, roman)).toBe(own);
    const empty = docToDraft({});
    expect(prefillLimits(empty, null)).toBe(empty);
    expect(prefillLimits(empty, { dailyLossLimit: null, maxOpenPositions: null, maxRiskPerTrade: null })).toBe(empty);
  });
});

describe("own focus prefill (DENIS-03)", () => {
  it("the journal pick fills an empty focus only", () => {
    expect(prefillFocus(docToDraft({}), "Максимум 2 попытки на тикер").focus).toBe("Максимум 2 попытки на тикер");
    expect(prefillFocus(docToDraft({ focus: "Моё" }), "Другое").focus).toBe("Моё");
  });
});

describe("quick rules as preset keys (UMID-13)", () => {
  it("keys round-trip and render in the reader's language", async () => {
    const doc = draftToDoc({ ...docToDraft({}, true), focusRules: ["a"], focus: "Своё" });
    expect(doc).toMatchObject({ focusRules: ["a"], focus: "Своё" });
    expect(focusText(doc)).toBe("Только A+ сетапы; Своё");
    await setLang("en", { source: "init" });
    expect(focusText(doc)).not.toContain("Только");
  });
  it("an old plan with the preset's text in focus gets the key back (same language)", () => {
    expect(splitFocus("Только A+ сетапы; Своё", undefined)).toEqual({ rules: ["a"], text: "Своё" });
    expect(docToDraft({ focus: "Только A+ сетапы" }, true)).toMatchObject({ focus: "", focusRules: ["a"] });
    // The desk plan keeps its text as written.
    expect(docToDraft({ focus: "Только A+ сетапы" })).toMatchObject({ focus: "Только A+ сетапы", focusRules: [] });
  });
});
