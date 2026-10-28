/** «Распределение риска» building blocks: one trader row (decision, limits, edge, why) and the applied-changes list. */
import * as React from "react";
import { Undo2 } from "lucide-react";
import { Pill, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDate, fmtUsd } from "@/lib/format";
import { capitalI18n } from "@/i18n/ns/capital";
import { personName } from "@/i18n";
import type { CapitalChange, CapitalRow, Direction } from "./capital-api";
import { useRevertCapital } from "./capital-api";

export const DIRECTION_TONE: Record<Direction, Tone> = { raise: "up", keep: "neutral", cut: "down" };

const usd = (v: number | null | undefined) => (v == null ? "—" : fmtUsd(v, { decimals: 0 }));
const signedUsd = (v: number | null | undefined) => (v == null ? "—" : fmtUsd(v, { decimals: 0, signed: true }));

function Change({ from, to }: { from: number | null; to: number | null }) {
  if (from === to) return <span className="tabular-nums">{usd(from)}</span>;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-muted-foreground">{usd(from)}</span> <span aria-hidden="true">→</span> <span className="font-medium text-foreground">{usd(to)}</span>
    </span>
  );
}

export function DecisionPill({ row }: { row: Pick<CapitalRow, "direction" | "stepPct"> }) {
  const { t } = capitalI18n.useT();
  const pct = row.direction === "keep" ? "" : ` ${row.stepPct > 0 ? "+" : ""}${row.stepPct}%`;
  return <Pill tone={DIRECTION_TONE[row.direction]} dot>{t(`direction.${row.direction}`)}{pct}</Pill>;
}

export function CapitalRowView({ row, onOpenTrader }: { row: CapitalRow; onOpenTrader?: (trader: string) => void }) {
  const { t } = capitalI18n.useT();
  const [open, setOpen] = React.useState(false);
  const edge = row.regime?.usdPerDay ?? row.edge.usdPerDay;
  const [first, ...rest] = row.why;
  return (
    <tr className="align-top">
      <td>
        <button type="button" className="font-medium text-foreground hover:underline" onClick={() => onOpenTrader?.(row.trader)}>{personName(row.trader)}</button>
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-1.5">
          <DecisionPill row={row} />
          {row.pendingId != null && <Pill tone="warn">{t("queued")}</Pill>}
        </div>
      </td>
      <td><Change from={row.current.dailyLossLimit} to={row.proposed.dailyLossLimit} /></td>
      <td><Change from={row.current.buyingPower} to={row.proposed.buyingPower} /></td>
      <td className={cn("whitespace-nowrap text-right tabular-nums", edge && edge.theta > 0 ? "text-up" : edge && edge.theta < 0 ? "text-down" : "")} title={edge ? `80%: ${signedUsd(edge.lo)} … ${signedUsd(edge.hi)}` : undefined}>
        {edge ? signedUsd(edge.theta) : "—"}
      </td>
      <td className="text-right tabular-nums">{row.discipline == null ? "—" : `${row.discipline}/100`}</td>
      <td className="min-w-[260px] max-w-[460px]">
        <p className="text-xs text-foreground/90">{first}</p>
        {rest.length > 0 && (
          <>
            {open && <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">{rest.map((w, i) => <li key={i}>• {w}</li>)}</ul>}
            <button type="button" className="mt-0.5 text-2xs text-muted-foreground underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "−" : "+"} {t("whyMore")}
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

export function CapitalHistory({ items, canDecide }: { items: CapitalChange[]; canDecide: boolean }) {
  const { t } = capitalI18n.useT();
  const { toast } = useToast();
  const revert = useRevertCapital();
  if (!items.length) return <p className="text-xs text-muted-foreground">{t("historyEmpty")}</p>;
  const run = async (h: CapitalChange) => {
    try {
      await revert.mutateAsync(h.id);
      toast({ title: t("revertDone", { trader: personName(h.trader) }) });
    } catch (e) {
      toast({ title: t("revertFailed"), description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <ul className="flex flex-col gap-1.5">
      {items.slice(0, 6).map((h) => (
        <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-foreground">{personName(h.trader)}</span>
          <Pill tone={h.action === "raise" ? "up" : "down"}>{t(`direction.${h.action === "raise" ? "raise" : "cut"}`)}</Pill>
          <Change from={h.before?.dailyLossLimit ?? null} to={h.after?.dailyLossLimit ?? null} />
          <span className="text-2xs text-muted-foreground">{fmtDate(h.createdAt, "dateTime")} · {personName(h.actor)}</span>
          {h.reverted ? (
            <Pill tone="neutral">{t("reverted")}</Pill>
          ) : canDecide ? (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => run(h)} disabled={revert.isPending}>
              <PendingIcon pending={revert.isPending && revert.variables === h.id} icon={Undo2} className="h-3.5 w-3.5" /> {t("revert")}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
