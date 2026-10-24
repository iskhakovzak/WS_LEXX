/**
 * The volatile part of every request — who asks, from which page, about what — goes into the USER turn as a
 * <context> block (never into the system prompt, which stays a frozen cached prefix). Page context comes from the
 * web panel as structured fields (route, selected trade / day / period / facets, playbook id); it is validated and
 * size-limited here. Past turns are replayed as plain text (drafts as a one-line note), newest last, within a budget.
 */
import { z } from "zod";
import type { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { Lang } from "../../i18n";

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const short = (n: number) => z.string().trim().max(n);

export const PageContextSchema = z.object({
  route: short(300).optional(),
  title: short(120).optional(),
  tradeId: z.number().int().positive().optional(),
  date: YMD.optional(),
  from: YMD.optional(),
  to: YMD.optional(),
  trader: short(120).optional(),
  playbookId: z.number().int().positive().optional(),
  facets: z.record(z.union([short(200), z.number().finite(), z.boolean(), z.array(short(80)).max(20)])).optional()
    .refine((f) => !f || Object.keys(f).length <= 24, "too many facets"),
}).strip();
export type PageContext = z.infer<typeof PageContextSchema>;

export type Asker = { name: string; role: string; stage: string | null };

export function buildUserTurn(args: { today: string; lang: Lang; asker: Asker; page?: PageContext | null; intent?: string | null; message: string }): string {
  const { today, lang, asker, page, intent, message } = args;
  const lines = [
    `today (New York): ${today}`,
    `interface language: ${lang}`,
    `user: ${asker.name} (role: ${asker.role}${asker.stage ? `, stage: ${asker.stage}` : ""})`,
  ];
  if (page?.route) lines.push(`page: ${page.route}`);
  if (page?.title) lines.push(`page title: ${page.title}`);
  if (page?.trader) lines.push(`trader on the page: ${page.trader}`);
  if (page?.tradeId) lines.push(`selected trade id: ${page.tradeId}`);
  if (page?.date) lines.push(`selected day: ${page.date}`);
  if (page?.from || page?.to) lines.push(`selected period: ${page.from ?? "…"} – ${page.to ?? "…"}`);
  if (page?.playbookId) lines.push(`selected playbook setup id: ${page.playbookId}`);
  if (page?.facets && Object.keys(page.facets).length) lines.push(`filters: ${JSON.stringify(page.facets)}`);
  if (intent) lines.push(`intent: ${intent}`);
  return `<context>\n${lines.join("\n")}\n</context>\n\n${message}`;
}

export type HistoryRow = { role: "user" | "assistant"; content: string; drafts: unknown };

const HISTORY_MAX_MESSAGES = 16;
const HISTORY_MAX_CHARS = 24_000;

function draftNote(drafts: unknown): string {
  if (!Array.isArray(drafts) || !drafts.length) return "";
  const names = drafts.map((d: any) => `${d?.kind ?? "draft"}${d?.draft?.name ? ` «${String(d.draft.name).slice(0, 80)}»` : ""}`);
  return `\n[Draft card(s) shown to the user, not saved by the assistant: ${names.join(", ")}]`;
}

/** Past turns (oldest → newest) as alternating text messages, trimmed to the budget, starting with a user turn. */
export function historyMessages(rows: readonly HistoryRow[]): Anthropic.MessageParam[] {
  const recent = rows.slice(-HISTORY_MAX_MESSAGES);
  const out: Anthropic.MessageParam[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i]!;
    const text = (r.role === "assistant" ? r.content + draftNote(r.drafts) : r.content).slice(0, 8000);
    if (!text.trim()) continue;
    if (chars + text.length > HISTORY_MAX_CHARS) break;
    chars += text.length;
    out.unshift({ role: r.role, content: text });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

export function historyChars(msgs: readonly Anthropic.MessageParam[]): number {
  return msgs.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
}
