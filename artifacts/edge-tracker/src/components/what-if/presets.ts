/**
 * «Вопросы» of the simulator: one click = one ready rule («а если бы я не торговал после 3 убытков?»), plus the
 * pure helpers behind them (worst setups, the days a scenario changed). No React, no fetch. Commission tariffs are
 * not offered: the desk does not choose its broker fees (owner 2026-10-22).
 * A question that the data cannot answer (no setups / grades marked) is returned disabled with the reason.
 */
import { type PreviewTrade, type Rule, gradeRank, netOf } from "./rules";
import { fmtUsd } from "@/lib/format";
import { whatIfI18n } from "@/i18n/ns/whatIf";

export type Question = {
  id: "after3" | "worstSetups" | "aplus" | "dayLimit";
  label: string;
  /** Short explanation under the chip / in the tooltip. */
  hint: string;
  rule: Rule | null;
  /** Why the question cannot be asked of this data (chip disabled), or null. */
  disabled: string | null;
};

type PresetLike = { id: string; label: string; rules: Rule[] };

/** Losing setups with at least `minTrades` trades, worst (most negative net) first. */
export function worstSetups(trades: PreviewTrade[], minTrades = 5, limit = 2): { name: string; net: number; n: number }[] {
  const by = new Map<string, { name: string; net: number; n: number }>();
  for (const t of trades) {
    const net = netOf(t);
    const s = t.setup?.trim();
    if (net == null || !s) continue;
    const k = s.toLowerCase();
    const e = by.get(k) ?? { name: s, net: 0, n: 0 };
    e.net += net; e.n++;
    by.set(k, e);
  }
  return [...by.values()].filter((e) => e.n >= minTrades && e.net < 0).sort((a, b) => a.net - b.net).slice(0, limit)
    .map((e) => ({ ...e, net: Math.round(e.net * 100) / 100 }));
}

/** Median of the trader's losing days, rounded to a «nice» number (for «а если бы я стопил день на …»). */
export function typicalDayLoss(trades: PreviewTrade[]): number | null {
  const byDay = new Map<string, number>();
  for (const t of trades) { const n = netOf(t); if (n != null) byDay.set(t.day, (byDay.get(t.day) ?? 0) + n); }
  const losses = [...byDay.values()].filter((v) => v < 0).map(Math.abs).sort((a, b) => a - b);
  if (losses.length < 3) return null;
  const m = losses[Math.floor((losses.length - 1) / 2)];
  const nice = m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50;
  return nice > 0 ? nice : null;
}

/**
 * The question chips for these trades (always the same five, some disabled with a reason). `dailyLossLimit` = the
 * trader's own daily stop from the risk settings: the day-stop question uses it instead of a typical losing day
 * (DENIS-36: «Стоп дня на −$50» against a $300 limit).
 */
export function buildQuestions(trades: PreviewTrade[], presets: PresetLike[], limits: { dailyLossLimit?: number | null } = {}): Question[] {
  const t = whatIfI18n.t;
  const qs: Question[] = [];
  qs.push({ id: "after3", label: t("questions.after3.label"), hint: t("questions.after3.hint"), rule: { type: "stopAfterLosses", n: 3 }, disabled: null });

  const own = limits.dailyLossLimit != null && limits.dailyLossLimit > 0 ? Math.round(limits.dailyLossLimit) : null;
  const dl = own ?? typicalDayLoss(trades);
  qs.push({
    id: "dayLimit", label: dl ? t("questions.dayLimit.label", { amount: fmtUsd(dl, { decimals: 0 }) }) : t("questions.dayLimit.labelBare"),
    hint: own ? t("questions.dayLimit.hintLimit") : dl ? t("questions.dayLimit.hint") : "",
    rule: dl ? { type: "dailyLossLimit", usd: dl } : null, disabled: dl ? null : t("questions.dayLimit.disabled"),
  });

  const hasSetups = trades.some((tr) => tr.setup?.trim());
  const worst = worstSetups(trades);
  qs.push({
    id: "worstSetups",
    label: worst.length ? t("questions.worstSetups.label", { setups: worst.map((w) => w.name).join(", ") }) : t("questions.worstSetups.labelBare"),
    hint: worst.length ? t("questions.worstSetups.hint", { list: worst.map((w) => `${w.name} ${fmtUsd(w.net, { decimals: 0 })}`).join(", ") }) : "",
    rule: worst.length ? { type: "excludeSetups", setups: worst.map((w) => w.name) } : null,
    disabled: worst.length ? null : hasSetups ? t("questions.worstSetups.noLosing") : t("questions.worstSetups.noSetups"),
  });

  const graded = trades.some((tr) => gradeRank(tr.grade) != null);
  qs.push({ id: "aplus", label: t("questions.aplus.label"), hint: t("questions.aplus.hint"), rule: graded ? { type: "minGrade", grade: "A+" } : null, disabled: graded ? null : t("questions.aplus.disabled") });

  return qs;

}

/** Server presets with the day stop replaced by the trader's own limit (when known) — presets follow the limits. */
export function presetsWithLimits<P extends PresetLike>(presets: P[], limits: { dailyLossLimit?: number | null }): P[] {
  const usd = limits.dailyLossLimit != null && limits.dailyLossLimit > 0 ? Math.round(limits.dailyLossLimit) : null;
  if (usd == null) return presets;
  return presets.map((p) => ({ ...p, rules: p.rules.map((r) => (r.type === "dailyLossLimit" ? { ...r, usd } : r)) }));
}

export type DayChange = { day: string; before: number; after: number; delta: number; removed: boolean };

/** Days whose net the scenario changed, biggest change first. A day with no scenario trades is «removed». */
export function changedDays(base: { day: string; net: number }[], scenario: { day: string; net: number }[], limit = 8): DayChange[] {
  const sc = new Map(scenario.map((d) => [d.day, d.net]));
  const out: DayChange[] = [];
  for (const d of base) {
    const after = sc.get(d.day) ?? 0;
    const delta = Math.round((after - d.net) * 100) / 100;
    if (Math.abs(delta) < 0.005) continue;
    out.push({ day: d.day, before: d.net, after, delta, removed: !sc.has(d.day) });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.day.localeCompare(b.day)).slice(0, limit);
}
