import { en, type Dict } from "./en";
import { es } from "./es";

export type Locale = "en" | "es";
export const LOCALES: readonly Locale[] = ["en", "es"];

const DICTS: Record<Locale, Dict> = { en, es };

export const t = (locale: Locale): Dict => DICTS[locale];

/** "/" or "/es/" joined with a page slug ("" = home). */
export function pathFor(locale: Locale, slug = ""): string {
  const base = locale === "en" ? "/" : `/${locale}/`;
  return slug ? `${base}${slug}/` : base;
}
