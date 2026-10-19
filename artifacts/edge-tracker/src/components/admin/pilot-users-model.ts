/** Pure helpers of the «Участники пилота» picker (PilotUsersField): the comma list ↔ names, and name → trader. */
import type { DbUser } from "@/contexts/auth-context";

/** "a, b ,, c" → ["a", "b", "c"] (unique, order kept). */
export function parsePeopleList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const n = part.trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The trader a stored or Latin name refers to (case-insensitive for the Latin one). */
export function matchTrader(raw: string, traders: readonly Pick<DbUser, "name" | "nameLatin">[]): Pick<DbUser, "name" | "nameLatin"> | null {
  const low = raw.toLowerCase();
  return traders.find((u) => u.name === raw || u.name.toLowerCase() === low || (u.nameLatin ?? "").toLowerCase() === low) ?? null;
}
