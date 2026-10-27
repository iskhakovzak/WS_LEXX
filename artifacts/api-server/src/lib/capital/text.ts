/**
 * The «почему» of a capital proposal in the reader's language (server ns `capital`). Reasons are stored as data
 * (lib/capital/types CapReason) in scaling_proposals.reasons, so a stored proposal reads in any language. Money and R
 * keep the trading format in every language ($1,234 / +0.21R).
 */
import { capitalT } from "../../i18n/ns";
import type { Lang } from "../../i18n";
import type { CapReason } from "./types";

const MINUS = "−";

export function usd(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = `$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
  if (v < 0 && Math.round(v) !== 0) return `${MINUS}${abs}`;
  return signed && Math.round(v) > 0 ? `+${abs}` : abs;
}

export function rr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = Math.round(v * 100) / 100;
  return `${x > 0 ? "+" : x < 0 ? MINUS : ""}${Math.abs(x).toFixed(2)}R`;
}

export function renderCapitalReason(item: CapReason, lang: Lang = "ru"): string {
  const t = capitalT.tFor(lang);
  switch (item.code) {
    case "edge": {
      const r = item.r;
      const u = item.usd;
      if (r && u) return t("edge.both", { r: rr(r.theta), rLo: rr(r.lo), rHi: rr(r.hi), trades: r.trades, usd: usd(u.theta, true), uLo: usd(u.lo, true), uHi: usd(u.hi, true), days: u.days });
      if (r) return t("edge.rOnly", { r: rr(r.theta), rLo: rr(r.lo), rHi: rr(r.hi), trades: r.trades });
      if (u) return t("edge.usdOnly", { usd: usd(u.theta, true), uLo: usd(u.lo, true), uHi: usd(u.hi, true), days: u.days });
      return t("edge.none");
    }
    case "regime": {
      const regime = capitalT.tryFor(lang, `regime.${item.regime}`) ?? item.regime;
      if (!item.usd) return t("regimeFew", { regime, days: item.days });
      return t("regimeLine", { regime, usd: usd(item.usd.theta, true), lo: usd(item.usd.lo, true), hi: usd(item.usd.hi, true), days: item.days });
    }
    case "noRegime": return t("noRegime");
    case "discipline":
      if (item.score == null) return t("disciplineNone");
      return t("discipline", {
        score: item.score, index: item.index == null ? "—" : `${item.index}/100`, violations: item.violations,
        closed: item.closedPct == null ? "—" : `${item.closedPct}%`, stops: item.stopDays,
      });
    case "achievements": {
      if (item.resetBy) return t("achievementsReset", { day: item.resetBy });
      const names = item.parts.map((p) => capitalT.tryFor(lang, `achievementKind.${p.kind}`) ?? p.kind);
      return t("achievements", { value: Math.round(item.value * 100), list: [...new Set(names)].join(", ") });
    }
    case "verdict": {
      const bp = item.fromBp != null && item.toBp != null && item.toBp !== item.fromBp ? `; ${t("verdict.bp", { from: usd(item.fromBp), to: usd(item.toBp) })}` : "";
      if (item.direction === "keep") return item.fromDaily == null ? t("verdict.keepNone") : t("verdict.keep", { from: usd(item.fromDaily) });
      return t(item.direction === "raise" ? "verdict.raise" : "verdict.cut", { pct: Math.abs(item.pct), from: usd(item.fromDaily), to: usd(item.toDaily) }) + bp;
    }
    case "gate": {
      if (item.gate === "ladder") return t(item.action === "demote" ? "gate.ladderDemote" : "gate.ladderPromote");
      const money = item.gate === "atCap" || item.gate === "atFloor";
      return capitalT.tryFor(lang, `gate.${item.gate}`, {
        value: item.value ?? "—",
        limit: money ? usd(item.limit ?? null) : (item.limit ?? "—"),
      }) ?? item.gate;
    }
  }
}

/** Stored reasons (scaling_proposals.reasons of kind 'limits') → texts; the verdict line first, then the evidence. */
export function renderCapitalReasons(raw: unknown, lang: Lang = "ru"): string[] {
  if (!Array.isArray(raw)) return [];
  const items = raw.filter((x): x is CapReason => !!x && typeof x === "object" && typeof (x as { code?: unknown }).code === "string");
  const verdict = items.filter((x) => x.code === "verdict");
  const rest = items.filter((x) => x.code !== "verdict");
  return [...verdict, ...rest].map((x) => renderCapitalReason(x, lang));
}
