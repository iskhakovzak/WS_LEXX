import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX, canWith, defaultPermissions, sensitiveGrants } from "./permissions";

describe("permissions mirror (OLGA-02)", () => {
  it("a curator holds no sensitive right by default", () => {
    const cur = defaultPermissions("curator", "Ольга Н.");
    for (const cap of ["admin.backups.read", "users.manage", "admin.audit", "propreports.sync", "propreports.configure", "telegram.broadcast", "rules.violations.delete"] as const) {
      expect(DEFAULT_MATRIX.curator).not.toContain(cap);
      expect(canWith(cur, cap)).toBe(false);
    }
    // the review / risk work stays, and so does fixing trainees' trades (setup, tags, playbook link)
    expect(canWith(cur, "trades.write.any", { trader: "Илья Ш." })).toBe(true);
    expect(canWith(cur, "journal.review")).toBe(true);
    expect(canWith(cur, "risk.read.team")).toBe(true);
    expect(canWith(cur, "propreports.read.team")).toBe(true);
    expect(canWith(defaultPermissions("admin", "Дмитрий К."), "admin.backups.read")).toBe(true);
  });

  it("warns only about sensitive rights being granted", () => {
    expect(sensitiveGrants([
      { capability: "admin.backups.read", allowed: true },
      { capability: "users.manage", allowed: false },
      { capability: "journal.review", allowed: true },
      { capability: "admin.backups.read", allowed: true },
    ])).toEqual(["admin.backups.read"]);
    expect(sensitiveGrants([])).toEqual([]);
  });
});
