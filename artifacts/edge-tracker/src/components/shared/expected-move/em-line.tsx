/**
 * One quiet line with a ticker's expected move on its report: «EM ±6.2% · опционы · 182.40 / 161.20», and after the
 * report its result («+9.3% — EM пробит»). The source is always named (a historical average is labelled so: it is not
 * what the market prices in). Renders nothing while loading or when the ticker has no report in the window.
 */
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { Pill, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtPct, fmtPrice } from "@/lib/format";
import { expectedMoveI18n } from "@/i18n/ns/expectedMove";
import { expectedMoveQuery } from "./api";

export function EmLine({ ticker, date, className }: { ticker: string; date?: string; className?: string }) {
  const { t } = expectedMoveI18n.useT();
  const q = useQuery(expectedMoveQuery(ticker, date));
  const e = q.data;
  if (!e || e.emPct == null) return null;
  const src = e.source === "implied" ? t("source.implied") : t("source.historical", { count: e.quarters ?? 0 });
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground", className)}>
      <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium text-foreground">{t("em", { value: fmtPct(e.emPct, { decimals: 1, signed: false }) })}</span>
      <span title={e.source === "historical" ? t("source.historicalHint") : t("source.impliedHint")}>{src}</span>
      {e.levels && <span>{t("levels", { up: fmtPrice(e.levels.up), down: fmtPrice(e.levels.down) })}</span>}
      {e.reaction && (
        <span className="inline-flex items-center gap-1.5">
          <span className={toneText(e.reaction.movePct > 0 ? "up" : e.reaction.movePct < 0 ? "down" : "neutral")}>{t("moved", { value: fmtPct(e.reaction.movePct, { decimals: 1 }) })}</span>
          {e.reaction.broken != null && <Pill tone={e.reaction.broken ? "warn" : "neutral"}>{t(e.reaction.broken ? "broken" : "held")}</Pill>}
        </span>
      )}
    </p>
  );
}
