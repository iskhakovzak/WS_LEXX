import * as React from "react";
import { Eye, Hand, LogOut, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReplayExtraCtx } from "@/components/chart-engine/types";
import { fmtUsd } from "@/lib/format";
import { chartLabI18n } from "@/i18n/ns/chartLab";
import { cn } from "@/lib/utils";
import { type Choice, type Outcome, inPosition, outcomeAt, verdictOf } from "./decision";

type Drill = { phase: "idle" } | { phase: "frozen"; at: number } | { phase: "revealed"; at: number; choice: Choice; outcome: Outcome };

/**
 * Replay side card of /chart-lab:
 *   - «Выйти сейчас»: while the position is open, what exiting at the cursor would give on the whole trade against what
 *     the real trade made (the P&L of the decision, live as the replay moves);
 *   - «Заморозить и угадать»: freeze at the entry (or here), the future stays hidden, choose «держу» / «выхожу», then
 *     the rest is revealed (the cursor jumps to the real exit) and both outcomes are compared.
 */
export function DecisionDrill({ ctx }: { ctx: ReplayExtraCtx }) {
  const { t } = chartLabI18n.useT();
  const [drill, setDrill] = React.useState<Drill>({ phase: "idle" });
  const { cursorIdx, bars, fills, side, qty, entryIdx, exitIdx } = ctx;
  const open = fills.length > 0 && inPosition(fills, cursorIdx, side, bars, qty) && (exitIdx == null || cursorIdx < exitIdx);
  const live = open ? outcomeAt(fills, cursorIdx, side, bars, qty) : null;
  const fmt = (v: number | null, unit: Outcome["unit"]) => (v == null ? "—" : `${fmtUsd(v, { signed: true, decimals: "auto" })}${unit === "perShare" ? t("drill.perShare") : ""}`);
  // Leaving the frozen bar (a step, a seek) before choosing ends the drill: the future may already be on screen.
  React.useEffect(() => { if (drill.phase === "frozen" && cursorIdx !== drill.at) setDrill({ phase: "idle" }); }, [cursorIdx, drill]);

  const freeze = (at: number) => { ctx.pause(); ctx.seek(at); setDrill({ phase: "frozen", at }); };
  const choose = (choice: Choice) => {
    if (drill.phase !== "frozen") return;
    const outcome = outcomeAt(fills, drill.at, side, bars, qty);
    setDrill({ phase: "revealed", at: drill.at, choice, outcome });
    if (exitIdx != null) ctx.seek(exitIdx);
  };

  if (!fills.length || entryIdx == null) return null;
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-sm" aria-label={t("drill.title")}>
      <p className="flex items-center gap-1.5 text-xs font-semibold"><Snowflake className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {t("drill.title")}</p>
      {drill.phase === "idle" && (
        <>
          {live && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("drill.exitNow")} <span className={cn("font-semibold", (live.exitNow ?? 0) >= 0 ? "text-up" : "text-down")}>{fmt(live.exitNow, live.unit)}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => freeze(entryIdx)}>{t("drill.freezeEntry")}</Button>
            {open && cursorIdx !== entryIdx && <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => freeze(cursorIdx)}>{t("drill.freezeHere")}</Button>}
          </div>
          <p className="text-2xs text-muted-foreground">{t("drill.hint")}</p>
        </>
      )}
      {drill.phase === "frozen" && (
        <>
          <p className="text-xs text-muted-foreground">{t("drill.ask")}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-8 rounded-full bg-primary-solid" onClick={() => choose("hold")}><Hand className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("drill.hold")}</Button>
            <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => choose("exit")}><LogOut className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("drill.exit")}</Button>
          </div>
        </>
      )}
      {drill.phase === "revealed" && <Reveal drill={drill} fmt={fmt} onAgain={() => setDrill({ phase: "idle" })} />}
    </section>
  );
}

function Reveal({ drill, fmt, onAgain }: { drill: Extract<Drill, { phase: "revealed" }>; fmt: (v: number | null, unit: Outcome["unit"]) => string; onAgain: () => void }) {
  const { t } = chartLabI18n.useT();
  const v = verdictOf(drill.choice, drill.outcome);
  const u = drill.outcome.unit;
  return (
    <div className="flex flex-col gap-1.5 tabular-nums" aria-live="polite">
      <p className="flex items-center gap-1 text-xs"><Eye className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {t(drill.choice === "hold" ? "drill.youHeld" : "drill.youExited")}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">{t("drill.optionExit")}</dt><dd className="text-right">{fmt(drill.outcome.exitNow, u)}</dd>
        <dt className="text-muted-foreground">{t("drill.optionHold")}</dt><dd className="text-right">{fmt(drill.outcome.hold, u)}</dd>
      </dl>
      {v.better != null && v.diff != null && (
        <p className={cn("text-sm font-semibold", v.better ? "text-up" : "text-down")}>
          {t(v.better ? "drill.better" : "drill.worse", { amount: fmt(Math.abs(v.diff), u).replace(/^\+/, "") })}
        </p>
      )}
      {v.better == null && <p className="text-sm text-muted-foreground">{t("drill.same")}</p>}
      <Button size="sm" variant="ghost" className="h-8 self-start rounded-full" onClick={onAgain}>{t("drill.again")}</Button>
    </div>
  );
}
