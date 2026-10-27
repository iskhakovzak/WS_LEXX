import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { PICKABLE_MISTAKES, mistakeLabel, mistakeRule, parseMistake } from "@/components/shared/mistake-labels";
import {
  contractDate, contractLine, contractOverall, criterionValue, dayView, eveningRewards, fmtDelta, fmtMetric, fmtTarget, metricLabel, planContract, tierTitle,
} from "../daily-model";
import { contractBroken, eveningBroken, focusAuto, focusNone, me, progress } from "./fixtures";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("dayView — one focal point per phase", () => {
  it("premarket: the focus leads; an unreviewed yesterday is offered as a compact row", () => {
    const v = dayView(me())!;
    expect(v.primary).toBe("focus");
    expect(v.pendingEvening).toBe(true);
    expect(v.evening?.date).toBe("2026-10-16");
  });

  it("premarket after the review: no pending row", () => {
    const v = dayView(me({ evening: { ...eveningBroken, reviewed: true } }))!;
    expect(v.primary).toBe("focus");
    expect(v.pendingEvening).toBe(false);
  });

  it("after the close and on weekends the evening card leads", () => {
    expect(dayView(me({ phase: "afterclose" }))!.primary).toBe("evening");
    expect(dayView(me({ phase: "weekend" }))!.primary).toBe("evening");
  });

  it("a day without trades has no evening card", () => {
    const v = dayView(me({ phase: "afterclose", evening: { ...eveningBroken, trades: 0 } }))!;
    expect(v.primary).toBe("focus");
    expect(v.evening).toBeNull();
    expect(v.pendingEvening).toBe(false);
  });

  it("nothing to show → null", () => {
    expect(dayView(null)).toBeNull();
    expect(dayView(me({ focus: null, evening: null }))).toBeNull();
  });
});

describe("contract line — prefill law", () => {
  it("a rule never chosen is prefilled with the focus", () => {
    const l = contractLine({ maxLossUsd: 300, maxTrades: 10, ownRule: undefined }, focusAuto);
    expect(l).toMatchObject({ maxLossUsd: 300, maxTrades: 10, rule: "structure:averaging", ruleFromFocus: true, empty: false });
  });

  it("an explicit «no rule» is respected; no plan + no focus = empty", () => {
    expect(contractLine({ maxLossUsd: null, maxTrades: null, ownRule: null }, focusAuto)).toMatchObject({ rule: null, empty: true });
    expect(contractLine(null, focusNone)).toMatchObject({ rule: null, empty: true, ruleFromFocus: false });
  });

  it("no plan yet still shows the focus as the suggested rule", () => {
    expect(contractLine(null, focusAuto)).toMatchObject({ rule: "structure:averaging", ruleFromFocus: true, empty: false });
  });

  it("reads the plan doc defensively", () => {
    expect(planContract({ plan: { doc: { maxLossUsd: 250, maxTrades: "x", ownRule: "behavior:revenge" } } })).toEqual({
      maxLossUsd: 250,
      maxTrades: null,
      ownRule: "behavior:revenge",
    });
    expect(planContract({ plan: { doc: { ownRule: null } } })?.ownRule).toBeNull();
    expect(planContract({ plan: { doc: {} } })?.ownRule).toBeUndefined();
    expect(planContract({ plan: null })).toBeNull();
  });
});

describe("verdicts and numbers", () => {
  it("one word for the whole contract", () => {
    expect(contractOverall(contractBroken)).toBe("broken");
    expect(contractOverall({ ...contractBroken, maxTrades: { ...contractBroken.maxTrades, status: "kept" }, rule: { mistake: null, status: "unset" } })).toBe("kept");
    expect(contractOverall({ ...contractBroken, maxLoss: { limit: null, actual: null, status: "unset" }, maxTrades: { limit: null, actual: 0, status: "unset" }, rule: { mistake: null, status: "unset" } })).toBe("unset");
    expect(contractOverall(null)).toBe("unset");
  });

  it("discipline delta keeps a real minus", () => {
    expect(fmtDelta(3)).toBe("+3");
    expect(fmtDelta(-2)).toBe("−2");
    expect(fmtDelta(0)).toBe("0");
  });

  it("criteria values follow the metric unit", () => {
    expect(fmtMetric("net_pnl", 1500)).toBe("$1,500");
    expect(fmtMetric("profit_factor", 1.3)).toBe("1.30");
    expect(fmtMetric("max_dd_pct", 42.4)).toBe("42%");
    expect(fmtMetric("trades", 40)).toBe("40");
    expect(fmtMetric("trades", null)).toBe("—");
    expect(fmtTarget("trades", 40)).toBe("≥ 40");
    expect(fmtTarget("limit_breaches", 0)).toBe("≤ 0");
  });
});

describe("tier title in three languages", () => {
  it("«До Джуна: 3 из 5» / «To Junior: 3 of 5» / Uzbek", async () => {
    expect(tierTitle(progress)).toBe("До Джуна: 3 из 5");
    await setLang("en", { source: "init" });
    expect(tierTitle(progress)).toBe("To Junior: 3 of 5");
    await setLang("uz", { source: "init" });
    expect(tierTitle(progress)).toBe("Juniorgacha: 3/5");
  });

  it("top tier and custom tiers", async () => {
    await setLang("en", { source: "init" });
    expect(tierTitle({ ...progress, tier: "senior", nextTier: null })).toBe("“Senior” is the top level");
    expect(tierTitle({ ...progress, nextTier: "Pro" })).toBe("To “Pro”: 3 of 5");
    expect(tierTitle({ ...progress, tier: null, nextTier: null })).toBeNull();
  });

  it("the ladder ends at Сеньор: a risk tier above it is the top, never a raw key (ROMAN-07)", () => {
    expect(tierTitle({ ...progress, tier: "senior", nextTier: "lead" })).toBe("Уровень «Сеньор» — высший");
  });
});

describe("academy-path criteria on the ladder chip (ILYA-04)", () => {
  const item = { metric: "trading_days", label: { key: "path.metric.trading_days" }, actual: 16, target: 15, ok: true, text: "15 из 20 торговых дней", display: "16", targetDisplay: "≥ 15" };
  it("the path's own label and «value · цель target» strings", () => {
    expect(metricLabel(item)).toBe("15 из 20 торговых дней");
    expect(criterionValue(item)).toBe("16 · цель ≥ 15");
  });
  it("no trades in the window → «нет данных», not a pass", () => {
    expect(criterionValue({ ...item, ok: false, actual: null, noData: true })).toBe("нет данных");
  });
  it("older servers (numbers only) keep the metric formatting", () => {
    expect(criterionValue({ metric: "net_pnl", label: { key: "x" }, actual: 120, target: 750, ok: false })).toBe(`${fmtMetric("net_pnl", 120)} · цель ${fmtTarget("net_pnl", 750)}`);
  });
});

describe("contractDate — the contract is for the next session (UMID-06)", () => {
  it("weekend → the focus date (Monday); a trading day → today", () => {
    expect(contractDate({ today: "2026-10-18", focus: { ...focusAuto, date: "2026-10-19" } })).toBe("2026-10-19");
    expect(contractDate({ today: "2026-10-16", focus: { ...focusAuto, date: "2026-10-16" } })).toBe("2026-10-16");
    expect(contractDate({ today: "2026-10-16", focus: null })).toBe("2026-10-16");
  });
});

describe("mistake dictionary covers every MistakeId", () => {
  const ruleKinds = ["max_trades_per_day", "no_averaging_down", "trading_window", "self_check"];
  for (const lang of ["ru", "en", "uz"] as const) {
    it(`${lang}: every pickable mistake and rule kind has a label and a rule phrase`, async () => {
      await setLang(lang, { source: "init" });
      for (const { id } of PICKABLE_MISTAKES) {
        expect(mistakeLabel(id)).not.toMatch(/mistake\.|:/);
        expect(mistakeRule(id)).not.toMatch(/avoid\.|:/);
      }
      for (const k of ruleKinds) expect(mistakeLabel(`rule:${k}`)).not.toContain(k);
    });
  }

  it("unknown ids stay readable, groups parse", () => {
    expect(mistakeLabel("rule:brand_new_kind")).toContain("brand_new_kind");
    expect(mistakeLabel("weird")).toContain("weird");
    expect(parseMistake("behavior:revenge")).toEqual({ group: "behavior", key: "revenge" });
    expect(PICKABLE_MISTAKES).toHaveLength(14);
  });
});

describe("eveningRewards — the Telegram rewards line on the web card", () => {
  const card = (rewards: Parameters<typeof eveningRewards>[0]["rewards"]) => ({ rewards });

  it("nothing new (or an older server): no line", () => {
    expect(eveningRewards(card(undefined))).toBeNull();
    expect(eveningRewards(card(null))).toBeNull();
    expect(eveningRewards(card({ streak: 4, badges: [] }))).toBeNull();
    expect(eveningRewards(card({ streak: 4, badges: [], achievements: [], questsDone: 0 }))).toBeNull();
  });

  it("achievement tiers lead, the quests done that day follow", () => {
    const line = eveningRewards(card({ streak: 3, badges: [{ id: "streak_1", target: 3 }], achievements: [{ line: "contract_streak", tier: "bronze", target: 3 }], questsDone: 2 }));
    expect(line?.text).toBe("Новое достижение: Серия контракта (Бронза) · 2 квеста выполнено");
    expect(line?.quests).toBe(2);
  });

  it("badges when no achievement tier is known; unknown lines are skipped", () => {
    const line = eveningRewards(card({ streak: 5, badges: [{ id: "streak_1", target: 5 }], achievements: [{ line: "nope", tier: "gold", target: 1 }] }));
    expect(line?.text).toBe("Новая награда: Контракт 5 дней подряд");
  });

  it("quests alone, with plural forms in every language", async () => {
    expect(eveningRewards(card({ streak: 0, badges: [], questsDone: 1 }))?.text).toBe("Выполнен 1 квест");
    expect(eveningRewards(card({ streak: 0, badges: [], questsDone: 5 }))?.text).toBe("Выполнено 5 квестов");
    await setLang("en", { source: "init" });
    expect(eveningRewards(card({ streak: 0, badges: [], questsDone: 2 }))?.text).toBe("2 quests done");
    await setLang("uz", { source: "init" });
    expect(eveningRewards(card({ streak: 0, badges: [], achievements: [{ line: "reviews_total", tier: "silver", target: 20 }], questsDone: 1 }))?.text)
      .toBe("Yangi yutuq: Tahlil qilingan kunlar (Kumush) · 1 ta kvest bajarildi");
  });
});
