/**
 * «Ошибки» — pure helpers (unit-tested in app-errors-model.test.ts, OWNER-23): which rows are developer noise (a hot
 * code reload leaves a stale module: «useAuth must be used within an AuthProvider», «Cannot read properties of null
 * (reading 'useState')», «xI18n is not defined»), and how serious an error is.
 */

export type ErrorSeverity = "high" | "medium" | "low";

type Row = { source: string; kind: string; message: string; status: number | null };

const DEV_NOISE: readonly RegExp[] = [
  /must be used within an? \w+Provider/i,
  /Cannot read properties of null \(reading 'use[A-Z]\w*'\)/,
  /Should have a queue\. You are likely calling Hooks conditionally/i,
  /Invalid hook call/i,
  /getOptimisticResult is not a function/,
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i,
  /\[vite\]|\[hmr\]/i,
];
/** A bare identifier «fooI18n is not defined» / «useRef is not defined» from the browser = an edit in progress. */
const UNDEFINED_ID = /^[A-Za-z_$][\w$]* is not defined$/;

/** Browser errors that only a developer's hot reload produces (never sent for the owner to act on). */
export function isDevNoise(row: Row): boolean {
  if (row.source !== "client") return false;
  if (DEV_NOISE.some((re) => re.test(row.message))) return true;
  return /ReferenceError$/.test(row.kind) && UNDEFINED_ID.test(row.message.trim());
}

/**
 * high: the server failed (5xx or no status) · medium: a screen crashed in the browser (render error) ·
 * low: everything else (a handled browser error, CSP report, 4xx).
 */
export function severityOf(row: Row): ErrorSeverity {
  if (row.source === "server") return row.status != null && row.status < 500 ? "low" : "high";
  if (row.source === "client" && row.kind.startsWith("render:")) return "medium";
  return "low";
}
