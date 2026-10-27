/** Indicator alerts of /indicators («сообщить, когда VIX выше 20»): one threshold rule per indicator. Pure. */

export type AlertRule = { op: "above" | "below"; value: number };

export function alertFires(rule: AlertRule, v: number | null): boolean {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return rule.op === "above" ? v > rule.value : v < rule.value;
}
