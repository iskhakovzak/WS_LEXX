import { describe, expect, it } from "vitest";
import { freshnessView } from "./my-freshness";
import type { MyFreshness } from "./api";

const base: MyFreshness = { day: "2026-10-19", trades: 48, lastTradeDate: "2026-10-19", lastSyncedAt: "2026-10-19T20:20:00Z", accounts: 1, broker: null, state: "ok" };

describe("/integrations trader header (wave 1, 1.13)", () => {
  it("ok: verified with the broker, or synced after the close while the broker check is pending", () => {
    expect(freshnessView({ ...base, broker: { status: "ok", diff: 0, checkedAt: null } })).toMatchObject({ tone: "up", icon: "ok", detail: "verified" });
    expect(freshnessView(base)).toMatchObject({ tone: "up", detail: "synced" });
  });

  it("mismatch names what is missing and the money difference", () => {
    expect(freshnessView({ ...base, state: "mismatch", broker: { status: "missing_ours", diff: -37.5, checkedAt: null } })).toMatchObject({ tone: "down", detail: "missingOurs", diff: 37.5 });
    expect(freshnessView({ ...base, state: "mismatch", broker: { status: "mismatch", diff: 12, checkedAt: null } }).detail).toBe("mismatch");
    expect(freshnessView({ ...base, state: "mismatch", broker: { status: "missing_broker", diff: 5, checkedAt: null } }).detail).toBe("missingBroker");
  });

  it("behind and no account are their own states", () => {
    expect(freshnessView({ ...base, state: "behind" })).toMatchObject({ tone: "warn", icon: "wait", detail: "behind" });
    expect(freshnessView({ ...base, state: "no_account", accounts: 0 })).toMatchObject({ icon: "unlinked", detail: "noAccount" });
  });
});
