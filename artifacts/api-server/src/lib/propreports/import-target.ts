/**
 * Trades report import target. The export has no account column, so staff pick the trader instead: the account comes
 * from the field, the file name ("<account>-<from>-to-<to>-trades.xls"), the trader's own mapping or, as the admin XLS
 * import does, the trader's name. An account nobody owns yet gets linked to that trader; one that belongs to someone
 * else is refused.
 */
import { pool } from "@workspace/db";
import { logAudit } from "../audit";
import { AppError } from "../http";
import { performanceFileMeta } from "./parse-performance-report";
import { loadAccountMappings, resolveAccount, type AccountMapping } from "./sync";

export type TradesImportTarget =
  /** `account` goes on the trips; `link` is the mapping row to give this trader (null = already theirs / no trader). */
  | { ok: true; account: string; link: { account: string; trader: string } | null }
  | { ok: false; code: "REPORT_ACCOUNT_UNKNOWN" }
  | { ok: false; code: "ACCOUNT_LINKED_TO_OTHER"; account: string; owner: string };

export function tradesImportTarget(o: { explicit?: string | null; fromFile?: string | null; trader?: string | null; mappings: AccountMapping[] }): TradesImportTarget {
  const trader = o.trader?.trim() || null;
  const own = trader ? (o.mappings.find((m) => m.trader === trader && m.active) ?? o.mappings.find((m) => m.trader === trader)) : undefined;
  const account = o.explicit?.trim() || o.fromFile?.trim() || own?.account || trader || "";
  if (!account) return { ok: false, code: "REPORT_ACCOUNT_UNKNOWN" };
  if (!trader) return { ok: true, account, link: null };
  const hit = resolveAccount(account, o.mappings)?.mapping;
  if (hit?.trader && hit.trader !== trader) return { ok: false, code: "ACCOUNT_LINKED_TO_OTHER", account: hit.account, owner: hit.trader };
  return { ok: true, account, link: hit?.trader ? null : { account: hit?.account ?? account, trader } };
}

/**
 * POST /propreports/import, Trades report: resolves the account (trader = staff pick, null for traders) and links an
 * unowned account to the trader — persisted on apply, a virtual mapping for the planner on dry run.
 */
export async function prepareTradesImport(o: { field?: string | null; fileName: string; trader?: string | null; actor: string; dryRun: boolean }): Promise<{ account: string; virtualMappings: Array<{ account: string; trader: string }> }> {
  const trader = o.trader?.trim() || null;
  if (trader) {
    const { rows } = await pool.query(`SELECT 1 FROM users WHERE name = $1 LIMIT 1`, [trader]);
    if (!rows.length) throw new AppError("TRADER_NOT_FOUND", 400);
  }
  const target = tradesImportTarget({ explicit: o.field, fromFile: performanceFileMeta(o.fileName).account, trader, mappings: await loadAccountMappings() });
  if (!target.ok) throw target.code === "ACCOUNT_LINKED_TO_OTHER" ? new AppError(target.code, 400, { account: target.account, owner: target.owner, trader: trader ?? "" }) : new AppError(target.code);
  if (!target.link) return { account: target.account, virtualMappings: [] };
  if (o.dryRun) return { account: target.account, virtualMappings: [target.link] };
  await pool.query( // i18n-ignore (stored account note, data)
    `INSERT INTO propreports_accounts (account, trader, notes) VALUES ($1, $2, 'привязан при импорте отчёта Trades')
     ON CONFLICT (account) DO UPDATE SET trader = COALESCE(propreports_accounts.trader, EXCLUDED.trader), updated_at = NOW()`,
    [target.link.account, target.link.trader],
  );
  await logAudit({ actor: o.actor, action: "propreports.accounts.link", targetType: "propreports_accounts", targetId: target.link.account, details: { trader: target.link.trader, fileName: o.fileName } });
  return { account: target.account, virtualMappings: [] };
}
