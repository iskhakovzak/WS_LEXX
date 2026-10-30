/**
 * The help registry (owner, 2026-10-30: «инструментов много, задумка не очевидна»): ONE entry per tool — every page of
 * the nav plus the main cards — keyed by a tool id. Three consumers read it, so the texts never drift apart:
 *   - the «?» popover (components/shared/tool-help.tsx) on a page header, a dashboard tile or a card;
 *   - the daily-loop tour (lib/onboarding/model tourSteps → components/onboarding/tour.tsx);
 *   - «Справочник» (/guide, pages/guide.tsx): every tool grouped by the daily loop, searchable.
 * Texts live in the `help` namespace (i18n/locales/<lang>/help.ts → entries.<id>.{what, why, read, example}); a page's
 * title is its nav name (shell `nav.<id>`), a card's title is `help` `titles.<id>`. This module is pure: ids, the loop
 * phase, the place a tool lives (`href` — the same as nav.ts for a page, checked by registry.test.ts), what it leads
 * to next in the day, and who may see it.
 */
import type { NavKey } from "@/i18n/ns/shell";

/** Cards and blocks that are not pages of their own (a page's id is its nav key). */
export const WIDGET_IDS = [
  "dayState", "attention", "dayLine", "mentorLine", "regime", "checkin", "brief", "macro", "easyMoney",
  "liveTrades", "positions", "recentTrades", "riskSignals", "leakGuard", "tradeFacets",
  "equity", "edgeTiles", "leaks", "dna", "psychology", "sectors", "deskPulse", "deskToday", "juniorCost",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export type HelpId = NavKey | WidgetId;

/**
 * Groups of «Справочник», in the order of the trader's day: the home screen, before the open, the session, after the
 * close, the week and the season; then what is used around the loop (market, learning, team), staff work, the account.
 */
export const HELP_PHASES = ["day", "premarket", "session", "close", "weekly", "market", "learn", "team", "staff", "account"] as const;
export type HelpPhase = (typeof HELP_PHASES)[number];

export type HelpEntry = {
  phase: HelpPhase;
  /** Where the tool lives (a page: its nav href; a card: the page it sits on). The «Открыть» link and the gating. */
  href: string;
  /** What it leads to next in the day (1–2 tools): the «Дальше» links of the popover and the guide. */
  next: readonly HelpId[];
  /** Curators and admins only. */
  staff?: boolean;
  /** Seniors and staff only (a card the server shows from «Сеньор» up). */
  seniorUp?: boolean;
  /** A page kept for old links (not listed in the guide; its «?» still works). */
  legacy?: boolean;
};

const page = (phase: HelpPhase, href: string, next: readonly HelpId[], extra: Partial<HelpEntry> = {}): HelpEntry => ({ phase, href, next, ...extra });

export const HELP: Readonly<Record<HelpId, HelpEntry>> = {
  // ─── The home screen ────────────────────────────────────────────────────────
  dashboard: page("day", "/", ["gamePlan", "journal"]),
  dayState: page("day", "/", ["attention", "risk"]),
  attention: page("day", "/", ["gamePlan", "journal"]),
  dayLine: page("day", "/", ["gamePlan", "ratings"]),
  mentorLine: page("day", "/", ["coach"]),
  notifications: page("day", "/notifications", ["dashboard"]),
  // ─── Before the open ────────────────────────────────────────────────────────
  gamePlan: page("premarket", "/game-plan", ["riskSignals", "trades"]),
  regime: page("premarket", "/game-plan", ["gamePlan", "risk"]),
  checkin: page("premarket", "/", ["gamePlan", "psychology"]),
  brief: page("premarket", "/", ["gamePlan", "watchlist"]),
  macro: page("premarket", "/", ["events", "gamePlan"]),
  coach: page("premarket", "/coach", ["gamePlan", "journal"]),
  easyMoney: page("premarket", "/game-plan", ["gamePlan", "seasonReport"], { seniorUp: true }),
  // ─── The session ────────────────────────────────────────────────────────────
  trades: page("session", "/trades", ["journal", "chartLab"]),
  liveTrades: page("session", "/trades", ["riskSignals", "risk"]),
  positions: page("session", "/", ["risk"]),
  recentTrades: page("session", "/", ["trades", "journal"]),
  risk: page("session", "/risk", ["riskSignals", "journal"]),
  riskSignals: page("session", "/", ["risk", "leakGuard"]),
  leakGuard: page("session", "/risk", ["risk", "behavior"]),
  // ─── After the close ────────────────────────────────────────────────────────
  journal: page("close", "/journal", ["dayReport", "weeklyReview"]),
  dayReport: page("close", "/day-report", ["journal", "whatIf"]),
  chartLab: page("close", "/chart-lab", ["journal", "playbook"]),
  tradeFacets: page("close", "/trades", ["whatIf", "stats"]),
  ask: page("close", "/ask", ["trades", "stats"]),
  rules: page("close", "/rules", ["journal", "whatIf"]),
  // ─── The week and the season ────────────────────────────────────────────────
  weeklyReview: page("weekly", "/weekly-review", ["playbook", "gamePlan"]),
  myReview: page("weekly", "/my-review", ["gamePlan", "analytics"]),
  seasonReport: page("weekly", "/season-report", ["playbook"]),
  analytics: page("weekly", "/analytics", ["whatIf", "behavior"]),
  stats: page("weekly", "/stats", ["tradeFacets", "analytics"]),
  behavior: page("weekly", "/behavior", ["whatIf", "coach"]),
  whatIf: page("weekly", "/what-if", ["gamePlan", "rules"]),
  edgeTiles: page("weekly", "/", ["tradeFacets", "whatIf"]),
  leaks: page("weekly", "/", ["tradeFacets", "whatIf"]),
  equity: page("weekly", "/", ["stats", "analytics"]),
  dna: page("weekly", "/", ["indicators", "analytics"]),
  psychology: page("weekly", "/", ["checkin", "coach"]),
  playbook: page("weekly", "/playbook", ["gamePlan", "chartLab"]),
  // ─── Market ─────────────────────────────────────────────────────────────────
  events: page("market", "/events", ["gamePlan", "watchlist"]),
  analystActions: page("market", "/analyst-actions", ["gamePlan", "watchlist"]),
  offerings: page("market", "/offerings", ["watchlist", "gamePlan"]),
  themes: page("market", "/themes", ["watchlist", "gamePlan"]),
  watchlist: page("market", "/watchlist", ["gamePlan"]),
  big7: page("market", "/big7", ["gamePlan", "deskPulse"]),
  sectors: page("market", "/", ["themes", "gamePlan"]),
  indicators: page("market", "/indicators", ["regime", "analytics"]),
  calculator: page("market", "/calculator", ["watchlist"]),
  deskPulse: page("market", "/big7", ["gamePlan", "seasonReport"]),
  // ─── Learning ───────────────────────────────────────────────────────────────
  academyMy: page("learn", "/academy/my", ["academyLearn", "academyPath"]),
  academyLearn: page("learn", "/academy/learn", ["trainer", "academyPath"]),
  academyPath: page("learn", "/academy/path", ["academyChallenges", "academyMy"]),
  academyChallenges: page("learn", "/academy/challenges", ["academyPath"]),
  academyCohorts: page("learn", "/academy/cohorts", ["academyMy"]),
  trainer: page("learn", "/trainer", ["playbook", "academyPath"]),
  guide: page("learn", "/guide", ["dashboard"]),
  // ─── Team ───────────────────────────────────────────────────────────────────
  discussions: page("team", "/discussions", ["ideas"]),
  ideas: page("team", "/trade-ideas", ["ideaStats", "gamePlan"]),
  ideaStats: page("team", "/trade-idea-stats", ["ideas"]),
  ratings: page("team", "/ratings", ["academyPath", "dayLine"]),
  benchmark: page("team", "/benchmark", ["analytics", "ratings"]),
  topResults: page("team", "/top-results", ["chartLab"]),
  office: page("team", "/office", ["benchmark"]),
  dailyFeed: page("team", "/dailyfeed", ["discussions"]),
  authorNotes: page("team", "/author-notes", ["gamePlan"]),
  activity: page("team", "/activity", ["notifications"], { legacy: true }),
  juniorNotes: page("team", "/junior-notes", ["journal"], { legacy: true }),
  // ─── Staff ──────────────────────────────────────────────────────────────────
  curator: page("staff", "/curator", ["journal", "academyMentor"], { staff: true }),
  deskToday: page("staff", "/", ["risk", "curator"], { staff: true }),
  academyMentor: page("staff", "/academy/mentor", ["curator", "academyCohorts"], { staff: true }),
  scaling: page("staff", "/scaling", ["academyPath", "curator"], { staff: true }),
  admin: page("staff", "/admin", ["integrations", "scaling"], { staff: true }),
  integrations: page("staff", "/integrations", ["trades"], { staff: true }),
  academyContent: page("staff", "/academy/content-admin", ["academyLearn"], { staff: true }),
  juniorCost: page("staff", "/office", ["curator", "academyPath"], { staff: true }),
  // ─── Account ────────────────────────────────────────────────────────────────
  profile: page("account", "/profile", ["academyPath", "settings"]),
  settings: page("account", "/settings", ["profile"]),
};

export const HELP_IDS = Object.keys(HELP) as HelpId[];

const WIDGETS = new Set<string>(WIDGET_IDS);
/** A card (title from `help` titles.<id>) rather than a page (title from the shell nav). */
export function isWidget(id: HelpId): id is WidgetId {
  return WIDGETS.has(id);
}

export function isHelpId(v: unknown): v is HelpId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(HELP, v);
}

/** Who is looking: the role, the ladder tier, and whether a section is open to them (nav-model navItemOpen). */
export type HelpViewer = { isCurator: boolean; tier?: string | null; canOpen: (href: string) => boolean };

/** May this viewer see the tool (staff-only, from «Сеньор» up, a section closed for the stage)? */
export function helpVisible(id: HelpId, v: HelpViewer): boolean {
  const e = HELP[id];
  if (e.staff && !v.isCurator) return false;
  if (e.seniorUp && !v.isCurator && v.tier !== "senior" && v.tier !== "lead") return false;
  return v.canOpen(e.href);
}

/** The «Дальше» links this viewer can follow. */
export function nextFor(id: HelpId, v: HelpViewer): HelpId[] {
  return HELP[id].next.filter((n) => n !== id && helpVisible(n, v));
}

/** The guide: phases in loop order, each with its visible tools (legacy pages left out). */
export function guideGroups(v: HelpViewer): { phase: HelpPhase; ids: HelpId[] }[] {
  return HELP_PHASES.map((phase) => ({
    phase,
    ids: HELP_IDS.filter((id) => HELP[id].phase === phase && !HELP[id].legacy && helpVisible(id, v)),
  })).filter((g) => g.ids.length);
}

/** Search: every word of the query must be found in the tool's texts (case- and ё-insensitive). */
export function matchesQuery(haystack: string, query: string): boolean {
  const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, "е"); // i18n-ignore (search folding)
  const h = norm(haystack);
  return norm(query).split(/\s+/).filter(Boolean).every((w) => h.includes(w));
}
