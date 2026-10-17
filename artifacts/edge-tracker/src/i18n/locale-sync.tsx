/**
 * Keeps the UI language and the user profile (`users.locale`) in sync. Renders nothing; mount once inside
 * AuthProvider.
 *
 *  - The user picks a language while signed in as a member → PATCH /api/users/me/locale.
 *  - Picked before sign-in (login page), as a guest, or the save failed (offline / old API) → remembered as
 *    pending and saved on the next member session.
 *  - A member session starts with nothing pending → the profile language wins (GET /api/auth/me → locale), so a
 *    new device opens in the user's language.
 */
import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { BASE } from "@/lib/api";
import { getLang, isLang, onLangChange, setLang, LANG_PENDING_KEY, type Lang } from ".";

function setPending(on: boolean) {
  try {
    if (on) localStorage.setItem(LANG_PENDING_KEY, "1");
    else localStorage.removeItem(LANG_PENDING_KEY);
  } catch { /* storage blocked */ }
}
function isPending(): boolean {
  try { return localStorage.getItem(LANG_PENDING_KEY) === "1"; } catch { return false; }
}

async function saveProfileLang(lang: Lang): Promise<void> {
  try {
    const r = await fetch(`${BASE}/api/users/me/locale`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: lang }),
    });
    setPending(!r.ok);
  } catch {
    setPending(true);
  }
}

export function LocaleSync() {
  const { user } = useAuth();
  const token = user?.token ?? null;
  const member = !!token && !!user?.traderName && user.role !== "guest";
  const memberRef = useRef(member);
  memberRef.current = member;

  useEffect(
    () =>
      onLangChange((lang, source) => {
        if (source !== "user") return;
        if (memberRef.current) void saveProfileLang(lang);
        else setPending(true);
      }),
    [],
  );

  useEffect(() => {
    if (!member) return;
    if (isPending()) {
      void saveProfileLang(getLang());
      return;
    }
    let cancelled = false;
    fetch(`${BASE}/api/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { locale?: unknown } | null) => {
        if (cancelled || isPending()) return;
        const locale = body?.locale;
        if (isLang(locale) && locale !== getLang()) void setLang(locale, { source: "profile" });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [member, token]);

  return null;
}
