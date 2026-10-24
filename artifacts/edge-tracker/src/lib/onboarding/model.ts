/**
 * First-visit onboarding — the pure model (no DOM, no React): the stored block, who sees what, the tour per role and
 * the «Первые шаги» checklist. UI: components/onboarding/*, components/shared/page-hint.tsx; state: ./store.ts.
 *
 * Stored per user in `users.settings.onboarding` (PUT /api/users/me/settings), mirrored by the API's
 * lib/people/onboarding.ts. The «new user» rule is the server's (GET /api/users/me/onboarding → stage):
 *   new       no closed day, < 5 active days, account < 45 days → tour (once), checklist, page hints on first open
 *   settling  < 10 closed days and < 20 active days → page hints on first open only
 *   settled   heavy users → nothing automatic («?» buttons and «Помощь» still work)
 * An admin reset (Admin → Люди → «Сбросить знакомство») sets `again`: tour + checklist + hints as for a new user.
 *
 * Never automatic (same rules as the welcome intro, lib/welcome-intro.ts): print, automation (navigator.webdriver:
 * headless recording / e2e), the per-browser switch localStorage ws_lexx_intro = "off", `?intro=0` or `?onboarding=0`.
 * `?onboarding=1` forces everything for review — in the dev build only. The tour itself starts only on the dashboard
 * root with no query (a deep link goes straight to its content).
 */
import { z } from "zod";

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

/** Start the tour on this screen now? Only on the dashboard root, with no deep-link query, once. */
export function shouldStartTour(i: ShowInput & { path: string; search: string }): boolean {
  if (!isNewcomer(i)) return false;
  if (!ROOT_PATHS.has(i.path)) return false;
  if (i.mode === "force") return true;
  if (i.search.replace(/^\?/, "") !== "") return false;
  return i.state.tour == null;
}

/** Open a page hint on its own (first visit of the page)? */
export function shouldAutoHint(i: ShowInput & { id: HintId }): boolean {
  if (i.mode === "force") return true;
  if (i.mode === "off" || i.stage == null) return false;
  if (i.state.hints?.includes(i.id)) return false;
  return i.stage !== "settled" || i.state.again === true;
}

// ─── Tour ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TourRole = "junior" | "trader" | "curator" | "admin";
export type StepId = "hero" | "next" | "loop" | "risk" | "palette" | "look" | "curator" | "people" | "riskDesk";

/** Juniors: the daily loop first; curators: the cabinet and the queue; admins: people, settings, the risk desk. */
export const TOURS: Readonly<Record<TourRole, readonly StepId[]>> = {
  junior: ["hero", "loop", "next", "risk", "look"],
  trader: ["hero", "next", "loop", "risk", "palette", "look"],
  curator: ["hero", "curator", "next", "riskDesk", "palette", "look"],
  admin: ["hero", "people", "riskDesk", "curator", "palette", "look"],
};

export function tourRole(role: string | null | undefined, tier: string | null | undefined): TourRole {
  if (role === "admin") return "admin";
  if (role === "curator") return "curator";
  return tier === "trainee" || tier === "junior" ? "junior" : "trader";
}

/** Section a step points at: the step is dropped when the viewer cannot open it (stage-blocked, staff-only). */
const STEP_SECTION: Partial<Record<StepId, string>> = { curator: "/curator", people: "/admin", riskDesk: "/risk", risk: "/risk", loop: "/game-plan" };

const sidebarLink = (href: string) => `[data-sidebar="sidebar"] a[href$="${href}"]`;
const DOCK = '[data-tour="dock"]';
const DOCK_MORE = '[data-tour="dock"] li:last-child button';
const USER_MENU = '[data-i18n-focus="user-menu"]';

/**
 * CSS selectors per step, tried in order; the first one that is on screen is the anchor. None visible (a collapsed
 * group, a phone without that element) → the card is centred with no spotlight. Phone steps point at the bottom dock.
 */
const ANCHORS: Readonly<Record<StepId, { desktop: readonly string[]; phone: readonly string[] }>> = {
  hero: { desktop: ['[data-tour="hero"]', 'section[aria-labelledby="dash-hero-title"]'], phone: ['[data-tour="hero"]', 'section[aria-labelledby="dash-hero-title"]'] },
  next: { desktop: ['[data-tour="attention"]'], phone: ['[data-tour="next-step"]', '[data-tour="attention"]'] },
  loop: { desktop: ['[data-tour="nav"]', '[data-sidebar="sidebar"]'], phone: [DOCK] },
  risk: { desktop: ['[data-tour="risk"]', sidebarLink("/risk")], phone: ['[data-tour="risk"]', `${DOCK} a[href$="/risk"]`] },
  palette: { desktop: ['[data-tour="palette"]'], phone: ['[data-tour="palette"]'] },
  look: { desktop: ['[data-tour="look"]', USER_MENU], phone: [USER_MENU] },
  curator: { desktop: [sidebarLink("/curator"), '[data-tour="nav"]'], phone: [DOCK_MORE, DOCK] },
  people: { desktop: [sidebarLink("/admin"), '[data-tour="nav"]'], phone: [DOCK_MORE, DOCK] },
  riskDesk: { desktop: [sidebarLink("/risk"), '[data-tour="risk"]'], phone: [`${DOCK} a[href$="/risk"]`, '[data-tour="risk"]'] },
};

export function anchorsFor(step: StepId, phone: boolean): readonly string[] {
  return phone ? ANCHORS[step].phone : ANCHORS[step].desktop;
}

/** Copy key under `tour.steps` (the phone variant names the place on a phone; juniors get the loop in their words). */
export type StepCopy =
  | "hero" | "next" | "loop" | "loopJunior" | "risk" | "palette" | "palettePhone" | "look" | "lookPhone"
  | "curator" | "curatorPhone" | "people" | "peoplePhone" | "riskDesk";

export function stepCopy(step: StepId, role: TourRole, phone: boolean): StepCopy {
  if (step === "loop") return role === "junior" ? "loopJunior" : "loop";
  if (phone && step === "palette") return "palettePhone";
  if (phone && step === "look") return "lookPhone";
  if (phone && step === "curator") return "curatorPhone";
  if (phone && step === "people") return "peoplePhone";
  return step;
}

export type TourStep = { id: StepId; copy: StepCopy; anchors: readonly string[] };

/** The tour for this viewer: 4–6 steps, those pointing at a section they cannot open left out. */
export function tourSteps(role: TourRole, phone: boolean, canOpen: (href: string) => boolean = () => true): TourStep[] {
  return TOURS[role]
    .filter((id) => { const s = STEP_SECTION[id]; return !s || canOpen(s); })
    .map((id) => ({ id, copy: stepCopy(id, role, phone), anchors: anchorsFor(id, phone) }));
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
