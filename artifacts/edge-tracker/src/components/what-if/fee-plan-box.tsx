/**
 * Staff-only commission-plan what-if (roadmap R2.4): the page's trades re-priced under another broker plan
 * (POST /api/whatif/run with one commissionPlan rule — the API refuses it to non-staff). Traders never see tariff
 * what-ifs (owner 2026-10-22); the plan itself stays an owner decision, this only shows the money.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http } from "@/lib/api/http";
import { fmtUsd } from "@/lib/format";
import { coachI18n } from "@/i18n/ns/coach";
import type { CommissionPlan } from "@/components/shared/what-if-rules";
import type { RunResponse, Scope } from "@/components/what-if/api";

/** The desk's tariff preset (api lib/whatIf PRESET_RULES «tariff») when the server sent none. */
const FALLBACK: CommissionPlan = { type: "commissionPlan", perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: true };

type Field = "perShare" | "minPerOrder" | "ecnPerShare";
const FIELDS: Field[] = ["perShare", "minPerOrder", "ecnPerShare"];

export function FeePlanBox({ scope, preset }: { scope: Scope; preset?: CommissionPlan | null }) {
  const { t } = coachI18n.useT();
  const [plan, setPlan] = useState<CommissionPlan>(preset ?? FALLBACK);
  const run = useMutation({
    mutationFn: () => http.post<RunResponse>("/api/whatif/run", {
      trader: scope.trader || undefined, from: scope.from || undefined, to: scope.to || undefined,
      ...Object.fromEntries(new URLSearchParams(scope.facets ?? "")), rules: [plan], iters: 200,
    }),
  });
  const r = run.data;
  return (
    <Panel title={t("plan.title")} icon={Calculator} description={t("plan.description")}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
        {FIELDS.map((f) => (
          <label key={f} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t(`plan.${f}`)}
            <Input
              type="number" inputMode="decimal" min={0} step={f === "minPerOrder" ? 0.05 : 0.0005} className="w-28"
              value={plan[f]} onChange={(e) => setPlan((p) => ({ ...p, [f]: Math.max(0, Number(e.target.value) || 0) }))}
            />
          </label>
        ))}
        <Button type="submit" size="sm" disabled={run.isPending}>{t("plan.run")}</Button>
      </form>
      {r && (
        <p className="mt-3 text-sm tabular-nums" role="status">
          {t("plan.result", {
            delta: fmtUsd(r.scenario.net - r.baseline.net, { signed: true, decimals: 0 }),
            before: fmtUsd(r.baseline.fees, { decimals: 0 }), after: fmtUsd(r.scenario.fees, { decimals: 0 }),
          })}
        </p>
      )}
      {run.isError && <p className="mt-3 text-sm text-down" role="alert">{t("plan.failed")}</p>}
    </Panel>
  );
}
