import { describe, expect, it } from "vitest";
import { actionLabel, bandLabel, confidenceText, personHref, recBasis, recTitle, recWhy } from "./recs-model";
import type { OfficeRec } from "./recs-api";

const base = (over: Partial<OfficeRec>): OfficeRec => ({
  id: "leak:time:15:30-16:00", kind: "leak", audience: "desk", priority: 1, confidence: 2,
  params: { slice: "time:15:30-16:00", trades: 1840, share: 0.1, blocks: 3, edgeLeaks: 0 },
  money: null, rel: null, affected: { count: 3, names: [] }, action: null, secondary: null,
  basis: { trades: 1840, days: 118, traders: 30, from: "2026-04-28", to: "2026-10-21", q: 0.018 }, ...over,
});

describe("recommendation texts (RU)", () => {
  it("leak: $ for partners, bps for everyone else, a plain line without either", () => {
    const usd = recWhy(base({ money: { mean: -4.02, lo: -6.1, hi: -1.95, per: "trade" } }))[0];
    expect(usd).toContain("−$4.02");
    expect(usd).toContain("80%");
    const bps = recWhy(base({ rel: { mean: -7.4, lo: -11.2, hi: -3.6, unit: "bps" } }))[0];
    expect(bps).toContain("б.п.");
    expect(bps).not.toContain("$");
    expect(recWhy(base({}))[0]).not.toMatch(/\$|б\.п\./);
    expect(recTitle(base({}))).toBe("Деск теряет: вход 15:30–16:00");
  });

  it("rule: helped of eligible; the share line has no $", () => {
    const r = base({
      id: "rule:afterLoss10", kind: "rule", params: { rule: "afterLoss10", helped: 31, eligible: 42, robust: 14, robustHurt: 2, hurt: 9 },
      rel: { mean: 0.738, lo: 0.64, hi: 0.81, unit: "share" },
    });
    expect(recTitle(r)).toBe("«Пауза 10 минут после убытка» помогло бы 31 из 42 трейдеров");
    expect(recWhy(r)[0]).toContain("74%");
    expect(recWhy(r)[0]).not.toContain("$");
  });

  it("staff facts: titles by sub-kind, «a fact» as the tick hint, the blocker label", () => {
    const att = base({ id: "attention:noReview", kind: "attention", params: { sub: "noReview", days: 14, active: 40, never: 2 }, affected: { count: 9, names: [] } });
    expect(recTitle(att)).toBe("9 без разбора дольше 14 дней");
    expect(confidenceText({ ...att, confidence: 3 }).hint).toContain("Факт");
    const ready = base({ id: "readiness:close", kind: "readiness", params: { sub: "close", tracked: 30, blocker: "consistency", blockerCount: 3 }, affected: { count: 3, names: [] } });
    expect(recWhy(ready, (m) => `<${m}>`)[0]).toContain("<consistency> (3)");
  });

  it("fees, labels and links", () => {
    expect(bandLabel("lt5")).toBe("< $5");
    expect(bandLabel("5-10")).toBe("$5–10");
    expect(bandLabel("gt200")).toBe("> $200");
    const fees = base({ kind: "fees", params: { band: "lt5", feeShareOfDesk: 0.27, grossNonPositive: 0 }, rel: { mean: 1.22, lo: 0.93, hi: 1.8, unit: "share" } });
    expect(recTitle(fees)).toBe("Комиссии съедают бэнд < $5");
    expect(recWhy(fees)[0]).toContain("122%");
    expect(actionLabel({ kind: "whatif", href: "/what-if?r=abc" }, fees)).toBe("Проверить правило в «Что если»");
    expect(actionLabel({ kind: "whatif", href: "/what-if" }, fees)).toBe("Проверить в «Что если»");
    expect(personHref("Synth Trader")).toBe("/curator?trader=Synth+Trader");
    expect(recBasis(base({}))).toContain("q = 0.018");
  });
});
