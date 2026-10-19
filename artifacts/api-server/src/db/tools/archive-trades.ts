/**
 * Archive every live trade (owner request 2026-10-19: start the statistics clean), optionally keeping one broker
 * account and moving it to one person. Nothing is deleted: trades get deleted_at, their rule violations archived_at,
 * and the run is stored in trade_archive_batches (migration 0219) so --restore undoes exactly that run.
 * Run from artifacts/api-server (DATABASE_URL = the target database; non-local hosts need --allow-remote):
 *
 *   node scripts/run-ts.mjs src/db/tools/archive-trades.ts                                   # dry run: counts only
 *   node scripts/run-ts.mjs src/db/tools/archive-trades.ts --keep-account 31206881 --to "Дмитрий К." --confirm
 *   node scripts/run-ts.mjs src/db/tools/archive-trades.ts --restore 1 --confirm
 *
 * --keep-account matches trades.broker_account against the account code or its PropReports account id, moves those
 * trades to --to (an existing user) and maps the account to that person, so a later import of the same file updates
 * them instead of skipping archived rows.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('usage: DATABASE_URL=… node scripts/run-ts.mjs src/db/tools/archive-trades.ts [--keep-account <acc> --to "<name>"] [--restore <id>] [--confirm] [--allow-remote]');
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !flag("--allow-remote")) {
  console.error(`archive-trades: refusing non-local database host "${host}" (pass --allow-remote on purpose)`);
  process.exit(2);
}
const keepAccount = opt("--keep-account") ?? null;
const to = opt("--to") ?? null;
const restoreId = opt("--restore") ? Number(opt("--restore")) : null;
const confirm = flag("--confirm");
if ((keepAccount && !to) || (!keepAccount && to)) {
  console.error("archive-trades: --keep-account and --to go together");
  process.exit(2);
}

const { pool } = await import("@workspace/db"); // reads DATABASE_URL at import time
const client = await pool.connect();
const say = (s: string) => process.stdout.write(`archive-trades: ${s}\n`);

/** Accounts that stand for `acc`: the code itself plus codes whose PropReports account id is `acc`. */
const KEEP_ACCOUNTS_SQL = `SELECT $1::text AS account UNION SELECT account FROM propreports_accounts WHERE account_id = $1 OR account = $1`;

try {
  if (restoreId != null) {
    const { rows } = await client.query(`SELECT id, created_at, trade_ids, violation_ids, restored_at FROM trade_archive_batches WHERE id = $1`, [restoreId]);
    const b = rows[0];
    if (!b) throw new Error(`batch ${restoreId} not found`);
    if (b.restored_at) throw new Error(`batch ${restoreId} was already restored at ${b.restored_at}`);
    say(`batch ${restoreId}: ${b.trade_ids.length} trades, ${b.violation_ids.length} violations to restore`);
    if (!confirm) say("dry run — add --confirm to restore");
    else {
      await client.query("BEGIN");
      const t = await client.query(`UPDATE trades SET deleted_at = NULL WHERE id = ANY($1::int[]) AND deleted_at IS NOT NULL`, [b.trade_ids]);
      const v = await client.query(`UPDATE rule_violations SET archived_at = NULL, archived_reason = NULL WHERE id = ANY($1::int[]) AND archived_reason = 'trades_archived'`, [b.violation_ids]);
      await client.query(`UPDATE trade_archive_batches SET restored_at = now() WHERE id = $1`, [restoreId]);
      await client.query("COMMIT");
      say(`restored ${t.rowCount} trades and ${v.rowCount} violations (moved trades keep their new owner)`);
    }
  } else {
    if (to) {
      const u = await client.query(`SELECT 1 FROM users WHERE name = $1`, [to]);
      if (!u.rowCount) throw new Error(`no user named "${to}"`);
    }
    const live = await client.query<{ trader: string; n: string; kept: string }>(
      `SELECT trader, count(*) AS n, count(*) FILTER (WHERE broker_account IN (${KEEP_ACCOUNTS_SQL})) AS kept
         FROM trades WHERE deleted_at IS NULL GROUP BY trader ORDER BY count(*) DESC`,
      [keepAccount ?? ""],
    );
    const total = live.rows.reduce((s, r) => s + Number(r.n), 0);
    const kept = keepAccount ? live.rows.reduce((s, r) => s + Number(r.kept), 0) : 0;
    say(`${total} live trades of ${live.rows.length} traders; ${total - kept} to archive${keepAccount ? `, ${kept} of account ${keepAccount} to keep and move to ${to}` : ""}`);
    for (const r of live.rows.slice(0, 15)) say(`  ${r.trader}: ${r.n}${Number(r.kept) ? ` (keep ${r.kept})` : ""}`);
    if (!confirm) say("dry run — add --confirm to archive");
    else {
      await client.query("BEGIN");
      const t = await client.query<{ id: number }>(
        `UPDATE trades SET deleted_at = now()
          WHERE deleted_at IS NULL AND ($1::text IS NULL OR broker_account IS NULL OR broker_account NOT IN (${KEEP_ACCOUNTS_SQL.replaceAll("$1", "$1::text")}))
          RETURNING id`,
        [keepAccount],
      );
      const ids = t.rows.map((r) => r.id);
      const v = await client.query<{ id: number }>(
        `UPDATE rule_violations SET archived_at = now(), archived_reason = 'trades_archived'
          WHERE archived_at IS NULL AND ($1::text IS NULL OR trader <> $2::text)
          RETURNING id`,
        [keepAccount, to ?? ""],
      );
      let reassigned: Record<string, unknown> | null = null;
      if (keepAccount && to) {
        const moved = await client.query(
          `UPDATE trades SET trader = $2 WHERE deleted_at IS NULL AND broker_account IN (${KEEP_ACCOUNTS_SQL}) AND trader <> $2`,
          [keepAccount, to],
        );
        const mapped = await client.query(`UPDATE propreports_accounts SET trader = $2, updated_at = now() WHERE account = $1 OR account_id = $1`, [keepAccount, to]);
        if (!mapped.rowCount) await client.query(`INSERT INTO propreports_accounts (account, trader) VALUES ($1, $2)`, [keepAccount, to]);
        reassigned = { account: keepAccount, to, trades: moved.rowCount, mapping: mapped.rowCount ? "updated" : "created" };
      }
      const b = await client.query<{ id: number }>(
        `INSERT INTO trade_archive_batches (note, trade_ids, violation_ids, reassigned) VALUES ($1, $2, $3, $4) RETURNING id`,
        [keepAccount ? `archive all but account ${keepAccount}` : "archive all trades", ids, v.rows.map((r) => r.id), reassigned ? JSON.stringify(reassigned) : null],
      );
      await client.query(
        `INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES ('system', 'trades.archive', 'trade_archive_batch', $1, $2)`,
        [String(b.rows[0].id), JSON.stringify({ trades: ids.length, violations: v.rowCount, reassigned })],
      ).catch(() => { /* audit table missing on a bare database */ });
      await client.query("COMMIT");
      say(`batch ${b.rows[0].id}: archived ${ids.length} trades and ${v.rowCount} violations${reassigned ? `; moved ${reassigned.trades} trades to ${to} (account mapping ${reassigned.mapping})` : ""}`);
      say(`undo: node scripts/run-ts.mjs src/db/tools/archive-trades.ts --restore ${b.rows[0].id} --confirm`);
    }
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(`archive-trades: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

export {};
