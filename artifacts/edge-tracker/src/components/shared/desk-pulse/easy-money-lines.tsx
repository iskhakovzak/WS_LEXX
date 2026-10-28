/**
 * «Лёгкие деньги дня» in the trader's debrief: personal lines — «взял: X», «упустил: Y» — stored with the debrief digest
 * as codes (api lib/mentor applyRhythm → lib/deskPulse personalLines) and rendered here in the viewer's language. Each
 * line says the move size and where it was seen (the sources); a took / against line carries the trader's own net.
 */
import { Coins } from "lucide-react";
import { toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import { moveText, setupText, type EasyLine } from "./easy-api";

const TONE = { took: "up", against: "down", skipped: "warn", missed: "neutral" } as const;

export function EasyMoneyLines({ lines, className }: { lines: readonly EasyLine[] | null | undefined; className?: string }) {
  const { t } = deskPulseI18n.useT();
  if (!lines?.length) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Coins className="h-3.5 w-3.5" aria-hidden="true" />
        {t("easy.debriefTitle")}
      </p>
      <ul className="flex flex-col gap-1">
        {lines.map((l) => {
          const p = { ticker: l.ticker, move: moveText(l), setup: setupText(l), net: fmtUsd(l.net, { signed: true, decimals: 0 }) };
          return (
            <li key={l.ticker} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className={cn(l.status === "missed" ? "text-foreground" : toneText(l.status === "took" ? ((l.net ?? 0) >= 0 ? "up" : "down") : TONE[l.status]))}>
                {t(`easy.line.${l.status}`, p)}
              </span>
              <span className="text-xs text-muted-foreground">· {l.sources.map((s) => t(`easy.source.${s}`)).join(", ")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
