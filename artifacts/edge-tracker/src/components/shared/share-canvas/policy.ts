/**
 * Desk rules and remembered choices of the image cards (trade share card, «Итоги» story cards).
 *
 *   sharePolicy   GET /permissions/me → shareCards (api lib/settings/registry.ts shareCards.*): enabled + money
 *                 ("r_only" drops $ everywhere on a card)
 *   parsePrefs    the dialog choices kept in localStorage (theme, artwork, result mode, name, prices), validated
 */
import type { PermissionsMe } from "@/lib/permissions";

export type ResultMode = "usd" | "r" | "pct";
export type MoneyPolicy = "usd" | "r_only";
export type ThemeKind = "olymp" | "marble" | "night" | "photo";
export const THEME_KINDS: readonly ThemeKind[] = ["olymp", "marble", "night", "photo"];
export const RESULT_MODES: readonly ResultMode[] = ["usd", "r", "pct"];

/** Desk rules from /permissions/me (an older API without the field: on, $ allowed). */
export function sharePolicy(perms: Pick<PermissionsMe, "shareCards"> | null | undefined): { enabled: boolean; money: MoneyPolicy } {
  const s = perms?.shareCards;
  return { enabled: s ? s.enabled !== false : true, money: s?.money === "r_only" ? "r_only" : "usd" };
}

export interface SharePrefs {
  theme: ThemeKind;
  /** Artwork id within «Олимп» (art.ts OLYMP_ART). */
  art: string;
  mode: ResultMode;
  showName: boolean;
  showPrices: boolean;
}

export const DEFAULT_PREFS: SharePrefs = { theme: "olymp", art: "", mode: "usd", showName: true, showPrices: true };

/** localStorage key of the prefs (per signed-in user; the same key for every card kind). */
export const sharePrefsKey = (user: string | null | undefined) => `shareCard.prefs.${user ?? "me"}`;

/**
 * Saved prefs from localStorage, field by field (anything unknown → default). «Своё фото» is never restored: the photo
 * itself is not kept, so the dialog would open on an empty theme.
 */
export function parsePrefs(raw: unknown): SharePrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme = THEME_KINDS.includes(o.theme as ThemeKind) && o.theme !== "photo" ? (o.theme as ThemeKind) : DEFAULT_PREFS.theme;
  return {
    theme,
    art: typeof o.art === "string" ? o.art.slice(0, 60) : DEFAULT_PREFS.art,
    mode: RESULT_MODES.includes(o.mode as ResultMode) ? (o.mode as ResultMode) : DEFAULT_PREFS.mode,
    showName: typeof o.showName === "boolean" ? o.showName : DEFAULT_PREFS.showName,
    showPrices: typeof o.showPrices === "boolean" ? o.showPrices : DEFAULT_PREFS.showPrices,
  };
}
