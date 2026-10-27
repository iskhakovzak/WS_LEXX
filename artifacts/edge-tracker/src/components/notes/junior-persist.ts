/**
 * Safety net of the junior's day summary (persistence audit, docs/persistence/AUDIT.md): every edit is mirrored in this
 * browser until the server confirms it, so a reload during a failed save or an API restart brings the text back;
 * plus the account-level prefs (template, quick replies) parsers for hooks/use-server-pref.
 */
import { ApiError } from "@/lib/api/http";
import { notesI18n } from "@/i18n/ns/notes";
import type { Sections, Template } from "./junior-lib";

export type LocalNote = { date: string; sections: Sections; mood: string };

const PREFIX = "ws_lexx_junior_unsaved:";
const key = (trader: string, date: string) => `${PREFIX}${trader}|${date}`;

export function keepLocalNote(trader: string, p: LocalNote): void {
  try { localStorage.setItem(key(trader, p.date), JSON.stringify(p)); } catch { /* storage blocked: memory only */ }
}

export function readLocalNote(trader: string, date: string): LocalNote | null {
  try {
    const raw = localStorage.getItem(key(trader, date));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LocalNote>;
    const sections = parseSections(p.sections);
    return sections ? { date, sections, mood: typeof p.mood === "string" ? p.mood : "" } : null;
  } catch {
    return null;
  }
}

/** Drop the local copy once the server holds exactly it (a newer local edit stays). */
export function dropLocalNote(trader: string, p: LocalNote): void {
  try {
    const raw = localStorage.getItem(key(trader, p.date));
    if (raw != null && raw === JSON.stringify(p)) localStorage.removeItem(key(trader, p.date));
  } catch { /* ignore */ }
}

/** The local copy says something the server copy does not. */
export function localDiffers(local: LocalNote, sections: Sections, mood: string): boolean {
  const norm = (s: Sections) => JSON.stringify(Object.entries(s).filter(([, v]) => v?.trim()).sort());
  return norm(local.sections) !== norm(sections) || (local.mood || "") !== (mood || "");
}

/** Worth retrying later: no answer, or the server's own failure (a refusal of the content is not retried). */
export function retryableSave(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}

export function parseSections(v: unknown): Sections | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Sections = {};
  for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (typeof s === "string") (out as Record<string, string>)[k] = s;
  return out;
}

export function parseSnippets(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 10) : null;
}

/** The personal template from the account copy of its sections. */
export function myTemplateOf(s: Sections | null): Template | null {
  return s && Object.keys(s).length ? { id: "mine", get label() { return notesI18n.t("myTemplate"); }, sections: s } : null;
}
