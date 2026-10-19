/**
 * Desk ladder names as stored (risk tier templates / scaling: «Стажёр», «Джун», «Трейдер», «Сеньор», or the codes) →
 * the name in the UI language (common `tiers.*`). Anything else (an admin-made template name) is shown as stored.
 */
import { commonI18n } from "@/i18n/ns/common";

type TierKey = "intern" | "junior" | "trader" | "senior";
const KNOWN: Record<string, TierKey> = {
  "стажёр": "intern", "стажер": "intern", trainee: "intern", intern: "intern", // i18n-ignore (stored names)
  "джун": "junior", junior: "junior", // i18n-ignore
  "трейдер": "trader", trader: "trader", // i18n-ignore
  "сеньор": "senior", senior: "senior", // i18n-ignore
};

export function tierDisplay(stored: string | null | undefined): string {
  const raw = (stored ?? "").trim();
  const key = KNOWN[raw.toLowerCase()];
  return key ? commonI18n.t(`tiers.${key}`) : raw;
}
