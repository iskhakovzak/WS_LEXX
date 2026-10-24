/**
 * Server copy of the reader's quote preferences: `users.settings.quotes` (seed, favourites, categories) through the
 * personal settings endpoint (GET / PUT /api/users/me/settings — own row only; schema in api-server
 * lib/people/quotePrefs.ts). The local mirror lives in ./store.ts.
 */
import { http } from "@/lib/api/http";
import { parsePrefs, type QuotePrefs } from "./store";

const SETTINGS_API = "/api/users/me/settings";

export async function fetchQuotePrefs(): Promise<QuotePrefs | null> {
  const r = await http.get<{ settings?: { quotes?: unknown } } | null>(SETTINGS_API);
  const raw = r?.settings?.quotes;
  return raw ? parsePrefs(raw) : null;
}

export async function saveQuotePrefs(p: QuotePrefs): Promise<void> {
  await http.put(SETTINGS_API, { quotes: p });
}

/** A fresh rotation seed (32-bit). */
export function newSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  } catch {
    return Math.floor(Math.random() * 0xffffffff);
  }
}
