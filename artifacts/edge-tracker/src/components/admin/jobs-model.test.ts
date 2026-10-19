import { describe, expect, it } from "vitest";
import { jobState, parseCron, sendsMessages } from "./jobs-model";

describe("jobs model (OWNER-15)", () => {
  it("reads the registry cron shapes as words", () => {
    expect(parseCron("0 5 * * *")).toEqual({ kind: "daily", time: "05:00" });
    expect(parseCron("30 18 * * 1-5")).toEqual({ kind: "weekdays", time: "18:30" });
    expect(parseCron("0 17 * * 5")).toEqual({ kind: "weekly", day: 5, time: "17:00" });
    expect(parseCron("*/15 9-16 * * 1-5")).toEqual({ kind: "every", minutes: 15, weekdays: true, from: "09:00", to: "17:00" });
    expect(parseCron("*/20 * * * *")).toEqual({ kind: "every", minutes: 20, weekdays: false });
    expect(parseCron("7-59/15 * * * *")).toEqual({ kind: "every", minutes: 15, weekdays: false });
  });
  it("keeps anything unusual raw", () => {
    expect(parseCron("0 0 1 * *")).toEqual({ kind: "raw", cron: "0 0 1 * *" });
    expect(parseCron("@daily")).toEqual({ kind: "raw", cron: "@daily" });
    expect(parseCron("0 5,17 * * *")).toEqual({ kind: "raw", cron: "0 5,17 * * *" });
  });
  it("a success with failures in 24 h is «с перебоями», not «успешно»", () => {
    const base = { running: false, enabled: true, failures24h: 0, last: { status: "ok" } };
    expect(jobState(base)).toBe("ok");
    expect(jobState({ ...base, failures24h: 29 })).toBe("flaky");
    expect(jobState({ ...base, last: { status: "error" } })).toBe("error");
    expect(jobState({ ...base, last: null })).toBe("never");
    expect(jobState({ ...base, enabled: false })).toBe("disabled");
    expect(jobState({ ...base, running: true, enabled: false })).toBe("running");
  });
  it("jobs that message people ask before a manual run", () => {
    expect(sendsMessages("telegram.daily-morning")).toBe(true);
    expect(sendsMessages("digest.evening")).toBe(true);
    expect(sendsMessages("psychology.weekly-report")).toBe(true);
    expect(sendsMessages("db.backup")).toBe(false);
    expect(sendsMessages("gamification.nightly")).toBe(false);
  });
});
