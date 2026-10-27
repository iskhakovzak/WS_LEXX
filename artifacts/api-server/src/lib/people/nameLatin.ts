/** users.name_latin validation, shared by the admin edit (lib/peopleDirectory) and the rename CLI (no app imports). */
/** Trim, collapse spaces, cap length; empty → null. Letters (any script), digits, spaces, . - ' ʻ only. */
/** Failure carries an API error code (+ params) — the route throws AppError(code, 400, params). */
export function cleanNameLatin(raw: unknown):
  | { ok: true; value: string | null }
  | { ok: false; code: "INVALID_FIELD" | "TEXT_TOO_LONG" | "NAME_LATIN_CHARS"; params?: { field: string; max?: number } } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, code: "INVALID_FIELD", params: { field: "nameLatin" } };
  const v = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!v) return { ok: true, value: null };
  if (v.length > 80) return { ok: false, code: "TEXT_TOO_LONG", params: { field: "nameLatin", max: 80 } };
  if (!/^[\p{L}\p{N} .'ʻʼ’`-]+$/u.test(v)) return { ok: false, code: "NAME_LATIN_CHARS" };
  return { ok: true, value: v };
}
