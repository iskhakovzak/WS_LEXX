/**
 * The curator's evening digest (roadmap R3, lib/curatorDigest), rendered per reader (texts: `notifications`
 * namespace, `curator_digest.*`):
 *   curator_digest  { date (YYYY-MM-DD), closed, unreviewed, n, trader1..n, reason1..n (cost-queue reason kind), cost1..n ($ preformatted) }
 * Names are data (shown as this reader sees them).
 */
import type { NotificationRenderer } from "../notificationText";
import { personNameFor } from "../people/latinNames";

const escapeHtml = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const curatorDigest: NotificationRenderer = ({ params, lang, tr, date }) => {
  const day = str(params.date);
  if (!day) return null;
  const head = tr("curator_digest.title", { date: date(day) });
  const counts = tr("curator_digest.body", { closed: num(params.closed), unreviewed: num(params.unreviewed) });
  if (!head || !counts) return null;
  const lines: { plain: string; html: string }[] = [];
  for (let i = 1; i <= Math.min(10, num(params.n)); i++) {
    const trader = str(params[`trader${i}`]);
    if (!trader) continue;
    const who = personNameFor(trader, lang);
    const reason = tr(`curator_digest.reason.${str(params[`reason${i}`]) ?? "other"}`) ?? tr("curator_digest.reason.other") ?? "";
    const cost = str(params[`cost${i}`]);
    const plain = tr(cost ? "curator_digest.lineCost" : "curator_digest.line", { n: i, trader: who, reason, cost: cost ?? "" }) ?? "";
    const html = tr(cost ? "curator_digest.lineCost" : "curator_digest.line", { n: i, trader: `<b>${escapeHtml(who)}</b>`, reason: escapeHtml(reason), cost: escapeHtml(cost ?? "") }) ?? "";
    lines.push({ plain, html });
  }
  const top = lines.length ? tr("curator_digest.top") : tr("curator_digest.nothing");
  return {
    title: head,
    body: [counts, top, ...lines.map((l) => l.plain)].filter(Boolean).join("\n"),
    telegram: [`<b>${escapeHtml(head)}</b>`, escapeHtml(counts), top ? escapeHtml(top) : "", ...lines.map((l) => l.html)].filter(Boolean).join("\n"),
  };
};

export const curatorRenderers: Record<string, NotificationRenderer> = {
  curator_digest: curatorDigest,
};
