/** Human label of an edge-map slice key («seq:4-5» → «Сделки #4–5») in `lang` — mirrors the web edge-map labels. */
import { coachT } from "../i18n/ns";
import type { Lang } from "../i18n";

export function sliceText(lang: Lang, key: string): string {
  const t = (k: string, p?: Record<string, string | number>) => coachT.tryFor(lang, `slice.${k}`, p);
  const i = key.indexOf(":");
  const family = key.slice(0, i);
  const value = key.slice(i + 1);
  if (family === "time") return (value === "before-8:30" ? t("timeBefore") : value === "after-16:00" ? t("timeAfter") : t("timeRange", { range: value.replace("-", "–") })) ?? key;
  if (family === "seq") return (value === "4-5" ? t("seq45") : value === "6+" ? t("seq6") : t("seqN", { n: value })) ?? key;
  if (family === "price") return t("price", { range: value.startsWith("lt") ? `< $${value.slice(2)}` : value.startsWith("gt") ? `> $${value.slice(2)}` : `$${value.replace("-", "–")}` }) ?? key;
  if (family === "rapid") return t("rapid") ?? key;
  return t(`${family}.${value}`) ?? key;
}
