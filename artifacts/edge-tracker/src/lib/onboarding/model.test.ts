import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE, TOURS, TOUR_ROLES, anchorsFor, checklistItems, isNewcomer, onboardingMode, parseState, parseStatus, placeCard,
  resumeIndex, seenFromPath, shouldAutoHint, shouldShowChecklist, shouldStartTour, tourKey, tourRole, tourSeen, tourSteps,
  withHint, withSeen, withTourFinished, withTourStep,
  type ShowEnv, type Signals,
} from "./model";
import { HELP } from "@/lib/help/registry";

const env = (over: Partial<ShowEnv> = {}): ShowEnv => ({ search: "", automated: false, printing: false, introOff: false, dev: false, ...over });

describe("when onboarding may show (same rules as the welcome intro)", () => {
  it("auto by default; off in print, automation, the recording switch, ?intro=0 and ?onboarding=0", () => {
    expect(onboardingMode(env())).toBe("auto");
    expect(onboardingMode(env({ printing: true }))).toBe("off");
    expect(onboardingMode(env({ automated: true }))).toBe("off");
    expect(onboardingMode(env({ introOff: true }))).toBe("off");
    expect(onboardingMode(env({ search: "?intro=0" }))).toBe("off");
    expect(onboardingMode(env({ search: "?onboarding=0" }))).toBe("off");
  });
  it("?onboarding=1 forces it past every limit — in the dev build only", () => {
    expect(onboardingMode(env({ search: "?onboarding=1", dev: true, automated: true, introOff: true }))).toBe("force");
    expect(onboardingMode(env({ search: "?onboarding=1", dev: false }))).toBe("auto");
  });
});

describe("the «new user» audience", () => {
  const s = EMPTY_STATE;
  it("new by the server's stage, or brought back by an admin reset", () => {
    expect(isNewcomer({ mode: "auto", stage: "new", state: s })).toBe(true);
    expect(isNewcomer({ mode: "auto", stage: "settled", state: s })).toBe(false);
    expect(isNewcomer({ mode: "auto", stage: "settled", state: { v: 1, again: true } })).toBe(true);
    expect(isNewcomer({ mode: "auto", stage: null, state: s })).toBe(false);
    expect(isNewcomer({ mode: "off", stage: "new", state: s })).toBe(false);
  });

  it("page hints: new and settling people, once per page; heavy users only through «?»", () => {
    const h = { mode: "auto" as const, state: s, id: "analytics" as const };
    expect(shouldAutoHint({ ...h, stage: "new" })).toBe(true);
    expect(shouldAutoHint({ ...h, stage: "settling" })).toBe(true);
    expect(shouldAutoHint({ ...h, stage: "settled" })).toBe(false);
    expect(shouldAutoHint({ ...h, stage: "new", state: withHint(s, "analytics") })).toBe(false);
    expect(shouldAutoHint({ ...h, stage: null })).toBe(false);
  });
});

describe("the daily-loop tour", () => {
  const s = EMPTY_STATE;

  it("starts once per user and stage, on the dashboard root, never on a deep link or an «off» load", () => {
    const base = { mode: "auto" as const, state: s, path: "/", search: "", role: "trader" as const };
    expect(shouldStartTour(base)).toBe(true);
    expect(shouldStartTour({ ...base, path: "/trades" })).toBe(false);
    expect(shouldStartTour({ ...base, search: "?ny=2026-10-23" })).toBe(false);
    expect(shouldStartTour({ ...base, mode: "off" })).toBe(false);
    const done = withTourFinished(s, "trader", "skipped", "2026-10-30T12:00:00Z");
    expect(shouldStartTour({ ...base, state: done })).toBe(false);
    // A promotion brings the next stage's tour once; the old one-off tour flag does not block the new tour.
    expect(shouldStartTour({ ...base, state: done, role: "senior" })).toBe(true);
    expect(shouldStartTour({ ...base, state: { v: 1, tour: "done" } })).toBe(true);
    expect(shouldStartTour({ ...base, mode: "force", state: done, search: "?onboarding=1" })).toBe(true);
  });

  it("5–8 steps per role, each a help entry; the loop runs plan → session → close and ends at the guide", () => {
    for (const role of TOUR_ROLES) {
      const steps = TOURS[role];
      expect(steps.length, role).toBeGreaterThanOrEqual(5);
      expect(steps.length, role).toBeLessThanOrEqual(8);
      expect(steps[0]).toBe("dashboard");
      expect(steps[steps.length - 1]).toBe("guide");
      expect(new Set(steps).size).toBe(steps.length);
      for (const id of steps) expect(HELP[id], id).toBeTruthy();
    }
    for (const role of ["junior", "trader", "senior"] as const) {
      const order = TOURS[role].map((id) => HELP[id].phase);
      const at = (p: string) => order.indexOf(p as never);
      expect(at("premarket")).toBeLessThan(at("session"));
      expect(at("session")).toBeLessThan(at("close"));
      expect(TOURS[role]).toContain("riskSignals");
      expect(TOURS[role]).toContain("journal");
    }
    expect(TOURS.curator).toContain("curator");
    expect(TOURS.admin).toContain("admin");
  });

  it("role from the session role and the ladder tier", () => {
    expect(tourRole("trader", "trainee")).toBe("junior");
    expect(tourRole("trader", "junior")).toBe("junior");
    expect(tourRole("trader", null)).toBe("junior");
    expect(tourRole("trader", "trader")).toBe("trader");
    expect(tourRole("trader", "senior")).toBe("senior");
    expect(tourRole("trader", "lead")).toBe("senior");
    expect(tourRole("curator", null)).toBe("curator");
    expect(tourRole("admin", "senior")).toBe("admin");
  });

  it("skips every section closed for the stage — the tour never points at a hidden section", () => {
    const closed = new Set(["/trainer", "/risk", "/weekly-review"]);
    const canOpen = (href: string) => !closed.has(href);
    for (const role of TOUR_ROLES) {
      for (const phone of [false, true]) {
        const steps = tourSteps(role, phone, canOpen);
        for (const st of steps) expect(closed.has(HELP[st.id].href), `${role} ${st.id}`).toBe(false);
        expect(steps.length).toBeGreaterThanOrEqual(4);
      }
    }
    expect(tourSteps("junior", false, canOpen).map((st) => st.id)).toEqual(["dashboard", "gamePlan", "trades", "riskSignals", "journal", "guide"]);
    expect(tourSteps("trader", false, canOpen).map((st) => st.id)).not.toContain("risk");
  });

  it("staff-only and senior-only steps never reach a trader's tour", () => {
    for (const role of ["junior", "trader"] as const) {
      for (const st of tourSteps(role, false)) {
        expect(HELP[st.id].staff, st.id).toBeFalsy();
        expect(HELP[st.id].seniorUp, st.id).toBeFalsy();
      }
    }
    expect(tourSteps("senior", false).map((st) => st.id)).toContain("easyMoney");
  });

  it("a page step points at its sidebar link (the dock on a phone); a card at its own anchor", () => {
    expect(anchorsFor("gamePlan", false)).toContain('[data-sidebar="sidebar"] a[href$="/game-plan"]');
    expect(anchorsFor("gamePlan", true).some((a) => a.includes('[data-tour="dock"]'))).toBe(true);
    expect(anchorsFor("riskSignals", false)[0]).toBe('[data-help-anchor="riskSignals"]');
    expect(anchorsFor("dashboard", true)[0]).toBe('[data-tour="hero"]');
  });

  it("resumes at the step it was left on (same stage only), clamped", () => {
    const at3 = withTourStep(s, "trader", 3);
    expect(resumeIndex(at3, "trader", 8)).toBe(3);
    expect(resumeIndex(at3, "trader", 2)).toBe(1);
    expect(resumeIndex(at3, "senior", 8)).toBe(0);
    expect(withTourStep(at3, "trader", 3)).toBe(at3);
    const done = withTourFinished(at3, "trader", "done", "2026-10-30T12:00:00Z");
    expect(done.loopStep).toBeUndefined();
    expect(tourSeen(done, "trader")).toBe(true);
    expect(tourSeen(done, "junior")).toBe(false);
    expect(parseState(done)).toEqual(done);
  });

  it("keys: → / Enter next, ← back, Esc skip", () => {
    expect(tourKey("ArrowRight")).toBe("next");
    expect(tourKey("Enter")).toBe("next");
    expect(tourKey("ArrowLeft")).toBe("back");
    expect(tourKey("Escape")).toBe("skip");
    expect(tourKey("a")).toBeNull();
  });

  it("card placement: below, then above, then beside; centred without an anchor; clear of the phone dock", () => {
    const vp = { width: 1280, height: 800 };
    const card = { width: 320, height: 180 };
    expect(placeCard(null, card, vp)).toEqual({ kind: "center" });
    expect(placeCard({ top: 100, left: 100, width: 400, height: 200 }, card, vp)).toMatchObject({ side: "bottom", top: 312 });
    expect(placeCard({ top: 600, left: 100, width: 400, height: 150 }, card, vp)).toMatchObject({ side: "top", top: 408 });
    expect(placeCard({ top: 10, left: 10, width: 240, height: 780 }, card, vp)).toMatchObject({ side: "right", left: 262 });
    // A sidebar link: beside it, vertically centred on it.
    expect(placeCard({ top: 140, left: 14, width: 220, height: 36 }, card, vp)).toMatchObject({ side: "right", left: 246, top: 68 });
    const phone = placeCard({ top: 300, left: 10, width: 355, height: 120 }, card, { width: 375, height: 812, bottomInset: 80 });
    expect(phone.kind === "anchored" && phone.top + card.height).toBeLessThanOrEqual(812 - 80 - 12);
    // Never off the left / right edge.
    const edge = placeCard({ top: 100, left: 1200, width: 60, height: 40 }, card, vp);
    expect(edge.kind === "anchored" && edge.left + card.width).toBeLessThanOrEqual(1280 - 12);
  });
});

describe("«Первые шаги»", () => {
  const signals: Signals = { secret: true, quickCode: false, look: false, telegram: true, plan: false, closedDay: false };
  it("ticks only from real data and the web's own «seen» notes", () => {
    const items = checklistItems(signals, withSeen(EMPTY_STATE, "playbook"));
    expect(items.map((i) => i.id)).toEqual(["secret", "look", "telegram", "plan", "closeDay", "trade", "playbook"]);
    expect(items.filter((i) => i.done).map((i) => i.id)).toEqual(["secret", "telegram", "playbook"]);
  });
  it("the screen lock's quick code replaces the secret step once the server knows it", () => {
    expect(checklistItems({ ...signals, quickCode: true, secret: false }, EMPTY_STATE)[0]).toEqual({ id: "quickCode", done: false });
  });
  it("shows for newcomers until every step is done or it is hidden", () => {
    const items = checklistItems(signals, EMPTY_STATE);
    const base = { mode: "auto" as const, stage: "new" as const, state: EMPTY_STATE, items, hasSignals: true };
    expect(shouldShowChecklist(base)).toBe(true);
    expect(shouldShowChecklist({ ...base, state: { v: 1, checklist: "dismissed" } })).toBe(false);
    expect(shouldShowChecklist({ ...base, stage: "settled" })).toBe(false);
    expect(shouldShowChecklist({ ...base, hasSignals: false })).toBe(false);
    expect(shouldShowChecklist({ ...base, items: items.map((i) => ({ ...i, done: true })) })).toBe(false);
  });
  it("the playbook counts on opening it; «seen» is not duplicated", () => {
    expect(seenFromPath("/playbook")).toBe("playbook");
    expect(seenFromPath("/trades")).toBeNull();
    const once = withSeen(EMPTY_STATE, "trade");
    expect(withSeen(once, "trade")).toBe(once);
  });
});

describe("stored block and status parsing", () => {
  it("anything unreadable starts empty; the server status is validated", () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
    expect(parseState({ v: 1, tour: "nope" })).toEqual(EMPTY_STATE);
    expect(parseState({ v: 1, tour: "done", hints: ["risk"] })).toEqual({ v: 1, tour: "done", hints: ["risk"] });
    expect(parseStatus({ stage: "new", closedDays: 0, activeDays: 1, accountDays: 1, signals: null })?.stage).toBe("new");
    expect(parseStatus({ stage: "weird" })).toBeNull();
  });
});
