/**
 * Migrations 0285–0288 on a scratch database built from every migration: the corporate events calendar, playbook cases,
 * trading pods and the briefing columns of the Academy lessons — tables, checks, the one-pod-per-trader rule, the one
 * shared review per pod-week, and a round trip through the stores. Synthetic people only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("migrations 0285–0288 (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("desk0285");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("0285 corp_events: checks and the calendar merge (desk entry wins over the rule row)", async () => {
    await expect(db.pool.query(`INSERT INTO corp_events (day, type, ticker, created_by) VALUES ('2026-12-18', 'meme', 'SYNA', 'Synth Cur')`)).rejects.toThrow(/check/i);
    await expect(db.pool.query(`INSERT INTO corp_events (day, type, ticker, created_by) VALUES ('2026-12-18', 'sp_add', 'syna', 'Synth Cur')`)).rejects.toThrow(/check/i);
    const { insertCorpEvent, corpCalendar } = await import("../corpEvents/store");
    await insertCorpEvent({ day: "2026-12-18", type: "quad_witching", ticker: null, indexCode: null, note: null }, "Synth Cur");
    await insertCorpEvent({ day: "2026-12-21", type: "sp_add", ticker: "SYNA", indexCode: "sp500", note: "effective before the open" }, "Synth Cur");
    const cal = await corpCalendar("2026-12-01", "2026-12-31");
    expect(cal.filter((e) => e.type === "quad_witching").map((e) => e.source)).toEqual(["manual"]);
    expect(cal.some((e) => e.rule === "sp_quarterly" && e.day === "2026-12-18")).toBe(true);
    expect(cal.find((e) => e.type === "sp_add")).toMatchObject({ ticker: "SYNA", indexCode: "sp500", source: "manual" });
  });

  it("0286 playbook_cases: ticker / day / time checks and the store round trip", async () => {
    const p = await db.pool.query(`INSERT INTO playbook (name, space) VALUES ('Synth Gap Fade', 'office') RETURNING id`);
    const setupId = Number(p.rows[0].id);
    await expect(db.pool.query(`INSERT INTO playbook_cases (playbook_id, ticker, day, entry_time, added_by) VALUES ($1, 'SYNA', '2026-10-20', '9:41', 'Synth A')`, [setupId])).rejects.toThrow(/check/i);
    const { insertCase, casesOf, deleteCase } = await import("../analogues/store");
    const c = await insertCase(setupId, { ticker: "SYNA", day: "2026-10-20", entryTime: "09:41", exitTime: null, side: "short", note: null }, "Synth A");
    expect((await casesOf(setupId)).map((x) => [x.ticker, x.entryTime, x.side])).toEqual([["SYNA", "09:41", "short"]]);
    expect(await deleteCase(c.id)).toBe(true);
    expect(await casesOf(setupId)).toEqual([]);
  });

  it("0287 trading pods: one pod per trader, one shared review per pod-week", async () => {
    const g = await db.pool.query(`INSERT INTO desk_groups (name) VALUES ('Synth group') RETURNING id`);
    const groupId = Number(g.rows[0].id);
    const ids: number[] = [];
    for (const n of ["Synth P1", "Synth P2", "Synth P3"]) {
      const u = await db.pool.query(`INSERT INTO users (name, role, active, group_id) VALUES ($1, 'trader', true, $2) RETURNING id`, [n, groupId]);
      ids.push(Number(u.rows[0].id));
    }
    const { createPod, podOfUser, saveReview, podReview, tradersOfGroup } = await import("../pods/store");
    expect((await tradersOfGroup(groupId, ids)).sort()).toEqual([...ids].sort());
    const podId = await createPod(groupId, "Morning gap", [ids[0], ids[1]], "Synth Cur");
    expect((await podOfUser(ids[0]))?.members.map((m) => m.name)).toEqual(["Synth P1", "Synth P2"]);
    await expect(createPod(groupId, "Second", [ids[1], ids[2]], "Synth Cur")).rejects.toThrow(/unique|duplicate/i);
    await saveReview(podId, "2026-10-26", "first", "Synth P1");
    const r = await saveReview(podId, "2026-10-26", "edited", "Synth P2");
    expect(r).toMatchObject({ body: "edited", author: "Synth P1", updatedBy: "Synth P2" });
    expect((await podReview(podId, "2026-10-26"))?.body).toBe("edited");
    await expect(db.pool.query(`INSERT INTO trading_pod_posts (pod_id, kind, body, author) VALUES ($1, 'review', 'x', 'a')`, [podId])).rejects.toThrow(/check/i);
  });

  it("0288 briefing columns on academy_lessons and academy_media", async () => {
    const cols = await db.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'academy_lessons' AND column_name IN ('tags', 'must_watch', 'media_id', 'media_link') ORDER BY column_name`);
    expect(cols.rows.map((r) => r.column_name)).toEqual(["media_id", "media_link", "must_watch", "tags"]);
    await expect(db.pool.query(`INSERT INTO academy_media (mime, size_bytes, bytes, created_by) VALUES ('image/png', 10, '\\x00', 'Synth')`)).rejects.toThrow(/check/i);
    const { ensureBriefingModule, insertBriefing, listBriefings, normTags } = await import("../academyBriefings");
    const mod = await ensureBriefingModule({ program: "Briefings", module: "Recordings" }, "Synth Cur");
    expect(await ensureBriefingModule({ program: "Briefings", module: "Recordings" }, "Synth Cur")).toBe(mod);
    await insertBriefing(mod, { title: "Tilt after a stop", summary: null, tags: normTags("#Tilt, fomo, #fomo, !!"), playbookIds: [], mustWatch: true, videoUrl: null, mediaId: null, mediaLink: "https://files.desk.internal/brief.mp4", durationMin: 12 }, "Synth Cur");
    const list = await listBriefings("Synth J", { tag: "tilt", staff: false });
    expect(list.map((b) => [b.title, b.tags, b.mustWatch, b.watched])).toEqual([["Tilt after a stop", ["tilt", "fomo"], true, false]]);
  });
});
