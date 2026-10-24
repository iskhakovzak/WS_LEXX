/**
 * «Мой edge и рынок» (analytics tab): what works best for one trader (strengths / leaks of the pre-trade buckets),
 * the market backdrop and their edge, and this period vs the previous one. Server-computed (GET /api/my-edge/*) on
 * the page filters, the custom period and «Разрезы»; staff on «Вся команда» are asked to pick a person.
 */
import { Users } from "lucide-react";
import { EmptyState, Panel } from "@/components/ds";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import { filtersRange, type AnalyticsFilters } from "../metrics";
import { useCompare, useMarket, useStrengths } from "./api";
import { StrengthsBlock } from "./StrengthsBlock";
import { MarketBlock } from "./MarketBlock";
import { CompareBlock } from "./CompareBlock";

export function MyEdgeTab({ filters, team }: { filters: AnalyticsFilters; team: boolean }) {
  const { t } = myEdgeI18n.useT();
  const on = !team;
  const s = useStrengths(filters, on);
  const m = useMarket(filters, on);
  const c = useCompare(filters, on);
  if (team) {
    return (
      <Panel>
        <EmptyState icon={Users} title={t("teamPick.title")} description={t("teamPick.description")} />
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <StrengthsBlock data={s.data} isLoading={s.isLoading} isError={s.isError} filters={filters} />
      <MarketBlock data={m.data} isLoading={m.isLoading} isError={m.isError} filters={filters} />
      <CompareBlock data={c.data} isLoading={c.isLoading} isError={c.isError} hasPeriod={!!filtersRange(filters)} />
    </div>
  );
}
