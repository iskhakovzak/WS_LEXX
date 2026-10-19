/**
 * Playbook relink — PURE mapping (no I/O), used by the one-time tool src/db/tools/playbook-relink.ts and unit-tested.
 *
 * Owner 2026-10-18: the old office playbook (~145 setups) was soft-deleted and replaced by 16 numbered office setups
 * (0.1 … 5.2). ~44k trades still point at the old setups. This maps an OLD label (the old setup's name, else the free
 * text on the trade, else the old setup's first tag; auto-classifier class names are labels too) to a NEW setup code,
 * conservatively:
 *   1. a label that names a family the new playbook does not have (OPG / IMBX auctions, MOC fade / pin, tape reading,
 *      options, swing, macro events, squeezes, low float …) is never mapped (EXCLUDE);
 *   2. otherwise the first RULE whose phrase the label contains gives the code (rules are ordered: «Failed Follow
 *      Through — Bear Flag» is a failed breakout, not a flag; «VWAP Reclaim — Mean Reversion» is a reclaim);
 *   3. the trade's entry time (NY) must fall inside the new setup's window (± tolerance): an «ORB» entered at 15:00 is
 *      not an opening-range trade and stays unlinked.
 * Anything else stays unlinked; the report lists it.
 */

export type RelinkOldSetup = { id: number; name: string; tags: string | null };
export type RelinkNewSetup = { id: number; code: string; name: string; timeOfDay: string | null };
/** One trade as it was in the backup: its old link and label, plus the entry minute (NY, from midnight) from the DB. */
export type RelinkTrade = { id: number; playbookId: number | null; setup: string | null; entryMin: number | null };

/** Families the new playbook has no setup for — never mapped, whatever else the label says. */
const EXCLUDE: readonly string[] = [
  "opg", "imbx", "imbalance (imbx)", "moc fade", "pin risk", "пин к страйку", "options", "опцион", "коллы", "tape reading", // i18n-ignore (stored setup labels)
  "скальп", "scalp", "dark pool", "level 2", "swing", "свинг", "overnight", "pead", "earnings whisper", "straddle", // i18n-ignore (stored setup labels)
  "range anticipation", "fomc", "fed day", "cpi", "jobs report", "short squeeze", "low float", "exhaustion",
  "news fade", "pairs trade", "fibonacci", "moving average", "ipo", "halt", "sympathy", "chasing", "low rvol",
  "position sizing", "max loss", "pyramiding", "scaling out", "checklist", "after hours", "премаркет", // i18n-ignore (stored setup labels)
];

/** Ordered: the first rule whose phrase occurs in the label wins (lower-case substring match). */
export const RELINK_RULES: readonly { code: string; phrases: readonly string[] }[] = [
  { code: "3.2", phrases: ["failed follow", "failed breakout", "breakout failure", "hod failure", "ложный пробой", "false breakout", "gap and trap"] }, // i18n-ignore (stored setup labels)
  { code: "3.3", phrases: ["parabol", "парабол", "шорт отката от хая", "backside"] }, // i18n-ignore (stored setup labels)
  { code: "1.4", phrases: ["red to green", "red-to-green", "green to red", "green-to-red"] },
  { code: "1.3", phrases: ["opening range", "orb пробой", "orb 5", "(orb)", "orb "] }, // i18n-ignore (stored setup labels)
  { code: "1.2", phrases: ["opening drive", "momentum открытия"] }, // i18n-ignore (stored setup labels)
  { code: "1.1", phrases: ["gap and go", "gap & go", "продолжение гэпа", "пробой pmh", "пробой pml"] }, // i18n-ignore (stored setup labels)
  { code: "1.5", phrases: ["first pullback", "первый откат"] }, // i18n-ignore (stored setup labels)
  { code: "4.1", phrases: ["second day", "day 2", "2nd day", "второй день"] }, // i18n-ignore (stored setup labels)
  { code: "4.2", phrases: ["gap fill", "fade гэпа", "gap fade"] }, // i18n-ignore (stored setup labels)
  { code: "2.1", phrases: ["vwap reclaim", "vwap hold", "vwap trend", "vwap bounce", "vwap rejection", "отскок от vwap", "откат к vwap"] }, // i18n-ignore (stored setup labels)
  { code: "3.1", phrases: ["mean reversion", "rubber band", "возврат к vwap", "vwap fade"] }, // i18n-ignore (stored setup labels)
  { code: "2.2", phrases: ["bull flag", "bear flag", "flag pattern", "флаг"] }, // i18n-ignore (stored setup labels)
  { code: "2.3", phrases: ["high of day", "hod break", "пробой hod", "пробой lod"] }, // i18n-ignore (stored setup labels)
  { code: "5.1", phrases: ["power hour"] },
  { code: "5.2", phrases: ["moc imbalance", "moc-имбаланс", "market on close", "игра на закрытие", "closing auction"] }, // i18n-ignore (stored setup labels)
];

const norm = (s: string | null | undefined) => ` ${(s ?? "").toLowerCase().replace(/\s+/g, " ").trim()} `;

/** Does the label name a family the office playbook has no setup for (OPG / IMBX auctions, MOC fade, options …)? */
export function isExcludedLabel(label: string | null | undefined): boolean {
  const l = norm(label);
  return l.trim().length >= 3 && EXCLUDE.some((x) => l.includes(x));
}

/** New setup code for one label, or null (excluded family / no rule). */
export function codeForLabel(label: string | null | undefined): string | null {
  const l = norm(label);
  if (l.trim().length < 3) return null;
  if (EXCLUDE.some((x) => l.includes(x))) return null;
  for (const r of RELINK_RULES) if (r.phrases.some((p) => l.includes(p))) return r.code;
  return null;
}

/** "9:35–10:30 NY" → minutes {from: 575, to: 630}; null when not a time range. */
export function parseWindowMinutes(timeOfDay: string | null | undefined): { from: number; to: number } | null {
  const m = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/.exec(timeOfDay ?? "");
  if (!m) return null;
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  return to > from ? { from, to } : null;
}

/** Minutes from midnight of a local timestamp text "YYYY-MM-DDTHH:MM…" (PropReports openedAt is New York time). */
export function entryMinuteOf(localStamp: string | null | undefined): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(localStamp ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export type RelinkDecision =
  | { tradeId: number; from: number | null; to: number; code: string; label: string }
  | { tradeId: number; from: number | null; to: null; code: string | null; label: string | null; reason: "excluded" | "no_rule" | "outside_window" | "no_time" | "no_label" | "setup_missing" };

/** The label a trade is judged by: the old setup's name, then the trade's own setup text, then the old setup's first tag. */
export function labelsOf(t: RelinkTrade, old: ReadonlyMap<number, RelinkOldSetup>): string[] {
  const o = t.playbookId != null ? old.get(t.playbookId) : undefined;
  const firstTag = (o?.tags ?? "").split(",").map((x) => x.trim()).find(Boolean) ?? null;
  return [o?.name ?? null, t.setup, firstTag].filter((x): x is string => !!x && x.trim().length > 0);
}

export function decide(t: RelinkTrade, old: ReadonlyMap<number, RelinkOldSetup>, byCode: ReadonlyMap<string, RelinkNewSetup>, toleranceMin = 5): RelinkDecision {
  const labels = labelsOf(t, old);
  if (!labels.length) return { tradeId: t.id, from: t.playbookId, to: null, code: null, label: null, reason: "no_label" };
  // The old setup's name decides when it names an excluded family; later labels are only a fallback for «no rule».
  let code: string | null = null;
  let label: string = labels[0];
  let excluded = false;
  for (const l of labels) {
    if (EXCLUDE.some((x) => norm(l).includes(x))) { excluded = true; break; }
    code = codeForLabel(l);
    if (code) { label = l; break; }
  }
  if (!code) return { tradeId: t.id, from: t.playbookId, to: null, code: null, label, reason: excluded ? "excluded" : "no_rule" };
  const target = byCode.get(code);
  if (!target) return { tradeId: t.id, from: t.playbookId, to: null, code, label, reason: "setup_missing" };
  const w = parseWindowMinutes(target.timeOfDay);
  if (w) {
    if (t.entryMin == null) return { tradeId: t.id, from: t.playbookId, to: null, code, label, reason: "no_time" };
    if (t.entryMin < w.from - toleranceMin || t.entryMin > w.to + toleranceMin) return { tradeId: t.id, from: t.playbookId, to: null, code, label, reason: "outside_window" };
  }
  return { tradeId: t.id, from: t.playbookId, to: target.id, code, label };
}

export type RelinkLabelRow = { label: string; oldId: number | null; trades: number; code: string | null; linked: number; outsideWindow: number; noTime: number };
export type RelinkReport = {
  trades: number;
  linked: number;
  unlinked: number;
  byNewSetup: { code: string; id: number; name: string; trades: number }[];
  byOldLabel: RelinkLabelRow[];
  unlinkedReasons: Record<string, number>;
};

/** Decisions for every trade plus the mapping report (old label → new code, counts, unmatched). */
export function planRelink(trades: readonly RelinkTrade[], oldSetups: readonly RelinkOldSetup[], newSetups: readonly RelinkNewSetup[], toleranceMin = 5):
  { decisions: RelinkDecision[]; report: RelinkReport } {
  const old = new Map(oldSetups.map((s) => [s.id, s]));
  const byCode = new Map(newSetups.map((s) => [s.code, s]));
  const decisions = trades.map((t) => decide(t, old, byCode, toleranceMin));
  const rows = new Map<string, RelinkLabelRow>();
  const perCode = new Map<string, number>();
  const reasons: Record<string, number> = {};
  decisions.forEach((d, i) => {
    const t = trades[i];
    const label = labelsOf(t, old)[0] ?? "—";
    const key = `${t.playbookId ?? ""}|${label}`;
    const row = rows.get(key) ?? { label, oldId: t.playbookId, trades: 0, code: d.code, linked: 0, outsideWindow: 0, noTime: 0 };
    row.trades++;
    if (d.to != null) { row.linked++; perCode.set(d.code, (perCode.get(d.code) ?? 0) + 1); }
    else {
      reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
      if (d.reason === "outside_window") row.outsideWindow++;
      if (d.reason === "no_time") row.noTime++;
    }
    rows.set(key, row);
  });
  const linked = decisions.filter((d) => d.to != null).length;
  return {
    decisions,
    report: {
      trades: trades.length,
      linked,
      unlinked: trades.length - linked,
      byNewSetup: newSetups.map((s) => ({ code: s.code, id: s.id, name: s.name, trades: perCode.get(s.code) ?? 0 })),
      byOldLabel: [...rows.values()].sort((a, b) => b.trades - a.trades),
      unlinkedReasons: reasons,
    },
  };
}
