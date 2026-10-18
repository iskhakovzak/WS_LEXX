/**
 * Playbook «Сегодня» — PURE builder (no I/O), unit-tested. lib/playbookToday/service.ts loads the rows; this turns them
 * into PlaybookToday (./types.ts): day windows, setups per window with the trader's own edge, tier locks with the unlock
 * condition, cheat-sheet lines and the checklist.
 *
 * Edge verdicts (R from the trader's own linked closed trades — money is never needed here):
 *   new      fewer than EDGE_MIN_TRADES (5) closed trades: too few to say anything;
 *   careful  average R below 0 (negative expectancy) — shown as «осторожно»;
 *   best     the ONE setup with the highest average R among those with ≥ EDGE_BEST_MIN_R (10) trades that have an R
 *            and a positive average — «твой лучший»;
 *   good     everything else with enough trades (positive / flat average, or R unknown: no stop / risk on the trades).
 * The R count matters for «best» (a 3.0R average over two stopped trades is noise); 5 / 10 keep a fresh Стажёр at «new»
 * for the first week or two of a setup and let the desk's typical 2 trades a day reach «best» within a month.
 *
 * Tier locks (guidance, never a trading block): a setup is locked when the viewer's stage ranks below its min_tier.
 * A setup one step above the trainee (min_tier junior) with a gateway setup (UNLOCK_GATE) opens early once the trader has
 * N trades graded A / A+ on the gateway (quests.setupUnlockGradeA, 0 = off); otherwise the lock names the tier.
 */
import type { DayWindow, DayWindowKey, MyEdge, PlaybookToday, TextItem, TodaySetup } from "./types";

export const TIER_KEYS = ["trainee", "junior", "trader", "senior", "lead"] as const;
export type TierKey = (typeof TIER_KEYS)[number];
const TIER_RANK: Record<TierKey, number> = { trainee: 0, junior: 1, trader: 2, senior: 3, lead: 4 };
export const isTierKey = (v: unknown): v is TierKey => typeof v === "string" && (TIER_KEYS as readonly string[]).includes(v);

/** Cheat-sheet picture keys the web draws (one inline SVG per key). */
export const SCHEMA_KEYS = [
  "routine", "gap_go", "opening_drive", "orb", "red_to_green", "first_pullback", "vwap_hold", "flag", "hod_break",
  "vwap_fade", "failed_breakout", "parabolic", "day2", "gap_fill", "power_hour", "moc",
] as const;
export const isSchemaKey = (v: unknown): boolean => typeof v === "string" && (SCHEMA_KEYS as readonly string[]).includes(v);

/** Gateway setup per office code: N graded-A trades on the gateway open the setup before the tier (trainee → junior). */
export const UNLOCK_GATE: Readonly<Record<string, string>> = {
  "1.1": "1.3", "1.2": "1.3", "1.4": "1.3", "3.2": "1.3", "4.1": "1.3",
  "2.3": "2.2", "5.1": "2.2", "3.1": "2.1", "4.2": "2.1",
};

export const EDGE_MIN_TRADES = 5;
export const EDGE_BEST_MIN_R = 10;
const MAX_PICKS = 3;

export const DAY_WINDOWS: readonly { key: DayWindowKey; from: string; to: string }[] = [
  { key: "premarket", from: "04:00", to: "09:30" },
  { key: "open", from: "09:30", to: "10:30" },
  { key: "trend", from: "10:30", to: "15:00" },
  { key: "close", from: "15:00", to: "16:00" },
];

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hhmm = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;

/** «1.3 ORB 5 минут» → "1.3". */
export function codeFromName(name: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2}\.\d{1,2})(?=\s|$)/.exec(name ?? "");
  return m ? m[1] : null;
}

/** "9:35–10:30 NY" → {from:"09:35", to:"10:30"}. */
export function parseTimeRange(timeOfDay: string | null | undefined): { from: string; to: string } | null {
  const m = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/.exec(timeOfDay ?? "");
  if (!m) return null;
  const from = hhmm(m[1], m[2]);
  const to = hhmm(m[3], m[4]);
  return toMin(to) > toMin(from) ? { from, to } : null;
}

/**
 * The window a time range belongs to: the one holding its start, unless the range spends at least twice as long in a
 * later window (2.1 VWAP Hold 10:00–15:00 is a trend setup; 4.2 Gap Fill 9:35–11:30 stays an open setup).
 */
export function windowOf(range: { from: string; to: string } | null): DayWindowKey | null {
  if (!range) return null;
  const a = toMin(range.from), b = toMin(range.to);
  const overlap = (w: { from: string; to: string }) => Math.max(0, Math.min(b, toMin(w.to)) - Math.max(a, toMin(w.from)));
  const startIdx = DAY_WINDOWS.findIndex((w) => a >= toMin(w.from) && a < toMin(w.to));
  if (startIdx < 0) return a < toMin(DAY_WINDOWS[0].from) ? "premarket" : null;
  let best = startIdx;
  for (let i = startIdx + 1; i < DAY_WINDOWS.length; i++) if (overlap(DAY_WINDOWS[i]) >= 2 * overlap(DAY_WINDOWS[startIdx]) && overlap(DAY_WINDOWS[i]) > overlap(DAY_WINDOWS[best])) best = i;
  return DAY_WINDOWS[best].key;
}

/** First non-empty line of a card field, without list markers (the cheat sheet shows one line per field). */
export function firstLine(text: string | null | undefined, max = 240): string | null {
  const line = (text ?? "").split(/\r?\n/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).find(Boolean);
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** «Грейд A — свежий катализатор, RVOL > 2, рынок по направлению» → bullets (≤ 4). Latin «Grade A — …» works too. */
export function gradeABullets(notes: string | null | undefined): string[] {
  const m = /^\s*(?:Грейд|Grade|Greyd)\s*[AА]\s*[—–:-]\s*(.+)$/im.exec(notes ?? ""); // i18n-ignore (parses stored card text)
  if (!m) return [];
  const body = m[1].trim().replace(/[.;]\s*$/, "");
  const parts = body.includes(" + ") ? body.split(" + ") : body.split(/,\s+(?![^()]*\))/);
  return parts.map((p) => p.trim()).filter(Boolean).slice(0, 4);
}

export function checklistTexts(items: unknown, text: string | null | undefined): string[] {
  if (Array.isArray(items)) {
    const out = items.map((it) => (it && typeof it === "object" ? String((it as { text?: unknown }).text ?? "").trim() : "")).filter(Boolean);
    if (out.length) return out;
  }
  return (text ?? "").split(/\r?\n/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

export type EdgeRow = {
  setupId: number;
  /** Closed linked trades of the trader. */
  trades: number;
  wins: number;
  /** Wins + losses (break-even excluded from the win rate). */
  decided: number;
  /** Trades with a known R, and their sum. */
  rTrades: number;
  sumR: number;
  lastOn: string | null;
  /** Trades graded A / A+ at the evening review (trades.confidence_grade). */
  gradedA: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Per-setup edge with verdicts (one «best» at most). */
export function edgesOf(rows: readonly EdgeRow[]): Map<number, MyEdge> {
  const out = new Map<number, MyEdge>();
  let bestId: number | null = null;
  let bestAvg = 0;
  for (const r of rows) {
    const avg = r.rTrades > 0 ? r.sumR / r.rTrades : null;
    if (r.trades >= EDGE_MIN_TRADES && r.rTrades >= EDGE_BEST_MIN_R && avg != null && avg > bestAvg) { bestAvg = avg; bestId = r.setupId; }
  }
  for (const r of rows) {
    if (r.trades <= 0) continue;
    const avg = r.rTrades > 0 ? r.sumR / r.rTrades : null;
    const verdict: MyEdge["verdict"] = r.trades < EDGE_MIN_TRADES ? "new" : avg != null && avg < 0 ? "careful" : r.setupId === bestId ? "best" : "good";
    out.set(r.setupId, {
      trades: r.trades, wins: r.wins, winRate: r.decided > 0 ? r2(r.wins / r.decided) : null,
      avgR: avg == null ? null : r2(avg), totalR: r.rTrades > 0 ? r2(r.sumR) : null, verdict, lastTradedOn: r.lastOn,
    });
  }
  return out;
}

export type SetupRow = {
  id: number;
  name: string;
  folder: string | null;
  timeOfDay: string | null;
  entryText: string | null;
  stopText: string | null;
  targetsText: string | null;
  invalidationText: string | null;
  notes: string | null;
  checklistItems: unknown;
  checklist: string | null;
  minTier: string | null;
  schemaKey: string | null;
  space: "office" | "personal";
};

/** Viewer for locks: staff see everything open; a trader without a known stage counts as a trainee. */
export type LockViewer = { staff: boolean; tier: string | null };

export type LockState = { locked: boolean; unlock: TextItem | null };

export function lockOf(s: Pick<SetupRow, "minTier" | "name">, viewer: LockViewer, gradedAByCode: ReadonlyMap<string, number>, gateCount: number): LockState {
  if (viewer.staff || !isTierKey(s.minTier)) return { locked: false, unlock: null };
  const mine = TIER_RANK[isTierKey(viewer.tier) ? viewer.tier : "trainee"];
  const need = TIER_RANK[s.minTier];
  if (mine >= need) return { locked: false, unlock: null };
  const gate = UNLOCK_GATE[codeFromName(s.name) ?? ""];
  if (gate && gateCount > 0 && need === mine + 1 && need === TIER_RANK.junior) {
    const done = gradedAByCode.get(gate) ?? 0;
    if (done >= gateCount) return { locked: false, unlock: null };
    return { locked: true, unlock: { key: "unlock.gradeA", params: { count: gateCount, done, code: gate, tier: s.minTier } } };
  }
  return { locked: true, unlock: { key: "unlock.tier", params: { tier: s.minTier } } };
}

const codeOrder = (c: string | null) => (c ? c.split(".").reduce((a, x, i) => a + Number(x) / 100 ** i, 0) : 1e9);

export type TodayInput = {
  date: string;
  nyMinutes: number;
  setups: readonly SetupRow[];
  edges: readonly EdgeRow[];
  viewer: LockViewer;
  /** quests.setupUnlockGradeA (0 = gateway unlocks off). */
  gateCount: number;
  /** Personal plan doc.setups for `date`. */
  planSetups: unknown;
  oneR: PlaybookToday["oneR"];
  untagged: number;
};

/** Picks stored in the plan, kept only while they are still in today's list (max 3, order kept). */
export function picksOf(planSetups: unknown, ids: ReadonlySet<number>): number[] {
  if (!Array.isArray(planSetups)) return [];
  const out: number[] = [];
  for (const v of planSetups) {
    const n = Number(v);
    if (Number.isInteger(n) && ids.has(n) && !out.includes(n)) out.push(n);
    if (out.length >= MAX_PICKS) break;
  }
  return out;
}

export function buildToday(i: TodayInput): PlaybookToday {
  const edges = edgesOf(i.edges);
  const gradedAByCode = new Map<string, number>();
  for (const s of i.setups) {
    const code = codeFromName(s.name);
    const e = i.edges.find((x) => x.setupId === s.id);
    if (code && s.space === "office" && e) gradedAByCode.set(code, (gradedAByCode.get(code) ?? 0) + e.gradedA);
  }
  // Setups without a time take the window most of their folder has.
  const folderWin = new Map<string, Map<DayWindowKey, number>>();
  for (const s of i.setups) {
    const w = windowOf(parseTimeRange(s.timeOfDay));
    if (!w || !s.folder) continue;
    const m = folderWin.get(s.folder) ?? new Map<DayWindowKey, number>();
    m.set(w, (m.get(w) ?? 0) + 1);
    folderWin.set(s.folder, m);
  }
  const fromFolder = (f: string | null) => {
    const m = f ? folderWin.get(f) : undefined;
    return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : null;
  };
  const setups: TodaySetup[] = i.setups.map((s) => {
    const time = parseTimeRange(s.timeOfDay);
    const lock = lockOf(s, i.viewer, gradedAByCode, i.gateCount);
    return {
      id: s.id, code: codeFromName(s.name), name: s.name, folder: s.folder,
      window: windowOf(time) ?? fromFolder(s.folder), time,
      schema: isSchemaKey(s.schemaKey) ? s.schemaKey : null,
      locked: lock.locked, minTier: isTierKey(s.minTier) ? s.minTier : null, unlock: lock.unlock,
      myEdge: edges.get(s.id) ?? null,
      cheat: {
        entry: firstLine(s.entryText), stop: firstLine(s.stopText), target: firstLine(s.targetsText),
        invalidation: firstLine(s.invalidationText), gradeA: gradeABullets(s.notes),
      },
      checklist: checklistTexts(s.checklistItems, s.checklist),
    };
  });
  const winIdx = (w: DayWindowKey | null) => (w ? DAY_WINDOWS.findIndex((x) => x.key === w) : DAY_WINDOWS.length);
  setups.sort((a, b) => winIdx(a.window) - winIdx(b.window) || codeOrder(a.code) - codeOrder(b.code) || a.name.localeCompare(b.name));
  const windows: DayWindow[] = DAY_WINDOWS.map((w) => ({ ...w, setupIds: setups.filter((s) => s.window === w.key).map((s) => s.id) }));
  const open = new Set(setups.filter((s) => !s.locked).map((s) => s.id));
  return {
    date: i.date, nyMinutes: i.nyMinutes, windows, setups,
    picks: picksOf(i.planSetups, open), oneR: i.oneR, untagged: i.untagged,
  };
}

export type PicksCheck =
  | { ok: true; ids: number[] }
  | { ok: false; code: "TOO_MANY"; max: number }
  | { ok: false; code: "SETUP_NOT_FOUND"; id: number }
  | { ok: false; code: "PLAYBOOK_SETUP_LOCKED"; id: number; name: string };

/** PUT /playbook/today/picks: at most 3 distinct setups from today's list (office or own), none locked. */
export function checkPicks(raw: readonly number[], today: Pick<PlaybookToday, "setups">): PicksCheck {
  const ids = [...new Set(raw)];
  if (ids.length > MAX_PICKS) return { ok: false, code: "TOO_MANY", max: MAX_PICKS };
  for (const id of ids) {
    const s = today.setups.find((x) => x.id === id);
    if (!s) return { ok: false, code: "SETUP_NOT_FOUND", id };
    if (s.locked) return { ok: false, code: "PLAYBOOK_SETUP_LOCKED", id, name: s.name };
  }
  return { ok: true, ids };
}
