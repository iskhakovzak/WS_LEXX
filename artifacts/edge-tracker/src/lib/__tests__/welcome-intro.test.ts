import { describe, expect, it } from "vitest";
import {
  INTRO_DAY_KEY, INTRO_OFF_KEY, INTRO_SESSION_KEY, dayPartNY, decideIntro, firstName, introParam, markIntroShown,
  type IntroEnv, type KeyValueStore,
} from "@/lib/welcome-intro";

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}
const blocked: KeyValueStore = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("SecurityError"); },
};

// 2026-10-19 07:30 New York (EDT, UTC−4).
const MORNING = new Date("2026-10-19T11:30:00Z");

function env(over: Partial<IntroEnv> = {}): IntroEnv {
  return { authed: false, path: "/", search: "", now: MORNING, automated: false, printing: false, session: memStore(), local: memStore(), ...over };
}

describe("welcome intro: show-once rules", () => {
  it("signed out → welcome, signed in → greeting", () => {
    expect(decideIntro(env())).toBe("welcome");
    expect(decideIntro(env({ authed: true }))).toBe("greeting");
  });

  it("plays at most once per browser session", () => {
    const e = env();
    expect(decideIntro(e)).toBe("welcome");
    markIntroShown("welcome", e);
    expect(decideIntro(e)).toBeNull();
    // Sign-in later in the same session: no second intro.
    expect(decideIntro({ ...e, authed: true })).toBeNull();
    // A new session (fresh sessionStorage) shows it again.
    expect(decideIntro({ ...e, session: memStore() })).toBe("welcome");
  });

  it("the signed-in greeting plays at most once per NY day, across sessions", () => {
    const local = memStore();
    const e = env({ authed: true, local });
    markIntroShown("greeting", e);
    expect(local.data[INTRO_DAY_KEY]).toBe("2026-10-19");
    expect(decideIntro({ ...e, session: memStore() })).toBeNull();
    // 23:30 NY the same day is still that day; 00:30 NY next day is a new one.
    expect(decideIntro({ ...e, session: memStore(), now: new Date("2026-10-20T03:30:00Z") })).toBeNull();
    expect(decideIntro({ ...e, session: memStore(), now: new Date("2026-10-20T04:30:00Z") })).toBe("greeting");
  });

  it("the welcome screen does not use up the day's greeting", () => {
    const local = memStore();
    markIntroShown("welcome", env({ local }));
    expect(local.data[INTRO_DAY_KEY]).toBeUndefined();
  });

  it("never on a deep link, in print, under automation or with the local switch", () => {
    expect(decideIntro(env({ path: "/trades" }))).toBeNull();
    expect(decideIntro(env({ search: "?id=5" }))).toBeNull();
    expect(decideIntro(env({ search: "?ny=08:45" }))).toBeNull();
    expect(decideIntro(env({ path: "/login" }))).toBe("welcome");
    expect(decideIntro(env({ printing: true }))).toBeNull();
    expect(decideIntro(env({ automated: true }))).toBeNull();
    expect(decideIntro(env({ local: memStore({ [INTRO_OFF_KEY]: "off" }) }))).toBeNull();
  });

  it("?intro=1 forces it past every limit, ?intro=0 turns it off", () => {
    const seen = env({ authed: true, path: "/trades", automated: true, session: memStore({ [INTRO_SESSION_KEY]: "1" }) });
    expect(decideIntro({ ...seen, search: "?intro=1" })).toBe("greeting");
    expect(decideIntro(env({ search: "?intro=0" }))).toBeNull();
    expect(introParam("?a=1&intro=on")).toBe("force");
    expect(introParam("")).toBeNull();
  });

  it("blocked storage: still plays, never throws", () => {
    const e = env({ session: blocked, local: blocked });
    expect(decideIntro(e)).toBe("welcome");
    expect(() => markIntroShown("greeting", e)).not.toThrow();
    expect(decideIntro(env({ session: null, local: null, authed: true }))).toBe("greeting");
  });
});

describe("welcome intro: greeting text inputs", () => {
  it("part of the day follows the New York clock", () => {
    expect(dayPartNY(new Date("2026-10-19T08:00:00Z"))).toBe("night"); // 04:00 NY
    expect(dayPartNY(MORNING)).toBe("morning");
    expect(dayPartNY(new Date("2026-10-19T20:02:00Z"))).toBe("day"); // 16:02 NY
    expect(dayPartNY(new Date("2026-10-19T23:00:00Z"))).toBe("evening"); // 19:00 NY
  });

  it("first name only", () => {
    expect(firstName("Дмитрий К.")).toBe("Дмитрий");
    expect(firstName("  Закир ")).toBe("Закир");
    expect(firstName(null)).toBe("");
  });
});
