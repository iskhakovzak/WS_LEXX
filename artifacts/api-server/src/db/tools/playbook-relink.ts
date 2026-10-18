/**
 * One-time relink of the trade history to the new office playbook (owner approved 2026-10-18). Run from
 * artifacts/api-server against the LOCAL database:
 *
 *   node scripts/run-ts.mjs src/db/tools/playbook-relink.ts --backup <dir>                 dry run: report only
 *   node scripts/run-ts.mjs src/db/tools/playbook-relink.ts --backup <dir> --apply         write the links
 *        [--report-copy <file>] [--tolerance 5] [--allow-remote]
 *
 * <dir> is the playbook backup made before the rebuild (playbook.json = old setups, trades_playbook_links.json = every
 * trade's old link and setup text). The mapping is lib/playbookToday/relinkMap.ts (pure, unit-tested): old label → new
 * code (0.1 … 5.2) by name / setup text / first tag, then the entry time must sit in the new setup's window. Unmatched
 * trades are left as they are (their old setup stays soft-deleted, so they count as unlinked).
 *
 * Safe to re-run: a trade is written only while its link is still the backup's (the old, soft-deleted setup or none),
 * so a second run changes nothing and a trade a trader re-tagged since is never touched. Before writing, the current
 * link column of every linked trade is saved to <dir>/relink-before-<time>.json. The report goes to
 * <dir>/relink-report.json (and --report-copy). DATABASE_URL must point at localhost unless --allow-remote.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { entryMinuteOf, planRelink, type RelinkNewSetup, type RelinkOldSetup, type RelinkTrade } from "../../lib/playbookToday/relinkMap";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.DATABASE_URL;
const dir = opt("--backup");
if (!url || !dir || !existsSync(path.join(dir, "trades_playbook_links.json")) || !existsSync(path.join(dir, "playbook.json"))) {
  console.error("usage: DATABASE_URL=… node scripts/run-ts.mjs src/db/tools/playbook-relink.ts --backup <dir> [--apply] [--report-copy <file>] [--tolerance 5]");
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !flag("--allow-remote")) {
  console.error(`playbook-relink: refusing non-local database host "${host}" (pass --allow-remote on purpose)`);
  process.exit(2);
}
const apply = flag("--apply");
const tolerance = Number(opt("--tolerance") ?? 5);

type BackupSetup = { id: number; name: string; tags: string | null; deleted_at: string | null };
type BackupLink = { id: number; trader: string; date: string; ticker: string; playbook_id: number | null; setup: string | null };

const readJson = <T>(f: string): T => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as T;
const oldSetups: RelinkOldSetup[] = readJson<BackupSetup[]>("playbook.json").map((s) => ({ id: s.id, name: s.name, tags: s.tags }));
const links = readJson<BackupLink[]>("trades_playbook_links.json");

const { pool } = await import("@workspace/db"); // reads DATABASE_URL at import time
try {
  // New office setups: «<code> <name>» with a time window, live.
  const { rows: fresh } = await pool.query<{ id: number; name: string; time_of_day: string | null }>(
    `SELECT id, name, time_of_day FROM playbook
      WHERE deleted_at IS NULL AND COALESCE(space, CASE WHEN trader IS NULL THEN 'office' ELSE 'personal' END) = 'office'
        AND name ~ '^[0-9]+\\.[0-9]+ '`,
  );
  const newSetups: RelinkNewSetup[] = fresh.map((r) => ({ id: r.id, code: r.name.split(" ")[0], name: r.name, timeOfDay: r.time_of_day }));
  if (newSetups.length === 0) throw new Error("no numbered office setups found — install the new playbook first");
  const freshIds = new Set(newSetups.map((s) => s.id));

  // Old ids that are soft-deleted now: only links to those (or no link) may be replaced.
  const oldIds = [...new Set(links.map((l) => l.playbook_id).filter((x): x is number => x != null))];
  const { rows: deadRows } = await pool.query<{ id: number }>(`SELECT id FROM playbook WHERE id = ANY($1::int[]) AND deleted_at IS NOT NULL`, [oldIds]);
  const dead = new Set(deadRows.map((r) => r.id));

  // Entry time (NY) and the current link of every backed-up trade.
  const ids = links.map((l) => l.id);
  const { rows: cur } = await pool.query<{ id: number; playbook_id: number | null; opened: string | null; deleted: boolean }>(
    `SELECT id, playbook_id, context_snapshot ->> 'openedAt' AS opened, deleted_at IS NOT NULL AS deleted FROM trades WHERE id = ANY($1::int[])`,
    [ids],
  );
  const now = new Map(cur.map((r) => [r.id, r]));

  const trades: RelinkTrade[] = links.map((l) => ({ id: l.id, playbookId: l.playbook_id, setup: l.setup, entryMin: entryMinuteOf(now.get(l.id)?.opened) }));
  const { decisions, report } = planRelink(trades, oldSetups, newSetups, tolerance);

  // What may actually be written: the trade exists, is live, and still carries the backup's link (dead setup or none).
  const write: { id: number; to: number; orig: number | null }[] = [];
  let alreadyLinked = 0, changedSinceBackup = 0, missing = 0, liveOldLink = 0;
  for (const d of decisions) {
    if (d.to == null) continue;
    const c = now.get(d.tradeId);
    if (!c || c.deleted) { missing++; continue; }
    if (c.playbook_id === d.to) { alreadyLinked++; continue; }
    if ((c.playbook_id ?? null) !== (d.from ?? null)) { changedSinceBackup++; continue; }
    if (d.from != null && !dead.has(d.from)) { liveOldLink++; continue; }
    write.push({ id: d.tradeId, to: d.to, orig: d.from });
  }

  let written = 0;
  let backupFile: string | null = null;
  if (apply && write.length) {
    const { rows: before } = await pool.query(`SELECT id, playbook_id, setup FROM trades WHERE playbook_id IS NOT NULL OR NULLIF(TRIM(setup), '') IS NOT NULL ORDER BY id`);
    backupFile = path.join(dir, `relink-before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(backupFile, JSON.stringify(before));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < write.length; i += 5000) {
        const part = write.slice(i, i + 5000);
        const res = await client.query(
          `UPDATE trades t SET playbook_id = u.dst
             FROM unnest($1::int[], $2::int[], $3::int[]) AS u(id, dst, orig)
            WHERE t.id = u.id AND t.deleted_at IS NULL AND t.playbook_id IS NOT DISTINCT FROM u.orig`,
          [part.map((w) => w.id), part.map((w) => w.to), part.map((w) => w.orig)],
        );
        written += res.rowCount ?? 0;
      }
      await client.query(
        `INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES ('system', 'playbook.relink', 'trades', 'many', $1)`,
        [JSON.stringify({ written, backup: path.basename(backupFile), byNewSetup: report.byNewSetup.map((s) => [s.code, s.trades]) })],
      ).catch(() => { /* audit table missing on a bare database */ });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Stats the new setups now have (all traders, closed or open).
  const { rows: stats } = await pool.query<{ id: number; n: string }>(
    `SELECT playbook_id AS id, COUNT(*)::text AS n FROM trades WHERE deleted_at IS NULL AND playbook_id = ANY($1::int[]) GROUP BY 1`,
    [[...freshIds]],
  );
  const out = {
    createdAt: new Date().toISOString(),
    database: `${host}${new URL(url).pathname}`,
    applied: apply,
    toleranceMin: tolerance,
    backupOfLinkColumn: backupFile ? path.basename(backupFile) : null,
    summary: {
      backupTrades: report.trades,
      matched: report.linked,
      unmatched: report.unlinked,
      unmatchedReasons: report.unlinkedReasons,
      toWrite: write.length,
      written,
      skipped: { alreadyLinked, changedSinceBackup, liveOldLink, missing },
    },
    byNewSetup: report.byNewSetup.map((s) => ({ ...s, linkedNow: Number(stats.find((x) => x.id === s.id)?.n ?? 0) })),
    byOldLabel: report.byOldLabel,
  };
  const text = JSON.stringify(out, null, 1);
  writeFileSync(path.join(dir, "relink-report.json"), text);
  const copy = opt("--report-copy");
  if (copy) writeFileSync(copy, text);
  process.stdout.write(`playbook-relink: ${apply ? "applied" : "dry run"} — matched ${report.linked} of ${report.trades}, written ${written}, `
    + `already ${alreadyLinked}, changed since backup ${changedSinceBackup}\n`);
  for (const s of out.byNewSetup) process.stdout.write(`  ${s.code.padEnd(4)} ${String(s.trades).padStart(6)} matched  ${String(s.linkedNow).padStart(6)} linked now  ${s.name}\n`);
} finally {
  await pool.end();
}
