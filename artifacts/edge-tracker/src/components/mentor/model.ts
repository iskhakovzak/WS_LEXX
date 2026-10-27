/**
 * «Ментор» view model (pure, no React): a commitment as a sentence, a data fact as a line, the verdict's tone, the
 * dashboard line. Texts come from the `mentor` namespace; slices, regimes, mistakes and stages reuse the shared labels.
 */
import { fmtDate, fmtUsd } from "@/lib/format";
import { mentorI18n } from "@/i18n/ns/mentor";
import { profileI18n } from "@/i18n/ns/profile";
import { sliceLabel } from "@/components/shared/edge-map/model";
import { regimeName } from "@/components/shared/regime/labels";
import { mistakeLabel } from "@/components/shared/mistake-labels";
import { tierDisplay } from "@/components/shared/tier-labels";
import { isRegimeKey } from "@/lib/market-regime";
import type { Tone } from "@/components/ds";
import type { CommitmentKind, Fact, MentorLine, Params, Verdict } from "./api";

const t = (k: string, p?: Record<string, string | number>) => mentorI18n.tryT(k, p) ?? k;
const money = (v: unknown) => fmtUsd(Number(v), { decimals: "auto" });
const perDay = (v: unknown) => fmtUsd(Number(v), { signed: true, decimals: "auto" });

/** «Пауза 10 мин после убытка»; a custom commitment is its own text. */
export function commitmentText(c: { kind: CommitmentKind; params: Params; text: string | null }): string {
  if (c.kind === "custom") return c.text?.trim() || t("commitments.kind.custom");
  const p = c.params;
  return t(`commitments.kind.${c.kind}`, {
    minutes: Number(p.minutes ?? 0), count: Number(p.count ?? 0), usd: money(p.usd ?? 0), time: String(p.time ?? ""),
  });
}

/** A kind as a choice in the add form, with placeholders for its parameter («Пауза N мин после убытка»). */
export function kindLabel(kind: CommitmentKind): string {
  return t(`commitments.kind.${kind}`, { minutes: "N", count: "N", usd: "$N", time: "HH:MM" });
}

export function verdictTone(v: Verdict): Tone {
  return v === "achieved" || v === "on_track" ? "up" : v === "failing" ? "down" : v === "at_risk" ? "warn" : "neutral";
}

const attrName = (k: unknown) => profileI18n.tryT(`attr.${String(k)}.name`) ?? String(k);
const regime = (k: unknown) => (isRegimeKey(k) ? regimeName(k) : String(k ?? ""));

/** One data fact as the trader reads it («Утечка: входы 15:30–16:00 · −$12.40 в день»). */
export function factText(f: Fact): string {
  const p = f.params;
  switch (f.kind) {
    case "stage": return t("memory.fact.stage", { stage: tierDisplay(String(p.stage ?? "")) });
    case "strength": return t("memory.fact.strength", { attr: attrName(p.attr) });
    case "weakness": return t("memory.fact.weakness", { attr: attrName(p.attr) });
    case "leak": return t("memory.fact.leak", { slice: sliceLabel(String(p.slice)), perDay: perDay(p.perDay) });
    case "edge": return t("memory.fact.edge", { slice: sliceLabel(String(p.slice)), perDay: perDay(p.perDay) });
    case "regime": {
      const role = p.role === "leak" || p.role === "strength" ? p.role : "today";
      return t(`memory.fact.regime.${role}`, { regime: regime(p.regime), perDay: perDay(p.perDay) });
    }
    case "agreement":
      return p.dueOn ? t("memory.fact.agreementDue", { title: String(p.title), date: fmtDate(String(p.dueOn), "dayMonth") }) : t("memory.fact.agreement", { title: String(p.title) });
    case "focus":
      return p.own ? t("memory.fact.focusOwn", { text: String(p.own) }) : t("memory.fact.focus", { mistake: mistakeLabel(p.mistake ? String(p.mistake) : null) });
  }
}

/** «Ментор: …» — the one thing for now: today's rule, then the weakest commitment, then the next rhythm step. */
export function lineText(l: MentorLine): string {
  if (l.ruleToday && l.phase !== "post") return t("line.rule", { rule: l.ruleToday });
  if (l.phase === "post" && !l.hasDebrief) return t("line.debrief");
  if (l.commitment && l.commitment.opportunities > 0) {
    return t("line.commitment", { text: commitmentText(l.commitment), kept: l.commitment.kept, total: l.commitment.opportunities });
  }
  if (!l.hasBrief && l.phase === "pre") return t("line.brief");
  if (l.commitment) return commitmentText(l.commitment);
  return t("line.none");
}

/** The rhythm tab the page opens on: the brief before and during the session, the debrief after the close. */
export function defaultTab(phase: "pre" | "session" | "post", weekday: number): "brief" | "debrief" | "weekly" {
  if (phase === "post") return weekday === 5 ? "weekly" : "debrief";
  return "brief";
}

/** The four commitment parameters of a kind (the add form shows only these). */
export const KIND_FIELDS: Record<CommitmentKind, "minutes" | "count" | "usd" | "time" | null> = {
  pause_after_loss: "minutes", max_trades: "count", max_daily_loss: "usd", stop_after_losses: "count",
  no_entry_before: "time", no_entry_after: "time", max_loss_per_trade: "usd", custom: null,
};
