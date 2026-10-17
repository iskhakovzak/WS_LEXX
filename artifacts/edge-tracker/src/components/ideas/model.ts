/** Trade ideas — shared types and pure helpers (levels parsing, R:R, pipeline stage). */
import type { Tone } from "@/components/ds";

export type Reaction = { id: number; tradeIdeaId: number; trader: string; reaction: string; comment: string | null; createdAt: string };
/** Trade linked to an idea. `r`/`net`/`outcome` are computed server-side with the shared trade math (R signed, net = gross − |fees|). */
export type LinkedTrade = {
  id: number; result: string; pnl: string | null; rMultiple: string | null; date: string;
  side?: string | null; entry?: string | null; exit?: string | null; stop?: string | null; fees?: string | null;
  riskUsd?: string | null; qty?: string | null; horizon?: string | null; exitDate?: string | null; trader?: string | null;
  r?: number | null; net?: number | null; outcome?: "win" | "loss" | "be" | "open" | null;
};
export type IdeaComment = { id: number; idea_id: number; author_name: string; text: string; is_private: boolean; source: string; created_at: string };

export type TradeIdea = {
  id: number; ticker: string; side: string | null; setup: string | null; entryZone: string | null;
  target: string | null; stop: string | null; thesis: string | null; score: number | null;
  scoreBreakdown: string | null; status: string; trader: string | null;
  playbookId: number | null; watchlistId: number | null; screenshotUrl: string | null;
  tags: string | null; publishedAt: string | null; convertedTradeId: number | null;
  createdAt: string; reactions: Reaction[]; linkedTrade: LinkedTrade | null;
  review_status: string | null; review_reason: string | null; reviewed_by: string | null; reviewed_at: string | null;
  riskAmount: string | null; setupQuality: string | null;
  sector?: string | null; longName?: string | null;
  commentCount?: number; lastCommentAt?: string | null; unreadCount?: number;
  /** Dedicated columns (trade_ideas.horizon / valid_until); `expired` = published, not converted, valid_until < today (NY). */
  horizon?: Horizon | null; validUntil?: string | null; expired?: boolean; ideaDate?: string | null;
};

export type IdeaTracking = {
  ticker: string; price: number | null;
  hit: "target" | "final_target" | "stop" | null; hitAt: string | null; ambiguous: boolean;
  rNow: number | null; mfeR: number | null; maeR: number | null; plannedR: number;
  since: string;
};
export type TrackingResponse = { generatedAt: string; items: Record<string, IdeaTracking> };

// ─── Levels ────────────────────────────────────────────────────────────────

/** All positive numbers in a free-form level string ("180.5-181.2", "185 / 187", "$178"). Mirrors the API parser. */
export function parseLevelNumbers(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const normalized = String(raw).replace(/(\d),(\d{3})(?!\d)/g, "$1$2").replace(/(\d),(\d)/g, "$1.$2");
  const out: number[] = [];
  for (const m of normalized.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

export type LevelPlan = {
  isShort: boolean;
  entry: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stop: number | null;
  targets: number[]; // nearest first
  riskPerShare: number | null;
  rewardPerShare: number | null; // to first target
  rr: number | null; // to first target
  rrFinal: number | null; // to farthest target
  issues: string[]; // soft validation problems
};

export function levelPlan(side: string | null | undefined, entryZone: string | null | undefined, stop: string | null | undefined, target: string | null | undefined): LevelPlan {
  const isShort = (side ?? "").toLowerCase() === "short";
  const entries = parseLevelNumbers(entryZone);
  const stops = parseLevelNumbers(stop);
  const rawTargets = parseLevelNumbers(target);
  const entry = entries.length ? entries.reduce((a, b) => a + b, 0) / entries.length : null;
  const stopN = stops.length ? stops[0] : null;
  const targets = [...rawTargets].sort((a, b) => (isShort ? b - a : a - b));
  const issues: string[] = [];
  let riskPerShare: number | null = null;
  let rewardPerShare: number | null = null;
  let rr: number | null = null;
  let rrFinal: number | null = null;

  if (entry != null && stopN != null) {
    const wrongStop = isShort ? stopN <= entry : stopN >= entry;
    if (wrongStop) issues.push(isShort ? "Для шорта стоп должен быть выше входа" : "Для лонга стоп должен быть ниже входа");
    else riskPerShare = Math.abs(entry - stopN);
  }
  if (entry != null && targets.length) {
    const wrongTarget = targets.some((t) => (isShort ? t >= entry : t <= entry));
    if (wrongTarget) issues.push(isShort ? "Для шорта цель должна быть ниже входа" : "Для лонга цель должна быть выше входа");
    else rewardPerShare = Math.abs(targets[0] - entry);
  }
  if (riskPerShare && rewardPerShare != null) {
    rr = rewardPerShare / riskPerShare;
    rrFinal = Math.abs(targets[targets.length - 1] - (entry as number)) / riskPerShare;
    if (rr < 1) issues.push("R:R меньше 1 — потенциал ниже риска");
  }
  if (entry != null && stopN != null && riskPerShare && riskPerShare / entry > 0.15) {
    issues.push("Стоп дальше 15% от входа — проверьте уровни");
  }
  return {
    isShort, entry,
    entryLow: entries.length ? Math.min(...entries) : null,
    entryHigh: entries.length ? Math.max(...entries) : null,
    stop: stopN, targets, riskPerShare, rewardPerShare, rr, rrFinal, issues,
  };
}

export function ideaPlan(i: Pick<TradeIdea, "side" | "entryZone" | "stop" | "target">): LevelPlan {
  return levelPlan(i.side, i.entryZone, i.stop, i.target);
}

export function rrTone(rr: number | null | undefined): Tone {
  if (rr == null) return "neutral";
  if (rr >= 2) return "up";
  if (rr >= 1) return "warn";
  return "down";
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  // Same notation as the levels traders type and the trade tables («920.74»), not «920,74» next to them.
  return n.toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: abs < 10 ? 2 : abs < 1000 ? 2 : 0, maximumFractionDigits: abs < 10 ? 3 : 2 });
}

export function fmtR(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.abs(n).toFixed(digits);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}R`;
}

// ─── Pipeline stage ────────────────────────────────────────────────────────

export type Stage = "draft" | "review" | "active" | "won" | "lost" | "rejected";

export const STAGES: { key: Stage; label: string; short: string; tone: Tone; hint: string }[] = [
  { key: "draft", label: "Черновик", short: "Черновики", tone: "neutral", hint: "Видны всей команде, но ещё не отправлены на ревью" },
  { key: "review", label: "На ревью", short: "На ревью", tone: "warn", hint: "Опубликованы и ждут решения куратора" },
  { key: "active", label: "Активна", short: "Активные", tone: "accent", hint: "Одобрены или в сделке, цель и стоп ещё не задеты" },
  { key: "won", label: "Сработала", short: "Сработали", tone: "up", hint: "Цель достигнута раньше стопа или сделка в плюсе" },
  { key: "lost", label: "Не сработала", short: "Не сработали", tone: "down", hint: "Стоп задет раньше цели или сделка в минусе / в ноль" },
  { key: "rejected", label: "Отклонена", short: "Отклонены", tone: "purple", hint: "Куратор отклонил идею" },
];
export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<Stage, (typeof STAGES)[number]>;

export function normalizeTradeResult(raw: string | null | undefined): "win" | "loss" | "breakeven" | "open" {
  const r = (raw ?? "").toLowerCase().trim();
  if (r === "win" || r === "winner" || r === "прибыль" || r === "profit" || r === "профит") return "win";
  if (r === "loss" || r === "loser" || r === "убыток" || r === "убыточный" || r === "лосс") return "loss";
  if (r === "breakeven" || r === "be" || r === "ноль" || r === "безубыток" || r === "бу") return "breakeven";
  return "open";
}

/** Linked-trade R (server-computed with the shared trade math; falls back to the stored r_multiple for old payloads). */
export function linkedR(t: LinkedTrade | null | undefined): number | null {
  if (!t) return null;
  if (t.r != null && Number.isFinite(t.r)) return t.r;
  const o = normalizeTradeResult(t.result);
  if (o === "open") return null;
  if (o === "breakeven") return 0;
  const raw = t.rMultiple != null && t.rMultiple !== "" ? Number(t.rMultiple) : null;
  if (raw == null || !Number.isFinite(raw)) return null;
  return o === "win" ? Math.abs(raw) : o === "loss" ? -Math.abs(raw) : raw;
}

/**
 * Realised outcome of an idea: linked trade first, then the tracked hit.
 * "be" is kept apart so hit rate = won / (won + lost) excludes break-even, like every other win rate on the desk.
 */
export function ideaOutcome(i: TradeIdea, tr?: IdeaTracking | null): "win" | "loss" | "be" | null {
  if (i.status === "draft") return null;
  if (i.linkedTrade) {
    const o = i.linkedTrade.outcome ?? normalizeTradeResult(i.linkedTrade.result);
    if (o === "win") return "win";
    if (o === "loss") return "loss";
    if (o === "be" || o === "breakeven") return "be";
  }
  if (tr?.hit === "stop") return "loss";
  if (tr?.hit === "target" || tr?.hit === "final_target") return "win";
  return null;
}

/** Where an idea sits in the pipeline. Real outcome (linked trade, then tracked hit) beats review state. */
export function stageOf(i: TradeIdea, tr?: IdeaTracking | null): Stage {
  if (i.status === "draft") return "draft";
  const o = ideaOutcome(i, tr);
  if (o === "win") return "won";
  if (o === "loss" || o === "be") return "lost";
  if (i.status === "converted") return "active";
  if (i.review_status === "rejected") return "rejected";
  if (i.review_status === "approved") return "active";
  return "review";
}

/** Horizon: the dedicated column first, legacy tag («Интрадей/Овернайт/Свинг») as fallback. */
export function ideaHorizon(i: Pick<TradeIdea, "horizon" | "tags">): Horizon | null {
  return i.horizon ?? horizonOf(i.tags);
}

export function fmtValidUntil(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
}

export const SIDE_TONE = (side: string | null | undefined): Tone => (side === "Short" ? "down" : side === "Long" ? "up" : "neutral");

export const QUALITY_TONE: Record<string, Tone> = { "A+": "up", A: "up", "B+": "accent", B: "accent", C: "warn", D: "down" };

export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "neutral";
  return score >= 70 ? "up" : score >= 40 ? "warn" : "down";
}

export function splitTags(tags: string | null | undefined): string[] {
  return tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} дн назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.trim().slice(0, 2).toUpperCase();
}

/** Safe localStorage access (private mode / blocked storage). */
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

// ─── Horizon ───────────────────────────────────────────────────────────────
// Stored in trade_ideas.horizon (the API migrated the legacy tag once); the tag is still kept in sync for old filters.

export type Horizon = "intraday" | "overnight" | "swing";
export const HORIZONS: { key: Horizon; label: string }[] = [
  { key: "intraday", label: "Интрадей" },
  { key: "overnight", label: "Овернайт" },
  { key: "swing", label: "Свинг" },
];
const HORIZON_ALIASES: Record<string, Horizon> = {
  intraday: "intraday", "интрадей": "intraday", "интрадэй": "intraday", "day": "intraday",
  overnight: "overnight", "овернайт": "overnight",
  swing: "swing", "свинг": "swing",
};

export function horizonOf(tags: string | null | undefined): Horizon | null {
  for (const t of splitTags(tags)) {
    const h = HORIZON_ALIASES[t.toLowerCase()];
    if (h) return h;
  }
  return null;
}

export function horizonLabel(h: Horizon | null | undefined): string {
  return HORIZONS.find((x) => x.key === h)?.label ?? "";
}

/** Replace any horizon tag in a comma list with the given horizon (or remove it when null). */
export function setHorizonInTags(tags: string | null | undefined, h: Horizon | null): string {
  const rest = splitTags(tags).filter((t) => !HORIZON_ALIASES[t.toLowerCase()]);
  if (h) rest.unshift(horizonLabel(h));
  return rest.join(", ");
}
