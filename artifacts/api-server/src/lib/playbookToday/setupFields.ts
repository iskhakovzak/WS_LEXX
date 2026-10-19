/**
 * Setup editor fields of the playbook «Сегодня» (PATCH /api/playbook/:id, routes/playbook.ts):
 *   minTier  trainee | junior | trader | senior | lead | null — curators / admins only (playbook.edit.any); audited
 *            (playbook.min_tier). Guidance for the tier locks, never a trading block.
 *   schema   cheat-sheet picture key (build.ts SCHEMA_KEYS) | null — whoever may edit the setup.
 */
import { AppError } from "../http";
import { logAudit } from "../audit";
import { isSchemaKey, isTierKey } from "./build";

type Prev = { id: number; minTier?: string | null; schema?: string | null };

export function setupTierFields(body: Record<string, unknown>, prev: Prev, viewer: { editAny: boolean; name: string | null }) {
  const cols: [string, string | null][] = [];
  let tierChange: { from: string | null; to: string | null } | null = null;
  if (body.minTier !== undefined) {
    const raw = body.minTier === null || body.minTier === "" ? null : body.minTier;
    if (raw !== null && !isTierKey(raw)) throw new AppError("INVALID_FIELD", undefined, { field: "minTier" });
    const to = raw as string | null;
    if (!viewer.editAny) throw new AppError("STAFF_ONLY");
    cols.push(["min_tier", to]);
    if ((prev.minTier ?? null) !== to) tierChange = { from: prev.minTier ?? null, to };
  }
  if (body.schema !== undefined) {
    const raw = body.schema === null || body.schema === "" ? null : body.schema;
    if (raw !== null && !isSchemaKey(raw)) throw new AppError("INVALID_FIELD", undefined, { field: "schema" });
    cols.push(["schema_key", raw as string | null]);
  }
  return {
    cols,
    /** After the update succeeded: audit a tier change. */
    audit: async (actor: string, name: string) => {
      if (tierChange) await logAudit({ actor, action: "playbook.min_tier", targetType: "playbook", targetId: String(prev.id), details: { name, ...tierChange } });
    },
  };
}
