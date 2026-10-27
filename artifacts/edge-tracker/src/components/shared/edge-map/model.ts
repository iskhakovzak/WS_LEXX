/**
 * Edge map view model (pure; tested in model.test.ts): slice key → human label, $ per day with its 80% interval.
 * Slice keys come from the server (api lib/edgeMap.ts): `family:value`.
 */
import { fmtUsd } from "@/lib/format";
import { coachI18n } from "@/i18n/ns/coach";
import type { EdgeVerdict } from "./api";

const t = (k: string, p?: Record<string, string | number>) => coachI18n.tryT(`edgeMap.slice.${k}`, p);

/** «5-10» → «$5–10», «lt5» → «< $5», «gt200» → «> $200». */
function priceRange(v: string): string {
  if (v.startsWith("lt")) return `< $${v.slice(2)}`;
  if (v.startsWith("gt")) return `> $${v.slice(2)}`;
  return `$${v.replace("-", "–")}`;
}

/** Human label of a slice key; an unknown key is shown as is. */
export function sliceLabel(key: string): string {
  const i = key.indexOf(":");
  const family = key.slice(0, i);
  const value = key.slice(i + 1);
  switch (family) {
    case "time":
      if (value === "before-8:30") return t("timeBefore") ?? key;
      if (value === "after-16:00") return t("timeAfter") ?? key;
      return t("timeRange", { range: value.replace("-", "–") }) ?? key;
    case "seq":
      if (value === "4-5") return t("seq45") ?? key;
      if (value === "6+") return t("seq6") ?? key;
      return t("seqN", { n: value }) ?? key;
    case "price":
      return t("price", { range: priceRange(value) }) ?? key;
    case "rapid":
      return t("rapid") ?? key;
    default:
      return t(`${family}.${value}`) ?? key;
  }
}

const usd = (v: number, signed = true) => fmtUsd(v, { signed, decimals: "auto" });

/** «−$4.20 в день». */
export function perDayText(v: Pick<EdgeVerdict, "perDay">): string {
  return coachI18n.t("edgeMap.perDay", { value: usd(v.perDay) });
}

/** «80%: −$6.10 … −$2.30». */
export function intervalText(v: Pick<EdgeVerdict, "perDayLo" | "perDayHi">): string {
  return coachI18n.t("edgeMap.interval", { lo: usd(v.perDayLo), hi: usd(v.perDayHi) });
}
