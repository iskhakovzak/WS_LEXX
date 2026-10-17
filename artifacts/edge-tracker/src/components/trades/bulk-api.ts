import type { Trade } from "@workspace/api-client-react";
import { BASE } from "@/lib/api";
import { splitTags } from "./trade-utils";

export type BulkBody =
  | { action: "delete" | "restore"; ids: number[] }
  | { action: "setResult"; ids: number[]; result: string }
  | { action: "addTags" | "removeTags"; ids: number[]; tags: string[] }
  | { action: "setSetup"; ids: number[]; setup: string | null };

async function errText(r: Response) {
  const b: { error?: string; message?: string } = await r.json().catch(() => ({}));
  return b.message ?? b.error ?? `Статус ${r.status}`;
}

/**
 * POST /api/trades/bulk; falls back to per-trade requests when the running API
 * predates the bulk endpoint (404). Returns the ids that were actually changed.
 */
export async function bulkTrades(body: BulkBody, trades: Trade[]): Promise<number[]> {
  const r = await fetch(`${BASE}/api/trades/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) {
    const d: { updated?: number[] } = await r.json().catch(() => ({}));
    return Array.isArray(d.updated) ? d.updated : body.ids;
  }
  // 404: no bulk endpoint; 400 on setSetup: an API build that predates the action → per-trade fallback.
  if (r.status !== 404 && !(r.status === 400 && body.action === "setSetup")) throw new Error(await errText(r));

  const byId = new Map(trades.map((t) => [t.id, t]));
  const tags: string[] = "tags" in body ? body.tags : [];
  const one = async (id: number): Promise<number | null> => {
    let res: Response;
    if (body.action === "delete") res = await fetch(`${BASE}/api/trades/${id}`, { method: "DELETE" });
    else if (body.action === "restore") res = await fetch(`${BASE}/api/trades/${id}/restore`, { method: "POST" });
    else {
      let patch: Record<string, unknown>;
      if (body.action === "setResult") patch = { result: body.result };
      else if (body.action === "setSetup") patch = { setup: body.setup };
      else {
        const cur = splitTags(byId.get(id)?.tags);
        const lower = new Set(tags.map((t) => t.toLowerCase()));
        const next = body.action === "addTags"
          ? [...cur, ...tags.filter((t) => !cur.some((c) => c.toLowerCase() === t.toLowerCase()))]
          : cur.filter((c) => !lower.has(c.toLowerCase()));
        patch = { tags: next.length ? next.join(", ") : null };
      }
      res = await fetch(`${BASE}/api/trades/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    }
    return res.ok ? id : null;
  };
  const done = await Promise.all(body.ids.map((id) => one(id).catch(() => null)));
  const ok = done.filter((x): x is number => x != null);
  if (!ok.length) throw new Error("Ни одна сделка не изменена");
  return ok;
}
