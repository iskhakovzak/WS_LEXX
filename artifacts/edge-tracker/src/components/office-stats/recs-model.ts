/**
 * «Рекомендации офису» view model (pure; recs-model.test.ts): a server recommendation → its title, the why lines with
 * numbers and intervals, the action labels and the confidence wording, in the UI language. $ only when the server
 * sent `money` (partners); everyone else reads the unit-free twin (`rel`) or a plain sentence.
 */
import { fmtNum, fmtRate, fmtUsd } from "@/lib/format";
import { sliceLabel } from "@/components/shared/edge-map/model";
import { commonI18n } from "@/i18n/ns/common";
import { officeRecsI18n } from "@/i18n/ns/officeRecs";
import type { OfficeRec, RecAction } from "./recs-api";
import { isRegimeKey } from "@/lib/market-regime";
import { regimeName } from "@/components/shared/regime/labels";

/** Keys built at runtime (`attention.${sub}`, `confidence.l${n}` …): tryT with the key itself as the last resort. */
const t = (k: string, p?: Record<string, string | number>): string => officeRecsI18n.tryT(k, p) ?? k;

const usd = (v: number) => fmtUsd(v, { signed: true, decimals: Math.abs(v) >= 100 ? 0 : 2 });
const usdAbs = (v: number) => fmtUsd(Math.abs(v), { decimals: Math.abs(v) >= 100 ? 0 : 2 });
const share = (v: number | string | null | undefined) => fmtRate(typeof v === "number" ? v : null, Number(v) < 0.1 ? 1 : 0);
const num = (v: number | string | null | undefined) => (typeof v === "number" ? v : Number(v ?? 0));
const bps = (v: number) => fmtNum(v, { decimals: Math.abs(v) >= 10 ? 0 : 1, signed: true });
const trades = (n: number) => commonI18n.t("units.trades", { count: n });

/** «$5–10», «< $5». */
export function bandLabel(band: string): string {
  if (band.startsWith("lt")) return `< $${band.slice(2)}`;
  if (band.startsWith("gt")) return `> $${band.slice(2)}`;
  return `$${band.replace("-", "–")}`;
}

export function ruleName(key: string): string {
  return officeRecsI18n.tryT(`rule.names.${key}`) ?? key;
}

/** The criterion label of a promotion metric key (academy wording when present; the key otherwise). */
export type BlockerLabel = (metric: string) => string;

export function recTitle(r: OfficeRec): string {
  const p = r.params;
  switch (r.kind) {
    case "leak": return t("leak.title", { slice: lower(sliceLabel(String(p.slice))) });
    case "practice": return t("practice.title", { slice: lower(sliceLabel(String(p.slice))) });
    case "rule": return t("rule.title", { rule: ruleName(String(p.rule)), helped: num(p.helped), eligible: num(p.eligible) });
    case "fees": return t("fees.title", { band: bandLabel(String(p.band)) });
    case "crowding": return t("crowding.title");
    case "attention": {
      const sub = String(p.sub);
      if (sub === "load") return t("attention.load", { count: r.affected.count });
      if (sub === "noCurator") return t("attention.noCurator", { count: r.affected.count });
      return t(`attention.${sub}`, { count: r.affected.count, days: num(p.days) });
    }
    case "readiness": return t(p.sub === "ready" ? "readiness.ready" : "readiness.close", { count: r.affected.count });
    case "regime": return t("regime.title", { regime: isRegimeKey(p.regime) ? regimeName(p.regime) : String(p.regime) });
  }
}

/** Lower-case the first letter of a slice label inside a sentence («Вход 15:30–16:00» → «вход 15:30–16:00»). */
function lower(s: string): string {
  return /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function recWhy(r: OfficeRec, blocker: BlockerLabel = (m) => m): string[] {
  const p = r.params;
  const m = r.money;
  const rel = r.rel;
  switch (r.kind) {
    case "leak": {
      const base = { trades: num(p.trades), share: share(p.share), blocks: num(p.blocks) };
      const lines = [
        m ? t("leak.whyUsd", { ...base, mean: usd(m.mean), lo: usd(m.lo), hi: usd(m.hi) })
          : rel ? t("leak.whyBps", { ...base, mean: bps(rel.mean), lo: bps(rel.lo), hi: bps(rel.hi) })
          : t("leak.whyPlain", base),
      ];
      if (num(p.edgeLeaks) > 0) lines.push(t("leak.edge", { count: num(p.edgeLeaks) }));
      return lines;
    }
    case "rule": {
      if (m) {
        return [t("rule.whyUsd", {
          mean: usdAbs(m.mean), lo: usd(m.lo), hi: usd(m.hi), median: usdAbs(num(p.medianPerDayUsd)),
          robust: num(p.robust), hurt: num(p.hurt),
        })];
      }
      return [t("rule.whyShare", { share: share(rel?.mean), lo: share(rel?.lo), hi: share(rel?.hi), robust: num(p.robust), robustHurt: num(p.robustHurt) })];
    }
    case "fees": {
      const deskShare = share(p.feeShareOfDesk);
      const lines = [num(p.grossNonPositive) || !rel ? t("fees.whyAll", { deskShare }) : t("fees.why", { share: share(rel.mean), lo: share(rel.lo), hi: rel.hi >= 9 ? "∞" : share(rel.hi), deskShare })];
      if (m) lines.push(t("fees.usd", { mean: usd(m.mean), lo: usd(m.lo), hi: usd(m.hi) }));
      return lines;
    }
    case "crowding": {
      const lines = [t("crowding.why", { min: num(p.minTraders), clusters: num(p.clusters), share: share(p.crowdShare) })];
      if (m) lines.push(t("crowding.usd", { mean: usd(m.mean), lo: usd(m.lo), hi: usd(m.hi) }));
      if (p.tickers) lines.push(t("crowding.tickers", { tickers: String(p.tickers) }));
      if (num(p.busyDays) > 0) lines.push(t("crowding.red", { red: num(p.redDays), busy: num(p.busyDays) }));
      return lines;
    }
    case "practice": {
      const restSign = t(num(p.restMeanSign) < 0 ? "practice.minus" : num(p.restMeanSign) > 0 ? "practice.plus" : "practice.flat");
      return [m
        ? t("practice.whyUsd", { top: num(p.topCount), mean: usdAbs(m.mean), lo: usd(m.lo), hi: usd(m.hi), restSign })
        : t("practice.whyPlain", { restSign })];
    }
    case "attention": {
      const sub = String(p.sub);
      if (sub === "load") return [t("attention.loadWhy", { max: num(p.maxWards), median: num(p.medianWards), limit: num(p.limit) })];
      if (sub === "noCurator") return [t("attention.noCuratorWhy")];
      return [t(`attention.${sub}Why`, { active: num(p.active), never: num(p.never) })];
    }
    case "readiness": {
      if (p.sub === "ready") return [t("readiness.readyWhy", { tracked: num(p.tracked) })];
      return [p.blocker ? t("readiness.closeWhy", { tracked: num(p.tracked), blocker: blocker(String(p.blocker)), n: num(p.blockerCount) }) : t("readiness.closeWhyNoBlocker", { tracked: num(p.tracked) })];
    }
    case "regime": {
      const days = commonI18n.t("units.tradingDays", { count: num(p.days) });
      return [m ? t("regime.whyUsd", { mean: usd(m.mean), lo: usd(m.lo), hi: usd(m.hi), days }) : t("regime.whyPlain", { days }), t("regime.action")];
    }
  }
}

/** The small «basis» line: trades · days · q (trade-based kinds) or the active count (facts). */
export function recBasis(r: OfficeRec): string {
  if (r.basis.trades > 0) {
    return t("basis", {
      trades: trades(r.basis.trades), days: commonI18n.t("units.tradingDays", { count: r.basis.days }),
      q: r.basis.q == null ? "—" : r.basis.q < 0.001 ? "<0.001" : r.basis.q.toFixed(3),
    });
  }
  return t("basisFacts", { traders: t("affected", { count: r.basis.traders }) });
}

export function actionLabel(a: RecAction, r: OfficeRec): string {
  if (a.kind === "whatif") return t(a.href.includes("r=") ? "actions.whatifRule" : "actions.whatif");
  if (a.kind === "curator" && a.href.startsWith("/admin")) return t("actions.admin");
  if (a.href.startsWith("/admin")) return t("actions.admin");
  void r;
  return t(`actions.${a.kind}`);
}

/** Facts (staff kinds) get «a fact» as the tick hint; statistical kinds the tier wording. */
export function confidenceText(r: OfficeRec): { label: string; hint: string } {
  const fact = r.kind === "attention" || r.kind === "readiness";
  return { label: t(`confidence.l${r.confidence}`), hint: fact ? t("confidence.fact") : t(`confidence.h${r.confidence}`) };
}

/** `/curator?trader=…` — the trader's card in the curator cabinet (TODO: the /profile page once it lands). */
export function personHref(name: string): string {
  return `/curator?${new URLSearchParams({ trader: name }).toString()}`;
}
