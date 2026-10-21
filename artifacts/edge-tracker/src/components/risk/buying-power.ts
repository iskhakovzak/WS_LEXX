/**
 * Buying power per trader (Волна 1 п. 1.21, owner decision 7): a junior 25 000 – 800 000 $, above junior no upper cap
 * (only ≥ 25 000). The same bounds as the server (api routes/risk.ts PUT /risk/limits, lib/people/stageLimits).
 */
export const BP_MIN = 25_000;
export const BP_MAX_JUNIOR = 800_000;

/** null = fine (or empty); else the risk `form.*` message key. `tier` empty / junior / legacy trainee = the junior range. */
export function buyingPowerError(raw: string, tier: string): "errBpJunior" | "errBpMin" | null {
  const v = raw.trim() === "" ? null : Number(raw.replace(/[\s,]/g, ""));
  if (v == null || !Number.isFinite(v)) return null;
  const junior = !tier || tier === "junior" || tier === "trainee";
  if (v < BP_MIN) return junior ? "errBpJunior" : "errBpMin";
  return junior && v > BP_MAX_JUNIOR ? "errBpJunior" : null;
}
