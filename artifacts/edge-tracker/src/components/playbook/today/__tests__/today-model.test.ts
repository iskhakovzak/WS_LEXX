// Rules of «Сегодня» (pure model): the NY clock and day map, the checklist grade, the size calculator, the edge summary,
// the «Сегодня торгую» prefill and the playbook mode from the URL.
import { describe, expect, it } from "vitest";
import {
  edgeSummary, firstTradingWindow, gradeOf, hm, hmText, matchSetup, minutesToOpen, nowMarker, nyNow, nyOverride, parseStop,
  sessionMinutes, sharesFor, starPick, suggestionSource, suggestPicks, togglePick, windowPhases, windowSetups,
} from "../today-model";
import { modeFromUrl } from "../mode-tabs";
import { today } from "./fixtures";

describe("clock", () => {
  it("parses and prints NY minutes", () => {
    expect(hm("09:30")).toBe(570);
    expect(hm("9:05 NY")).toBe(545);
    expect(hm("25:00")).toBeNull();
    expect(hm(null)).toBeNull();
    expect(hmText(570)).toBe("09:30");
  });
  it("the dev override works only in dev builds", () => {
    expect(nyOverride("?ny=08:45", true)).toBe(525);
    expect(nyOverride("?ny=08:45", false)).toBeNull();
    expect(nyOverride("?x=1", true)).toBeNull();
  });
  it("adds the minutes since the fetch", () => {
    expect(nyNow(600, 0, 5 * 60_000 + 10)).toBe(605);
  });
});

describe("day map", () => {
  const w = today().windows;
  it("morning: the open is next, the marker sits in the premarket", () => {
    const p = windowPhases(w, 525);
    expect(p).toEqual({ premarket: "now", open: "next", trend: "later", close: "later" });
    expect(nowMarker(w, 525)).toMatchObject({ key: "premarket", state: "in" });
    expect(minutesToOpen(w, 525)).toBe(45);
  });
  it("during the open: past / now / later", () => {
    expect(windowPhases(w, 600)).toEqual({ premarket: "past", open: "now", trend: "next", close: "later" });
    expect(nowMarker(w, 600)).toEqual({ key: "open", frac: 0.5, state: "in" });
    expect(minutesToOpen(w, 600)).toBeNull();
  });
  it("before the premarket the first window is next; after the close the marker is at the end", () => {
    expect(windowPhases(w, 120).premarket).toBe("next");
    expect(nowMarker(w, 120)).toMatchObject({ state: "before" });
    expect(nowMarker(w, 17 * 60)).toMatchObject({ key: "close", state: "after", frac: 1 });
  });
});

describe("grade and size", () => {
  it("all = A, all but one = B, else C; a one-item list has no B", () => {
    expect(gradeOf(3, 3)).toBe("A");
    expect(gradeOf(2, 3)).toBe("B");
    expect(gradeOf(1, 3)).toBe("C");
    expect(gradeOf(0, 1)).toBe("C");
    expect(gradeOf(1, 1)).toBe("A");
    expect(gradeOf(0, 0)).toBeNull();
  });
  it("shares = 1R ÷ stop, rounded down", () => {
    expect(sharesFor(50, 0.25)).toBe(200);
    expect(sharesFor(50, 0.3)).toBe(166);
    expect(sharesFor(50, 0.1)).toBe(500); // float noise must not drop a share
    expect(sharesFor(null, 0.25)).toBeNull();
    expect(sharesFor(50, null)).toBeNull();
    expect(sharesFor(50, 0)).toBeNull();
  });
  it("reads the stop in any way people type it", () => {
    expect(parseStop("0,25")).toBe(0.25);
    expect(parseStop("$0.4")).toBe(0.4);
    expect(parseStop("")).toBeNull();
    expect(parseStop("-1")).toBeNull();
  });
});

describe("my edge and picks", () => {
  it("summary: strong (best / good), careful, new; the routine card is not counted", () => {
    const s = edgeSummary(today().setups);
    expect(s.strong.map((x) => x.id)).toEqual([13, 21]);
    expect(s.careful.map((x) => x.id)).toEqual([15]);
    expect(s.fresh).toBe(3); // 1.1, 1.2 (2 trades, «new»), 3.3
  });
  it("a locked setup never shows as «strong», even with a good history", () => {
    const d = today();
    const lockedStrong = d.setups.map((s) => (s.id === 13 ? { ...s, locked: true } : s));
    expect(edgeSummary(lockedStrong).strong.map((x) => x.id)).toEqual([21]);
  });
  it("prefill: edge in the first window, then edge later in the day, then new ones; never «careful» or locked", () => {
    expect(firstTradingWindow(today(), 525)).toBe("open");
    expect(suggestPicks(today(), 525)).toEqual([13, 21, 12]);
  });
  it("after the open the prefill moves to the trend", () => {
    expect(firstTradingWindow(today(), 11 * 60)).toBe("trend");
    expect(suggestPicks(today(), 11 * 60)).toEqual([21]);
  });
  it("max 3 picks; a fourth is refused", () => {
    const three = [1, 2, 3];
    expect(togglePick(three, 4)).toBe(three);
    expect(togglePick(three, 2)).toEqual([1, 3]);
    expect(togglePick([1], 2)).toEqual([1, 2]);
  });
  it("window order: unlocked by edge, then locked", () => {
    const t = today();
    expect(windowSetups(t, t.windows[1]).map((s) => s.id)).toEqual([13, 12, 15, 11]);
  });
  it("search: code, name, «orb»", () => {
    const orb = today().setups[1];
    expect(matchSetup(orb, "ORB")).toBe(true);
    expect(matchSetup(orb, "1.3")).toBe(true);
    expect(matchSetup(orb, "vwap")).toBe(false);
  });
});

describe("mode from the URL", () => {
  it("traders land on «Сегодня»; library params open «Мой плейбук»", () => {
    expect(modeFromUrl("", false, null)).toBe("today");
    expect(modeFromUrl("?id=5", false, "edit")).toBe("today");
    expect(modeFromUrl("?mode=mine", false, null)).toBe("mine");
    expect(modeFromUrl("?folder=X", false, null)).toBe("mine");
  });
  it("staff come back to «Редактировать», and «today» wins when asked for", () => {
    expect(modeFromUrl("", true, "edit")).toBe("edit");
    expect(modeFromUrl("", true, null)).toBe("today");
    expect(modeFromUrl("?mode=today", true, "edit")).toBe("today");
    expect(modeFromUrl("?mode=mine", true, null)).toBe("edit");
  });
});

describe("persona fixes", () => {
  it("a star before anything is saved joins the draft — 2 suggested + star = 3, «Взять в план» saves all (DENIS-16)", () => {
    expect(starPick([], [13, 12], 21)).toEqual({ mode: "draft", next: [13, 12, 21] });
    expect(starPick([], [13, 12, 21], 15)).toBeNull(); // a fourth is refused
    expect(starPick([13], [13, 12], 21)).toEqual({ mode: "save", next: [13, 21] }); // saved picks save at once
    expect(starPick([13, 21], [], 13)).toEqual({ mode: "save", next: [21] });
  });
  it("weekend / holiday: the plan's next session is all ahead (ROMAN-10)", () => {
    expect(sessionMinutes("2026-10-19", "2026-10-18", 16 * 60 + 6)).toEqual({ now: 0, ahead: true });
    expect(sessionMinutes("2026-10-19", "2026-10-19", 600)).toEqual({ now: 600, ahead: false });
    const t = today();
    expect(Object.values(windowPhases(t.windows, sessionMinutes("2026-10-19", "2026-10-18", 966).now))).not.toContain("past");
  });
  it("the prompt copy follows why the setups were ticked (ILYA-15)", () => {
    const t = today();
    expect(suggestionSource(t.setups, [13, 21])).toBe("edge"); // best + good
    expect(suggestionSource(t.setups, [13, 12])).toBe("mixed");
    expect(suggestionSource(t.setups, [12])).toBe("starter"); // «new» only
    expect(suggestionSource(t.setups, [])).toBe("starter");
  });
});
