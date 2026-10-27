/** KPI strip helpers shared by StatCard / StatGrid (components/ds.tsx). */
import * as React from "react";

/** Inside a StatGrid strip: StatCards draw as flat cells of the one panel (label above the number, hairline dividers). */
export const StatStripContext = React.createContext(false);

const ZERO_RE = /^[+−-]?\$?0(?:[.,]0+)?\s*(?:%|R)?$/;
/** A KPI value that is a plain zero (0, $0, 0.0%, 0R): drawn muted, and a StatGrid may fold it into «Всё чисто». */
export function isZeroValue(v: React.ReactNode): boolean {
  if (typeof v === "number") return v === 0;
  return typeof v === "string" && ZERO_RE.test(v.trim());
}
