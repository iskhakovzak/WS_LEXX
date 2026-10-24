import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE, TOURS, anchorsFor, checklistItems, isNewcomer, onboardingMode, parseState, parseStatus, placeCard, seenFromPath,
  shouldAutoHint, shouldShowChecklist, shouldStartTour, stepCopy, tourKey, tourRole, tourSteps, withHint, withSeen,
  type ShowEnv, type Signals,
} from "./model";
import ru from "@/i18n/locales/ru/onboarding";

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

  it("the tour starts once, on the dashboard root, never on a deep link", () => {
    const base = { mode: "auto" as const, stage: "new" as const, state: s, path: "/", search: "" };
    expect(shouldStartTour(base)).toBe(true);
    expect(shouldStartTour({ ...base, state: { v: 1, tour: "skipped" } })).toBe(false);
    expect(shouldStartTour({ ...base, path: "/trades" })).toBe(false);
    expect(shouldStartTour({ ...base, search: "?ny=2026-10-23" })).toBe(false);
    // An existing heavy user never sees it on the next visit.
    expect(shouldStartTour({ ...base, stage: "settled" })).toBe(false);
    expect(shouldStartTour({ ...base, mode: "force", state: { v: 1, tour: "done" }, search: "?onboarding=1" })).toBe(true);
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

describe("tour step model", () => {
  it("4–6 steps per role; juniors start with the daily loop, curators the cabinet, admins people and the risk desk", () => {
    for (const steps of Object.values(TOURS)) {
      expect(steps.length).toBeGreaterThanOrEqual(4);
      expect(steps.length).toBeLessThanOrEqual(6);
      expect(steps[0]).toBe("hero");
      expect(new Set(steps).size).toBe(steps.length);
    }
    expect(TOURS.junior[1]).toBe("loop");
    expect(TOURS.curator[1]).toBe("curator");
    expect(TOURS.admin.slice(1, 3)).toEqual(["people", "riskDesk"]);
  });

  it("role from the session role and the ladder tier", () => {
    expect(tourRole("trader", "trainee")).toBe("junior");
    expect(tourRole("trader", "junior")).toBe("junior");
    expect(tourRole("trader", "senior")).toBe("trader");
    expect(tourRole("trader", null)).toBe("trader");
    expect(tourRole("curator", null)).toBe("curator");
    expect(tourRole("admin", null)).toBe("admin");
  });

  it("drops a step whose section the viewer cannot open (stage-blocked risk, no curator cabinet)", () => {
    const ids = tourSteps("junior", false, (href) => href !== "/risk").map((s) => s.id);
    expect(ids).toEqual(["hero", "loop", "next", "look"]);
  });

  it("phone steps point at the bottom dock and name the place on a phone", () => {
    expect(anchorsFor("loop", true)).toEqual(['[data-tour="dock"]']);
    expect(anchorsFor("look", true)[0]).toBe('[data-i18n-focus="user-menu"]');
    expect(stepCopy("palette", "trader", true)).toBe("palettePhone");
    expect(stepCopy("loop", "junior", false)).toBe("loopJunior");
    expect(stepCopy("curator", "admin", false)).toBe("curator");
  });

  it("every step copy has a title and one sentence in the dictionary", () => {
    for (const role of Object.keys(TOURS) as (keyof typeof TOURS)[]) {
      for (const phone of [false, true]) {
        for (const s of tourSteps(role, phone)) {
          const c = ru.tour.steps[s.copy];
          expect(c.title.length, s.copy).toBeGreaterThan(3);
          expect(c.body.length, s.copy).toBeLessThan(160);
        }
      }
    }
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
