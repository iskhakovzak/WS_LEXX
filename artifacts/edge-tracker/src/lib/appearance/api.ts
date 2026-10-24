/**
 * Server persistence of «Вид»: `users.settings.appearance` through the existing personal settings endpoint
 * (GET / PUT /api/users/me/settings — own row only, so nobody, admins included, can read another person's looks).
 * Plus a per-user localStorage copy, so the editor opens with the right state before the server answers.
 */
import { http } from "@/lib/api/http";
import { parseStored, type BgMotion, type StoredAppearance } from "./model";

const SETTINGS_API = "/api/users/me/settings";
const LOCAL_KEY = "ws_lexx_appearance";

export async function fetchStoredAppearance(): Promise<StoredAppearance | null> {
  const r = await http.get<{ settings?: { appearance?: unknown } } | null>(SETTINGS_API);
  const raw = r?.settings?.appearance;
  return raw ? parseStored(raw) : null;
}

export async function saveStoredAppearance(stored: StoredAppearance): Promise<void> {
  await http.put(SETTINGS_API, { appearance: stored });
}

/** The local copy belongs to one account: another person signing in on this browser starts from their own. */
export function readLocalStored(user: string): StoredAppearance | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as { user?: string; stored?: unknown }) : null;
    return parsed && parsed.user === user ? parseStored(parsed.stored) : null;
  } catch {
    return null;
  }
}

export function writeLocalStored(user: string, stored: StoredAppearance): void {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ user, stored })); } catch { /* storage unavailable */ }
}

/**
 * «Движение фона» from the last look saved on this browser (whoever it belonged to): the sign-in screen and the
 * opening intro run before the account is known and follow it too.
 */
export function readLastBgMotion(): BgMotion {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as { stored?: unknown }) : null;
    return parsed?.stored ? parseStored(parsed.stored).current.bg.motion : "on";
  } catch {
    return "on";
  }
}
