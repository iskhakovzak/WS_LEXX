/**
 * PATCH /playbook/:id must not re-assign the owner from a plain `trader` field (only an explicit `reassignTo`, staff),
 * and PATCH /playbook/folder-settings is staff-only and keeps fields that are not sent. PUT /playbook/:id/marks: readers
 * only, «shared» ticks for setup editors / curators only (DEV-04). GET /playbook redacts setups above the viewer's tier
 * (DEV-06).
 * The DB, permissions and viewer are mocked: the tests read the SQL the handlers send.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Q = { sql: string; params: unknown[] };
const calls: Q[] = [];
let staff = false;
let canEdit = true;
let locked = false;
const personalRow = { id: 7, name: "Сетап", trader: "Максим Р.", space: "personal", visibility: "private", folder: null };
const otherRow = { id: 8, name: "Чужой", trader: "Денис Ф.", space: "personal", visibility: "private", folder: null };
const officeRow = {
  id: 213, name: "3.3 Parabolic Backside", folder: "3", trader: null, space: "office", visibility: "private", minTier: "trader",
  entryText: "Шорт после первой красной", stopText: "Над хаем", checklist: "- один", checklistItems: [{ id: "a", text: "один" }], notes: "Грейд A — …",
  media: [{ id: 1 }], timeOfDay: "10:00–15:30 NY",
};

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM playbook WHERE id = \$1/.test(sql)) return { rows: [params[0] === 8 ? otherRow : personalRow], rowCount: 1 };
      if (/SELECT q\.\*/.test(sql)) return { rows: [{ ...officeRow }], rowCount: 1 };
      if (/SELECT 1 FROM users WHERE name/.test(sql)) return { rows: params[0] === "Игорь П." ? [{}] : [], rowCount: params[0] === "Игорь П." ? 1 : 0 };
      if (/^\s*UPDATE playbook SET/.test(sql)) return { rows: [{ ...personalRow }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("../../lib/permissions", async (orig) => ({
  ...(await orig<typeof import("../../lib/permissions")>()),
  can: vi.fn(async () => staff),
  requireCap: vi.fn(async (_req: unknown, res: express.Response, _cap: string, _t: unknown, msg?: string) => {
    if (staff) return true;
    res.status(403).json({ error: msg ?? "forbidden" });
    return false;
  }),
}));
vi.mock("../../lib/playbookAccess", async (orig) => {
  const actual = await orig<typeof import("../../lib/playbookAccess")>();
  return {
    ...actual,
    ensurePlaybookSpaces: vi.fn(async () => undefined),
    loadViewer: vi.fn(async () => ({ name: staff ? "Антон" : "Максим Р.", guest: false, teamScope: staff ? null : [], editOwn: true, editAny: staff, review: staff, stage: null, cohorts: [] })),
    canEditSetupRow: vi.fn(async () => canEdit),
  };
});
vi.mock("../../lib/playbookToday/service", () => ({
  tradeTagged: vi.fn(async () => undefined),
  viewerLocks: vi.fn(async () => ({
    known: new Map(locked ? [[213, { locked: true, unlock: { key: "unlock.tier", params: { tier: "trader" } } }]] : []),
    lockOther: () => ({ locked: false, unlock: null }),
  })),
}));

// lib/auth reads JWT_SECRET at import time; the routes are imported after the mocks are registered.
process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router } = await import("../playbook");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = staff ? { id: 2, name: "Антон", role: "curator" } : { id: 135, name: "Максим Р.", role: "trader" };
    next();
  });
  app.use("/api", router);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { calls.length = 0; staff = false; canEdit = true; locked = false; });

async function patch(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const updateSql = () => calls.find((c) => /^\s*UPDATE playbook SET/.test(c.sql));

describe("PATCH /playbook/:id — owner", () => {
  it("ignores `trader` from a curator's edit form (no silent take-over)", async () => {
    staff = true;
    const r = await patch("/api/playbook/7", { name: "Новое имя", trader: "Антон" });
    expect(r.status).toBe(200);
    const u = updateSql();
    expect(u?.sql).not.toMatch(/\btrader = \$/);
    expect(u?.params).not.toContain("Антон");
  });

  it("re-assigns only with an explicit reassignTo (staff, existing user)", async () => {
    staff = true;
    const r = await patch("/api/playbook/7", { reassignTo: "Игорь П." });
    expect(r.status).toBe(200);
    const u = updateSql();
    expect(u?.sql).toMatch(/\btrader = \$1/);
    expect(u?.params[0]).toBe("Игорь П.");
  });

  it("rejects reassignTo to an unknown user", async () => {
    staff = true;
    const r = await patch("/api/playbook/7", { reassignTo: "Нет Такого" });
    expect(r.status).toBe(400);
    expect(updateSql()).toBeUndefined();
  });

  it("forbids reassignTo for a trader", async () => {
    const r = await patch("/api/playbook/7", { reassignTo: "Игорь П." });
    expect(r.status).toBe(403);
    expect(updateSql()).toBeUndefined();
  });
});

describe("PATCH /playbook/folder-settings", () => {
  it("is staff-only", async () => {
    const r = await patch("/api/playbook/folder-settings", [{ folderName: "Гэпы", colorIndex: 2 }]);
    expect(r.status).toBe(403);
    expect(calls.some((c) => /playbook_folder_settings/.test(c.sql))).toBe(false);
  });

  it("keeps the existing order when sortOrder is not sent", async () => {
    staff = true;
    const r = await patch("/api/playbook/folder-settings", [{ folderName: "Гэпы", colorIndex: 2 }]);
    expect(r.status).toBe(200);
    const q = calls.find((c) => /INSERT INTO playbook_folder_settings/.test(c.sql));
    expect(q?.params).toEqual(["Гэпы", 2, null]);
    expect(q?.sql).toMatch(/sort_order\s*=\s*COALESCE\(\$3::int, playbook_folder_settings\.sort_order\)/);
  });

  it("rejects a non-array body", async () => {
    staff = true;
    const r = await patch("/api/playbook/folder-settings", { folderName: "Гэпы" });
    expect(r.status).toBe(400);
  });
});

async function put(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const markWrite = () => calls.find((c) => /INSERT INTO playbook_checklist_marks/.test(c.sql));

describe("PUT /playbook/:id/marks/:itemId (DEV-04)", () => {
  it("a member who may not edit the setup cannot flip the shared marks", async () => {
    canEdit = false;
    const r = await put("/api/playbook/7/marks/a", { scope: "shared", done: true });
    expect(r.status).toBe(403);
    expect(markWrite()).toBeUndefined();
  });

  it("own (personal) ticks still work for any reader", async () => {
    canEdit = false;
    const r = await put("/api/playbook/7/marks/a", { scope: "personal", done: true });
    expect(r.status).toBe(200);
    expect(markWrite()?.params).toEqual([7, "a", "personal", "Максим Р.", true]);
  });

  it("the setup editor may tick the shared marks", async () => {
    const r = await put("/api/playbook/7/marks/a", { scope: "shared", done: true });
    expect(r.status).toBe(200);
    expect(markWrite()?.params).toEqual([7, "a", "shared", "", true]);
  });

  it("a setup the caller cannot read answers 404, whatever the scope", async () => {
    const r = await put("/api/playbook/8/marks/a", { scope: "personal", done: true });
    expect(r.status).toBe(404);
    expect(markWrite()).toBeUndefined();
  });
});

describe("GET /playbook — tier locks are real (DEV-06)", () => {
  it("a setup above the viewer's tier comes without its card", async () => {
    locked = true;
    const r = await fetch(base + "/api/playbook");
    const rows = (await r.json()) as any[];
    const s = rows.find((x) => x.id === 213);
    expect(s).toMatchObject({ name: "3.3 Parabolic Backside", minTier: "trader", timeOfDay: "10:00–15:30 NY", locked: true, unlock: { key: "unlock.tier" } });
    expect(s.entryText).toBeNull();
    expect(s.stopText).toBeNull();
    expect(s.notes).toBeNull();
    expect(s.checklist).toBeNull();
    expect(s.checklistItems).toEqual([]);
    expect(s.media).toEqual([]);
  });

  it("open setups keep the card", async () => {
    const rows = (await (await fetch(base + "/api/playbook")).json()) as any[];
    expect(rows.find((x) => x.id === 213)).toMatchObject({ locked: false, entryText: "Шорт после первой красной" });
  });
});
