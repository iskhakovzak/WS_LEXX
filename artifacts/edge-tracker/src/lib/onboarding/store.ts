/**
 * Onboarding state for the signed-in person: the stored block (users.settings.onboarding), the server's stage and
 * checklist signals (GET /api/users/me/onboarding), and this load's mode (./model onboardingMode). One small external
 * store, so the tour (layout), the checklist (dashboard) and page hints (pages) read the same thing.
 *
 * A per-user localStorage copy renders the right state at once (no hint flashing in and out while the server answers);
 * with no copy yet nothing automatic shows until the server has answered. Writes are optimistic: memory + local copy
 * first, then PUT /api/users/me/settings { onboarding } (a failed write keeps the local copy; the next one retries).
 */
import { useSyncExternalStore } from "react";
import { http } from "@/lib/api/http";
import {
  EMPTY_STATE, onboardingMode, parseState, parseStatus, withHint, withSeen,
  type HintId, type Mode, type OnboardingState, type OnboardingStatus, type SeenKey, type ShowEnv,
} from "./model";

const SETTINGS_API = "/api/users/me/settings";
const STATUS_API = "/api/users/me/onboarding";
const LOCAL_KEY = "ws_lexx_onboarding";
/** Window event: open «Помощь» (user menu, palette, the «?» list). */
export const OPEN_HELP_EVENT = "ws-open-help";

export type OnboardingSnapshot = {
  user: string | null;
  /** The stored block (what the person has seen / dismissed). */
  state: OnboardingState;
  status: OnboardingStatus | null;
  /** True once the stored block is known (local copy or server). */
  ready: boolean;
  mode: Mode;
  /** Bumped by «Пройти знакомство заново»: the tour host starts the tour on the dashboard. */
  tourRequest: number;
  /** A hint re-opened from «?» or «Помощь» (shown even if seen). */
  reopen: { id: HintId; n: number } | null;
};

let snap: OnboardingSnapshot = { user: null, state: EMPTY_STATE, status: null, ready: false, mode: "off", tourRequest: 0, reopen: null };
const listeners = new Set<() => void>();
let generation = 0;

function emit(next: Partial<OnboardingSnapshot>) {
  snap = { ...snap, ...next };
  for (const l of listeners) l();
}

function readLocal(user: string): { state: OnboardingState; status: OnboardingStatus | null } | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const p = raw ? (JSON.parse(raw) as { user?: string; state?: unknown; status?: unknown }) : null;
    return p && p.user === user ? { state: parseState(p.state), status: parseStatus(p.status) } : null;
  } catch {
    return null;
  }
}

function writeLocal() {
  if (!snap.user) return;
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ user: snap.user, state: snap.state, status: snap.status })); } catch { /* storage unavailable */ }
}

export function readShowEnv(): ShowEnv {
  let introOff = false;
  try { introOff = localStorage.getItem("ws_lexx_intro") === "off"; } catch { /* blocked */ }
  return {
    search: window.location.search,
    automated: navigator.webdriver === true,
    printing: typeof window.matchMedia === "function" && window.matchMedia("print").matches,
    introOff,
    dev: import.meta.env.DEV === true,
  };
}

/** Start (or switch) the store for a signed-in member; null / a guest clears it. Mode is decided once per load. */
export function startOnboarding(user: string | null, opts: { guest: boolean }): void {
  const gen = ++generation;
  if (!user || opts.guest) {
    emit({ user: null, state: EMPTY_STATE, status: null, ready: false, mode: "off", reopen: null });
    return;
  }
  const local = readLocal(user);
  emit({ user, state: local?.state ?? EMPTY_STATE, status: local?.status ?? null, ready: !!local, mode: onboardingMode(readShowEnv()) });
  void Promise.all([
    http.get<{ settings?: { onboarding?: unknown } } | null>(SETTINGS_API).then((r) => parseState(r?.settings?.onboarding)),
    http.get<unknown>(STATUS_API).then(parseStatus).catch(() => null),
  ]).then(([state, status]) => {
    if (gen !== generation) return;
    emit({ state, status: status ?? snap.status, ready: true });
    writeLocal();
  }).catch(() => {
    if (gen === generation && !snap.ready) emit({ ready: !!local });
  });
}

/** Re-read the stage and checklist signals (after a step may have been done elsewhere). */
export function refreshOnboardingStatus(): void {
  if (!snap.user) return;
  const gen = generation;
  void http.get<unknown>(STATUS_API).then(parseStatus).then((status) => {
    if (gen !== generation || !status) return;
    emit({ status });
    writeLocal();
  }).catch(() => undefined);
}

function save(next: OnboardingState): void {
  if (!snap.user || next === snap.state) return;
  emit({ state: next });
  writeLocal();
  void http.put(SETTINGS_API, { onboarding: next }).catch(() => undefined);
}

export function finishTour(kind: "done" | "skipped"): void {
  save({ ...snap.state, tour: kind, tourAt: new Date().toISOString() });
}
export function dismissChecklist(kind: "done" | "dismissed" = "dismissed"): void {
  save({ ...snap.state, checklist: kind });
}
export function markHintSeen(id: HintId): void {
  save(withHint(snap.state, id));
  if (snap.reopen?.id === id) emit({ reopen: null });
}
export function markSeen(key: SeenKey): void {
  save(withSeen(snap.state, key));
}
export function requestTour(): void {
  emit({ tourRequest: snap.tourRequest + 1 });
}
export function reopenHint(id: HintId): void {
  emit({ reopen: { id, n: (snap.reopen?.n ?? 0) + 1 } });
}
export function openHelp(): void {
  window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT));
}

/** Admin → Люди: the tour, checklist and hints start again for that person (POST /api/users/:id/onboarding/reset). */
export async function resetOnboardingFor(userId: number): Promise<void> {
  await http.post(`/api/users/${userId}/onboarding/reset`, {});
}

export function getOnboarding(): OnboardingSnapshot {
  return snap;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useOnboarding(): OnboardingSnapshot {
  return useSyncExternalStore(subscribe, getOnboarding, getOnboarding);
}
