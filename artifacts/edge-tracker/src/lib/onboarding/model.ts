/**
 * First-visit onboarding — the pure model (no DOM, no React): the stored block, who sees what, the tour per role and
 * the «Первые шаги» checklist. UI: components/onboarding/*, components/shared/page-hint.tsx; state: ./store.ts.
 *
 * Stored per user in `users.settings.onboarding` (PUT /api/users/me/settings), mirrored by the API's
 * lib/people/onboarding.ts. The «new user» rule is the server's (GET /api/users/me/onboarding → stage):
 *   new       no closed day, < 5 active days, account < 45 days → checklist, page hints on first open
 *   settling  < 10 closed days and < 20 active days → page hints on first open only
 *   settled   heavy users → no hints («?» buttons, «Справочник» and «Помощь» still work)
 * The daily-loop tour is for everyone, once per stage (`loops`, see «Tour» below), whatever the server's stage.
 * An admin reset (Admin → Люди → «Сбросить знакомство») sets `again` and clears `loops`: everything as for a new user.
 *
 * Never automatic (same rules as the welcome intro, lib/welcome-intro.ts): print, automation (navigator.webdriver:
 * headless recording / e2e), the per-browser switch localStorage ws_lexx_intro = "off", `?intro=0` or `?onboarding=0`.
 * `?onboarding=1` forces everything for review — in the dev build only. The tour itself starts only on the dashboard
 * root with no query (a deep link goes straight to its content).
 */
import { z } from "zod";
import { HELP, helpVisible, type HelpId, type HelpPhase } from "@/lib/help/registry";

// ─── Stored block ──────────────────────────────────────────────────────────────────────────────────────────────────

const slug = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/);
export const OnboardingStateSchema = z.object({
  v: z.literal(1),
  tour: z.enum(["done", "skipped"]).optional(),
  tourAt: z.string().max(40).optional(),
  checklist: z.enum(["done", "dismissed"]).optional(),
  hints: z.array(slug).max(32).optional(),
  seen: z.array(slug).max(32).optional(),
  again: z.boolean().optional(),
  /** Tours finished or skipped, by stage / staff role (the daily-loop tour shows once per each). */
  loops: z.array(slug).max(8).optional(),
  /** The step a tour was left on (resumed there next time). */
  loopStep: z.object({ r: slug, i: z.number().int().min(0).max(31) }).optional(),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;
export const EMPTY_STATE: OnboardingState = { v: 1 };

/** A stored value → a valid block (anything unreadable starts empty). */
export function parseState(raw: unknown): OnboardingState {
  const r = OnboardingStateSchema.safeParse(raw);
  return r.success ? r.data : EMPTY_STATE;
}

// ─── Server status ─────────────────────────────────────────────────────────────────────────────────────────────────

export type Stage = "new" | "settling" | "settled";
export type Signals = { secret: boolean; quickCode: boolean; look: boolean; telegram: boolean; plan: boolean; closedDay: boolean };
export type OnboardingStatus = { stage: Stage; closedDays: number; activeDays: number; accountDays: number; signals: Signals | null };

const StatusSchema = z.object({
  stage: z.enum(["new", "settling", "settled"]),
  closedDays: z.number(),
  activeDays: z.number(),
  accountDays: z.number(),
  signals: z.object({
    secret: z.boolean(), quickCode: z.boolean().default(false), look: z.boolean(), telegram: z.boolean(), plan: z.boolean(), closedDay: z.boolean(),
  }).nullable(),
});
export function parseStatus(raw: unknown): OnboardingStatus | null {
  const r = StatusSchema.safeParse(raw);
  return r.success ? r.data : null;
}

// ─── When anything shows ───────────────────────────────────────────────────────────────────────────────────────────

export interface ShowEnv {
  /** location.search */
  search: string;
  /** navigator.webdriver */
  automated: boolean;
  /** matchMedia("print").matches */
  printing: boolean;
  /** localStorage ws_lexx_intro === "off" (demo / recording machines) */
  introOff: boolean;
  /** import.meta.env.DEV — `?onboarding=1` works in the dev build only */
  dev: boolean;
}

export type Mode = "force" | "off" | "auto";

/** «force» (dev `?onboarding=1`), «off» (never automatic on this load) or «auto». */
export function onboardingMode(env: ShowEnv): Mode {
  const q = new URLSearchParams(env.search);
  const ob = q.get("onboarding");
  if (env.dev && (ob === "1" || ob === "on")) return "force";
  const intro = q.get("intro");
  if (ob === "0" || ob === "off" || intro === "0" || intro === "off") return "off";
  if (env.printing || env.automated || env.introOff) return "off";
  return "auto";
}

export type ShowInput = { mode: Mode; stage: Stage | null; state: OnboardingState };

/** Tour + checklist audience: new by the rule, brought back by an admin, or forced for review. */
export function isNewcomer({ mode, stage, state }: ShowInput): boolean {
  if (mode === "force") return true;
  if (mode === "off") return false;
  return stage === "new" || state.again === true;
}

const ROOT_PATHS = new Set(["", "/"]);

/**
 * Start the daily-loop tour on this screen now? Once per user and stage, for everyone (not only newcomers): on the
 * dashboard root with no deep-link query, never on an "off" load. A tour left half-way resumes (resumeIndex).
 */
export function shouldStartTour(i: { mode: Mode; state: OnboardingState; path: string; search: string; role: TourRole }): boolean {
  if (i.mode === "off") return false;
  if (!ROOT_PATHS.has(i.path)) return false;
  if (i.mode === "force") return true;
  if (i.search.replace(/^\?/, "") !== "") return false;
  return !tourSeen(i.state, i.role);
}

/** Open a page hint on its own (first visit of the page)? */
export function shouldAutoHint(i: ShowInput & { id: HintId }): boolean {
  if (i.mode === "force") return true;
  if (i.mode === "off" || i.stage == null) return false;
  if (i.state.hints?.includes(i.id)) return false;
  return i.stage !== "settled" || i.state.again === true;
}

// ─── Tour: the daily loop ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Owner, 2026-10-30: the tour walks the DAILY LOOP — which tool when: the home screen → the plan before the open →
 * the session (trades from PropReports, live risk signals) → «Закрыть день» after the close → the week / season → the
 * guide. One tour per stage (Джун, Трейдер, Сеньор) and per staff role; each step is a help registry entry
 * (lib/help/registry), so its title and lines are the same as the tool's «?». Shown once per user and stage (a
 * promotion brings the next stage's tour once), skippable, resumable at the step it was left on, re-launchable from
 * «Помощь» and «Справочник».
 */
export type TourRole = "junior" | "trader" | "senior" | "curator" | "admin";
export const TOUR_ROLES: readonly TourRole[] = ["junior", "trader", "senior", "curator", "admin"];

export const TOURS: Readonly<Record<TourRole, readonly HelpId[]>> = {
  junior: ["dashboard", "gamePlan", "trades", "riskSignals", "journal", "trainer", "guide"],
  trader: ["dashboard", "gamePlan", "trades", "riskSignals", "risk", "journal", "weeklyReview", "guide"],
  senior: ["dashboard", "gamePlan", "easyMoney", "trades", "riskSignals", "journal", "seasonReport", "guide"],
  curator: ["dashboard", "gamePlan", "risk", "curator", "academyMentor", "weeklyReview", "guide"],
  admin: ["dashboard", "risk", "curator", "admin", "integrations", "scaling", "guide"],
};

/** The server's effective role and ladder tier → the tour (lead counts as senior; no tier yet = Джун). */
export function tourRole(role: string | null | undefined, tier: string | null | undefined): TourRole {
  if (role === "admin") return "admin";
  if (role === "curator") return "curator";
  if (tier === "senior" || tier === "lead") return "senior";
  if (tier === "trader") return "trader";
  return "junior";
}

const sidebarLink = (href: string) => `[data-sidebar="sidebar"] a[href$="${href}"]`;
const DOCK = '[data-tour="dock"]';
const DOCK_MORE = '[data-tour="dock"] li:last-child button';
const USER_MENU = '[data-i18n-focus="user-menu"]';
const HERO = ['[data-tour="hero"]', 'section[aria-labelledby="dash-hero-title"]'];

/**
 * CSS selectors per step, tried in order; the first one on screen is the anchor. A card on the dashboard marks itself
 * with `data-help-anchor="<id>"`; a page is its sidebar link (the bottom dock or «Ещё» on a phone). Nothing visible (a
 * folded group, a phone without that element) → the card is centred with no spotlight.
 */
export function anchorsFor(id: HelpId, phone: boolean): readonly string[] {
  if (id === "dashboard") return HERO;
  const own = `[data-help-anchor="${id}"]`;
  const href = HELP[id].href;
  // A dashboard card: itself, or (the risk signals strip shows only with an alert) the hero's «left to stop» cell.
  if (href === "/") return id === "riskSignals" ? [own, '[data-tour="risk"]'] : [own];
  if (id === "guide") return phone ? [own, USER_MENU] : [own, sidebarLink(href), USER_MENU];
  return phone ? [own, `${DOCK} a[href$="${href}"]`, DOCK_MORE] : [own, sidebarLink(href), '[data-tour="nav"]'];
}

export type TourStep = { id: HelpId; phase: HelpPhase; anchors: readonly string[] };

/**
 * The tour for this viewer: 7–8 steps, those the viewer cannot see left out (a section closed for the stage, a
 * staff-only page) — the tour never points at a hidden section.
 */
export function tourSteps(role: TourRole, phone: boolean, canOpen: (href: string) => boolean = () => true): TourStep[] {
  const viewer = { isCurator: role === "curator" || role === "admin", tier: role === "senior" ? "senior" : role, canOpen };
  return TOURS[role]
    .filter((id) => helpVisible(id, viewer))
    .map((id) => ({ id, phase: HELP[id].phase, anchors: anchorsFor(id, phone) }));
}

/** Where to start: the step this stage's tour was left on (a fresh start otherwise), clamped to the steps there are. */
export function resumeIndex(state: OnboardingState, role: TourRole, total: number): number {
  const at = state.loopStep;
  if (!at || at.r !== role || total <= 0) return 0;
  return Math.max(0, Math.min(at.i, total - 1));
}

/** Has this stage's tour been finished or skipped? */
export function tourSeen(state: OnboardingState, role: TourRole): boolean {
  return state.loops?.includes(role) ?? false;
}

export function withTourStep(state: OnboardingState, role: TourRole, i: number): OnboardingState {
  if (state.loopStep?.r === role && state.loopStep.i === i) return state;
  return { ...state, loopStep: { r: role, i: Math.max(0, Math.min(31, Math.round(i))) } };
}

export function withTourFinished(state: OnboardingState, role: TourRole, kind: "done" | "skipped", at: string): OnboardingState {
  const loops = state.loops?.includes(role) ? state.loops : [...(state.loops ?? []), role];
  const { loopStep: _left, ...rest } = state;
  return { ...rest, tour: kind, tourAt: at, loops };
}

/** Keyboard: → / Enter next, ← back, Esc skip; anything else is not the tour's. */
export function tourKey(key: string): "next" | "back" | "skip" | null {
  if (key === "ArrowRight" || key === "Enter") return "next";
  if (key === "ArrowLeft") return "back";
  if (key === "Escape" || key === "Esc") return "skip";
  return null;
}

export type Rect = { top: number; left: number; width: number; height: number };
export type Placement = { kind: "anchored"; side: "top" | "bottom" | "left" | "right"; top: number; left: number } | { kind: "center" };

/**
 * Where the step card goes next to the anchor (viewport px). A sidebar link gets it on its right; anything else
 * prefers below, then above, right, left; clamped to a
 * margin; a phone keeps the card clear of the bottom dock (`bottomInset`). No anchor → centred.
 */
export function placeCard(anchor: Rect | null, card: { width: number; height: number }, vp: { width: number; height: number; bottomInset?: number }, gap = 12, margin = 12): Placement {
  if (!anchor) return { kind: "center" };
  const bottomLimit = vp.height - (vp.bottomInset ?? 0) - margin;
  const clampX = (x: number) => Math.max(margin, Math.min(x, vp.width - card.width - margin));
  const clampY = (y: number) => Math.max(margin, Math.min(y, bottomLimit - card.height));
  const cx = anchor.left + anchor.width / 2 - card.width / 2;
  const cy = anchor.top + anchor.height / 2 - card.height / 2;
  const right = anchor.left + anchor.width + gap;
  // A narrow anchor hugging the left edge (a sidebar link): the card goes beside it, not over the menu below.
  if (anchor.left + anchor.width < vp.width * 0.3 && right + card.width <= vp.width - margin) {
    return { kind: "anchored", side: "right", top: clampY(cy), left: right };
  }
  const below = anchor.top + anchor.height + gap;
  if (below + card.height <= bottomLimit) return { kind: "anchored", side: "bottom", top: below, left: clampX(cx) };
  const above = anchor.top - gap - card.height;
  if (above >= margin) return { kind: "anchored", side: "top", top: above, left: clampX(cx) };
  if (right + card.width <= vp.width - margin) return { kind: "anchored", side: "right", top: clampY(cy), left: right };
  const left = anchor.left - gap - card.width;
  if (left >= margin) return { kind: "anchored", side: "left", top: clampY(cy), left };
  // A huge anchor (the whole sidebar on a short screen): lay the card over its lower part.
  return { kind: "anchored", side: "bottom", top: clampY(bottomLimit - card.height), left: clampX(cx) };
}

// ─── «Первые шаги» ─────────────────────────────────────────────────────────────────────────────────────────────────

export type ChecklistId = "secret" | "quickCode" | "look" | "telegram" | "plan" | "closeDay" | "trade" | "playbook";
export type ChecklistItem = { id: ChecklistId; done: boolean };
/** Things the web notices on the way (no table holds them): the first trade card opened, the playbook opened. */
export type SeenKey = "trade" | "playbook";

/** Ticked from real data only. The secret step is the screen lock's quick code once the server has it. */
export function checklistItems(signals: Signals | null, state: OnboardingState): ChecklistItem[] {
  const seen = new Set(state.seen ?? []);
  const s = signals;
  return [
    s?.quickCode ? { id: "quickCode", done: s.secret } : { id: "secret", done: !!s?.secret },
    { id: "look", done: !!s?.look },
    { id: "telegram", done: !!s?.telegram },
    { id: "plan", done: !!s?.plan },
    { id: "closeDay", done: !!s?.closedDay },
    { id: "trade", done: seen.has("trade") },
    { id: "playbook", done: seen.has("playbook") },
  ];
}

export function shouldShowChecklist(i: ShowInput & { items: readonly ChecklistItem[]; hasSignals: boolean }): boolean {
  if (!i.hasSignals || !isNewcomer(i)) return false;
  if (i.mode !== "force" && i.state.checklist != null) return false;
  return i.items.some((x) => !x.done);
}

/** Route → «seen» key: the playbook counts on opening it. */
export function seenFromPath(path: string): SeenKey | null {
  return path === "/playbook" || path.startsWith("/playbook/") ? "playbook" : null;
}

export function withSeen(state: OnboardingState, key: SeenKey): OnboardingState {
  if (state.seen?.includes(key)) return state;
  return { ...state, seen: [...(state.seen ?? []), key] };
}

// ─── Page hints ────────────────────────────────────────────────────────────────────────────────────────────────────

export const HINT_IDS = ["facets", "whatIf", "behavior", "analytics", "risk", "riskDesk", "academy"] as const;
export type HintId = (typeof HINT_IDS)[number];

/** Where each hint lives (the «Помощь» list opens it there); staff-only ones are left out for traders. */
export const HINT_PAGES: Readonly<Record<HintId, { href: string; staff?: boolean }>> = {
  facets: { href: "/trades" },
  whatIf: { href: "/what-if" },
  behavior: { href: "/behavior" },
  analytics: { href: "/analytics" },
  risk: { href: "/risk" },
  riskDesk: { href: "/risk", staff: true },
  academy: { href: "/academy/path" },
};

export function withHint(state: OnboardingState, id: HintId): OnboardingState {
  if (state.hints?.includes(id)) return state;
  return { ...state, hints: [...(state.hints ?? []), id] };
}
