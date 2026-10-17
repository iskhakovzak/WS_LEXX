/**
 * Pure helpers for event → notification producers (routes/discussions, risk, eod, scaling, ratings, weekly-review,
 * propreports). No DB / Express imports, so the dedup keys, recipient selection and Russian texts can be checked
 * offline (scratchpad script) and by unit tests. DB side lives in lib/notifyEvents.ts.
 */

// ─── formatting ─────────────────────────────────────────────────────────────

/** "$1,234" (absolute, rounded to dollars). */
export function fmtUsd(v: number): string {
  return `$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

/** "+$340" / "−$162" / "$0"; null → "—". Uses the typographic minus. */
export function fmtSignedUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  return `${r < 0 ? "−" : r > 0 ? "+" : ""}${fmtUsd(r)}`;
}

/** Loss limit written as a negative amount: 150 → "−$150". */
export function fmtLossLimit(v: number): string {
  return `−${fmtUsd(v)}`;
}

/** Russian plural: plural(3, "сделка", "сделки", "сделок") → "сделки". */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** One-line preview of free text (whitespace collapsed, ellipsis when cut). */
export function preview(text: string | null | undefined, max = 100): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ─── recipients ─────────────────────────────────────────────────────────────

/**
 * De-duplicated, trimmed, non-empty recipients without the excluded names (usually the actor — nobody is
 * notified about their own action). Order of first appearance is kept.
 */
export function uniqueRecipients(
  names: Iterable<string | null | undefined>,
  exclude: string | null | undefined | ReadonlyArray<string | null | undefined> = null,
): string[] {
  const ex = new Set((Array.isArray(exclude) ? exclude : [exclude]).filter((x): x is string => !!x).map((x) => x.trim()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const n = (raw ?? "").trim();
    if (!n || ex.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// ─── dedup keys ─────────────────────────────────────────────────────────────

/** At most one risk notification per type per trader per (NY) trading day. */
export function riskDedupKey(type: "risk_warn" | "risk_breach", trader: string, date: string): string {
  return `risk:${type}:${trader}:${date}`;
}

/** One overdue alert per closed day; a re-close (new closed_at) may alert again. */
export function eodOverdueKey(dayId: number, closedAt: Date | string): string {
  const iso = closedAt instanceof Date ? closedAt.toISOString() : new Date(closedAt).toISOString();
  return `eod_overdue:${dayId}:${iso}`;
}

// ─── risk ───────────────────────────────────────────────────────────────────

export type RiskSnapshot = {
  trader: string;
  /** computeStop state (ok / no_limits produce no notice). */
  state: string;
  halted: boolean;
  /** Losses as positive numbers. */
  todayLoss: number;
  weekLoss: number;
  currentDd: number;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  maxDrawdown: number | null;
  dailyPct: number | null;
  weeklyPct: number | null;
  drawdownPct: number | null;
  warnPct: number;
};

export type RiskNotice = {
  type: "risk_warn" | "risk_breach";
  /** «дневной лимит −$150 превышен (−$162)» — no subject, lower-case start. */
  core: string;
  traderTitle: string;
  traderBody: string;
  staffTitle: string;
  staffBody: string;
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Russian notice with exact numbers for a stop/warn state; null when nothing to say. */
export function riskNotice(s: RiskSnapshot): RiskNotice | null {
  let core: string;
  let tail = "";
  if (s.state === "drawdown" && s.maxDrawdown != null) {
    core = `макс. просадка ${fmtUsd(s.maxDrawdown)} достигнута (${fmtUsd(s.currentDd)} от пика)`;
    tail = " — торговля остановлена до решения куратора.";
  } else if (s.state === "weekly" && s.weeklyLimit != null) {
    core = `недельный лимит ${fmtLossLimit(s.weeklyLimit)} превышен (${fmtSignedUsd(-s.weekLoss)})`;
    tail = " — до понедельника только наблюдение.";
  } else if (s.state === "stop" && s.dailyLimit != null) {
    core = `дневной лимит ${fmtLossLimit(s.dailyLimit)} превышен (${fmtSignedUsd(-s.todayLoss)})`;
    tail = " — на сегодня всё.";
  } else if (s.state === "warn") {
    const parts: string[] = [];
    if (s.dailyLimit != null && s.dailyPct != null && s.dailyPct >= s.warnPct) parts.push(`дневной лимит: ${fmtSignedUsd(-s.todayLoss)} из ${fmtLossLimit(s.dailyLimit)} (${Math.round(s.dailyPct)}%)`);
    if (s.weeklyLimit != null && s.weeklyPct != null && s.weeklyPct >= s.warnPct) parts.push(`недельный лимит: ${fmtSignedUsd(-s.weekLoss)} из ${fmtLossLimit(s.weeklyLimit)} (${Math.round(s.weeklyPct)}%)`);
    if (s.maxDrawdown != null && s.drawdownPct != null && s.drawdownPct >= s.warnPct) parts.push(`просадка: ${fmtUsd(s.currentDd)} из ${fmtUsd(s.maxDrawdown)} (${Math.round(s.drawdownPct)}%)`);
    if (!parts.length) return null;
    core = parts.join("; ");
  } else {
    return null;
  }
  const type = s.halted ? "risk_breach" : "risk_warn";
  const label = type === "risk_breach" ? "лимит превышен" : "близко к лимиту";
  return {
    type,
    core,
    traderTitle: cap(label),
    traderBody: `${cap(core)}${tail}`,
    staffTitle: `${s.trader} — ${label}`,
    staffBody: `${s.trader}: ${core}`,
  };
}

// ─── limits ─────────────────────────────────────────────────────────────────

export type LimitsLike = {
  dailyLossLimit?: number | null;
  weeklyLossLimit?: number | null;
  maxDrawdown?: number | null;
  maxRiskPerTrade?: number | null;
  maxPositionUsd?: number | null;
  maxOpenPositions?: number | null;
  tier?: string | null;
};

const LIMIT_FIELDS: ReadonlyArray<{ key: keyof LimitsLike; label: string; money: boolean }> = [
  { key: "dailyLossLimit", label: "дневной", money: true },
  { key: "weeklyLossLimit", label: "недельный", money: true },
  { key: "maxDrawdown", label: "просадка", money: true },
  { key: "maxRiskPerTrade", label: "риск/сделка", money: true },
  { key: "maxPositionUsd", label: "позиция", money: true },
  { key: "maxOpenPositions", label: "позиций", money: false },
  { key: "tier", label: "тир", money: false },
];

/** «дневной $150 → $200» parts for the fields that changed (null = «нет»). */
export function limitsDiff(before: LimitsLike | null | undefined, after: LimitsLike | null | undefined): string[] {
  const out: string[] = [];
  const show = (v: unknown, money: boolean) => (v == null || v === "" ? "нет" : money ? fmtUsd(Number(v)) : String(v));
  for (const f of LIMIT_FIELDS) {
    const a = before?.[f.key] ?? null;
    const b = after?.[f.key] ?? null;
    const same = f.money || f.key === "maxOpenPositions" ? (a == null ? null : Number(a)) === (b == null ? null : Number(b)) : a === b;
    if (!same) out.push(`${f.label} ${show(a, f.money)} → ${show(b, f.money)}`);
  }
  return out;
}

/** «дневной $300, недельный $900, просадка $2,000» for a tier / limits row (skips empty values). */
export function limitsSummary(l: LimitsLike | null | undefined): string {
  if (!l) return "";
  const parts: string[] = [];
  if (l.dailyLossLimit != null) parts.push(`дневной ${fmtUsd(l.dailyLossLimit)}`);
  if (l.weeklyLossLimit != null) parts.push(`недельный ${fmtUsd(l.weeklyLossLimit)}`);
  if (l.maxDrawdown != null) parts.push(`просадка ${fmtUsd(l.maxDrawdown)}`);
  return parts.join(", ");
}

// ─── eod ────────────────────────────────────────────────────────────────────

/** Closed-and-unreviewed days waiting longer than the SLA, oldest first, with whole hours waited. */
export function selectOverdue<T extends { id: number; closedAt: Date | string | null; reviewedAt?: Date | string | null }>(
  rows: readonly T[],
  now: Date,
  slaHours: number,
): Array<T & { hoursWaiting: number }> {
  const out: Array<T & { hoursWaiting: number }> = [];
  for (const r of rows) {
    if (!r.closedAt || r.reviewedAt) continue;
    const ms = (r.closedAt instanceof Date ? r.closedAt : new Date(r.closedAt)).getTime();
    if (!Number.isFinite(ms)) continue;
    const hours = (now.getTime() - ms) / 3_600_000;
    if (hours > slaHours) out.push({ ...r, hoursWaiting: Math.floor(hours) });
  }
  return out.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

// ─── scaling ────────────────────────────────────────────────────────────────

export function scalingActionLabel(action: string): string {
  return action === "promote" ? "Повышение" : action === "demote" ? "Понижение" : "Назначение";
}

// ─── propreports sync ───────────────────────────────────────────────────────

export type SyncCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
  errors: number;
  errorText?: string | null;
};

/** Result of a sync / import run: «Импорт PropReports: +12 новых, обновлено 3». warn when any row failed. */
export function syncNotice(r: SyncCounts, label: string, context?: string | null): { title: string; message: string; severity: "info" | "warn" } {
  const head: string[] = [];
  head.push(r.inserted ? `+${r.inserted} ${plural(r.inserted, "новая", "новые", "новых")}` : "нет новых");
  if (r.updated) head.push(`обновлено ${r.updated}`);
  const tail: string[] = [];
  if (r.unchanged) tail.push(`без изменений ${r.unchanged}`);
  if (r.skipped) tail.push(`пропущено ${r.skipped}`);
  if (r.conflicts) tail.push(`в сверку ${r.conflicts}`);
  if (r.errors) tail.push(`ошибок ${r.errors}${r.errorText ? ` (${preview(r.errorText, 80)})` : ""}`);
  const body = [cap(tail.join(", ")), context ?? ""].filter(Boolean).join(" · ");
  return {
    title: `${label} PropReports: ${head.join(", ")}`,
    message: body || "Сделки синхронизированы",
    severity: r.errors > 0 ? "warn" : "info",
  };
}

/** sync_unmatched text for broker accounts that are not mapped to a trader; null when none. */
export function unmatchedNotice(accounts: readonly string[]): { title: string; message: string } | null {
  const list = [...new Set(accounts.filter(Boolean))];
  if (!list.length) return null;
  const shown = list.slice(0, 5).join(", ");
  const more = list.length > 5 ? ` и ещё ${list.length - 5}` : "";
  return {
    title: `${list.length} ${plural(list.length, "счёт", "счёта", "счетов")} без трейдера`,
    message: `${shown}${more} — сделки не импортированы, привяжите счета в «Интеграциях»`,
  };
}

// ─── rule violations ────────────────────────────────────────────────────────

/** One notification per violation row ever (rule + its stable scan key), even if a re-scan drops and recreates it. */
export function violationDedupKey(ruleId: number, key: string): string {
  return `rule_violation:${ruleId}:${key}`;
}

/** Old trading days are history, not news: only today / yesterday (NY) violations notify. */
export function isNotifiableViolationDay(day: string | null | undefined, since: string): boolean {
  return !!day && day >= since;
}

export type ViolationItem = { ruleName: string; message: string; severity: string };

/**
 * rule_violation text for the new violations of one trader found in one scan; null when none.
 * `forStaff` writes it about the trader (curator inbox) instead of to them.
 */
export function violationNotice(
  trader: string,
  items: readonly ViolationItem[],
  forStaff: boolean,
): { title: string; message: string; severity: "warn" | "critical" } | null {
  if (!items.length) return null;
  const severity = items.some((v) => v.severity === "high" || v.severity === "critical") ? "critical" : "warn";
  const who = forStaff ? ` · ${trader}` : "";
  if (items.length === 1) {
    const v = items[0];
    return { title: `Нарушено правило «${preview(v.ruleName, 60)}»${who}`, message: preview(v.message, 160), severity };
  }
  const rules = [...new Set(items.map((v) => v.ruleName))];
  const shown = rules.slice(0, 3).map((r) => `«${preview(r, 40)}»`).join(", ");
  const more = rules.length > 3 ? ` и ещё ${rules.length - 3}` : "";
  return {
    title: `${items.length} ${plural(items.length, "нарушение правил", "нарушения правил", "нарушений правил")}${who}`,
    message: `${shown}${more}`,
    severity,
  };
}
