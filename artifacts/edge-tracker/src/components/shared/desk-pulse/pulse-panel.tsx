/**
 * «Пульс деска: что работает в сезоне» on Big7 (GET /api/desk-pulse): ONE line first (what works, what does not —
 * figure-ground), then the setup family × timing matrix of the desk window. A cell shows its count and win rate, the
 * net without the three best trades (the robust-edge rule) or the median R, and «На выбросах» when the edge rests on a
 * few trades. Grey = below the minimum sample (never judged); a cell under the people minimum shows no numbers to a
 * trader. Every number is the api's; nothing is computed here.
 */
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { Panel, Pill, QueryState, TableScroll, toneText, type Tone } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtDate, fmtR, fmtRate, fmtUsd } from "@/lib/format";
import { TIMINGS, timingLabel } from "@/components/shared/session-flow/timing";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import { FAMILIES, deskPulseQuery, familyLabel, pulseLine, type DeskPulse, type PulseCell } from "./api";

const VERDICT_TONE: Record<string, Tone> = { works: "up", fails: "down", mixed: "neutral" };
const signTone = (v: number | null | undefined): Tone => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");

function Cell({ c, p }: { c: PulseCell; p: DeskPulse }) {
  const { t } = deskPulseI18n.useT();
  const hidden = c.winrate == null && c.traders == null;
  const title = t("pulse.aria", { family: familyLabel(c.family), timing: timingLabel(c.timing) });
  if (hidden) {
    return <td className="px-2 py-1.5 align-top text-xs text-muted-foreground opacity-60" title={t("pulse.hidden", { people: p.minTraders })} aria-label={title}>{t("pulse.thin", { n: c.n })}</td>;
  }
  const money = c.netExTop3 != null;
  return (
    <td className={cn("px-2 py-1.5 align-top", c.thin && "opacity-50")} aria-label={title} title={c.thin ? t("pulse.thin", { n: c.n }) : undefined}>
      <div className="flex min-w-[7.5rem] flex-col gap-0.5 text-xs">
        <span className="text-muted-foreground tabular-nums">{t("pulse.cell", { n: c.n, wr: fmtRate(c.winrate) })}</span>
        {money && <span className={cn("font-medium tabular-nums", toneText(signTone(c.netExTop3)))}>{t("pulse.exTop3", { value: fmtUsd(c.netExTop3, { signed: true, decimals: 0 }) })}</span>}
        {c.medianR != null && <span className={cn("tabular-nums", toneText(signTone(c.medianR)))}>{t("pulse.medianR", { value: fmtR(c.medianR, 2) })}</span>}
        <span className="flex flex-wrap gap-1">
          {c.verdict && c.verdict !== "mixed" && <Pill tone={VERDICT_TONE[c.verdict]}>{t(`pulse.${c.verdict}`)}</Pill>}
          {c.outliers && <Pill tone="warn">{t("pulse.outliers")}</Pill>}
        </span>
      </div>
    </td>
  );
}

function Matrix({ p }: { p: DeskPulse }) {
  const { t } = deskPulseI18n.useT();
  const timings = TIMINGS.filter((k) => p.cells.some((c) => c.timing === k));
  const families = FAMILIES.filter((f) => p.cells.some((c) => c.family === f));
  const by = new Map(p.cells.map((c) => [`${c.family}|${c.timing}`, c]));
  return (
    <TableScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium">
            <th>{t("pulse.family")}</th>
            {timings.map((k) => <th key={k} className="whitespace-nowrap">{timingLabel(k)}</th>)}
          </tr>
        </thead>
        <tbody>
          {families.map((f) => (
            <tr key={f} className="border-t border-border/40">
              <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left align-top text-xs font-medium">{familyLabel(f)}</th>
              {timings.map((k) => {
                const c = by.get(`${f}|${k}`);
                return c ? <Cell key={k} c={c} p={p} /> : <td key={k} className="px-2 py-1.5 text-xs text-muted-foreground/60">·</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export function DeskPulsePanel({ className }: { className?: string }) {
  const { t } = deskPulseI18n.useT();
  const q = useQuery(deskPulseQuery());
  const p = q.data;
  return (
    <Panel
      className={className}
      title={t("pulse.title")}
      icon={Activity}
      description={p ? t("pulse.hint", { days: p.windowDays, from: fmtDate(p.from, "dayMonth"), to: fmtDate(p.to, "dayMonth"), trades: p.minTrades, people: p.minTraders }) : undefined}
    >
      <QueryState query={q} errorCompact errorTitle={t("pulse.loadFailed")}>
        {(d) => !d.cells.length ? (
          <p className="text-sm text-muted-foreground">{t("pulse.empty")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn("text-sm font-medium", d.works || d.fails ? "text-foreground" : "text-muted-foreground")} role="status">{pulseLine(d) ?? t("pulse.lineNone")}</p>
            <Matrix p={d} />
            {d.unclassified > 0 && <p className="text-xs text-muted-foreground">{t("pulse.unclassified", { count: d.unclassified, total: d.trades })}</p>}
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
