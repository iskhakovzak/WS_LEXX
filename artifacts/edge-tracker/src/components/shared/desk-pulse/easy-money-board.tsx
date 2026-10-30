/**
 * «Лёгкие деньги дня» for a curator / senior (GET /api/easy-money/group) under their own plan: every clean move of the
 * in-play tickers of the last closed session (or the picked past day) — the size and family · timing first, where it
 * was seen, then who of the group took it (and the result), who had it in the plan and skipped it, who passed it by.
 * The note field is the viewer's OWN plan note on that move (the only manual input; saved on blur). A senior sees the
 * other people's lines without $. Hidden for anyone else (the api answers { allowed: false }).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { Panel, Pill, QueryState, toneText } from "@/components/ds";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtDate, fmtRate, fmtUsd } from "@/lib/format";
import { personName } from "@/i18n";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import { easyBoardQuery, moveText, setupText, useSaveEasyNote, type BoardMove, type MatchRow } from "./easy-api";
import { ToolHelp } from "@/components/shared/tool-help";

function Result({ r }: { r: MatchRow }) {
  const { t } = deskPulseI18n.useT();
  if (r.net != null) return <span className={cn("tabular-nums", toneText(r.net > 0 ? "up" : r.net < 0 ? "down" : "neutral"))}>{fmtUsd(r.net, { signed: true, decimals: 0 })}</span>;
  return r.n ? <span className="tabular-nums text-muted-foreground">{t("easy.wl", { wins: r.wins, losses: r.losses })}</span> : null;
}

function People({ label, rows, result }: { label: string; rows: MatchRow[]; result?: boolean }) {
  if (!rows.length) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      {rows.map((r) => (
        <span key={r.trader} className="inline-flex items-baseline gap-1 text-foreground">
          {personName(r.trader)}
          {result && <Result r={r} />}
        </span>
      ))}
    </p>
  );
}

function Note({ day, ticker, value, date }: { day: string; ticker: string; value: string; date: string | null }) {
  const { t } = deskPulseI18n.useT();
  const save = useSaveEasyNote(date);
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return (
    <Textarea
      aria-label={t("easy.note")}
      placeholder={t("easy.notePlaceholder")}
      value={text}
      maxLength={500}
      rows={1}
      className="min-h-8 text-xs"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== value.trim()) save.mutate({ day, ticker, note: text }); }}
    />
  );
}

function MoveCard({ m, note, date }: { m: BoardMove; note: string; date: string | null }) {
  const { t } = deskPulseI18n.useT();
  const took = m.rows.filter((r) => r.status === "took");
  const against = m.rows.filter((r) => r.status === "against");
  const skipped = m.rows.filter((r) => r.status === "skipped");
  const missed = m.rows.filter((r) => r.status === "missed");
  return (
    <li className="tile flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{m.ticker}</span>
        <span className={cn("font-medium tabular-nums", toneText(m.side === "long" ? "up" : "down"))}>{moveText(m)}</span>
        <span className="text-sm text-foreground">{setupText(m)}</span>
        <span className="text-xs text-muted-foreground">{t(`easy.kind.${m.kind}`)} · {t("easy.clean", { value: fmtRate(m.clean) })}</span>
        <span className="flex flex-wrap gap-1">{m.sources.map((s) => <Pill key={s} tone={s === "em_break" ? "warn" : "neutral"}>{t(`easy.source.${s}`)}</Pill>)}</span>
      </div>
      <People label={t("easy.group.took")} rows={took} result />
      <People label={t("easy.group.against")} rows={against} result />
      <People label={t("easy.group.skipped")} rows={skipped} />
      {missed.length > 0 && (
        <p className="text-xs text-muted-foreground" title={missed.map((r) => personName(r.trader)).join(", ")}>{t("easy.group.missed", { count: missed.length })}</p>
      )}
      <Note day={m.day} ticker={m.ticker} value={note} date={date} />
    </li>
  );
}

/** `date` = a past day of the plan page, null = the last closed session. */
export function EasyMoneyBoard({ date, className }: { date: string | null; className?: string }) {
  const { t } = deskPulseI18n.useT();
  const q = useQuery(easyBoardQuery(date));
  if (q.data && !q.data.allowed) return null;
  const d = q.data?.allowed ? q.data : null;
  return (
    <Panel
      className={className}
      title={t("easy.title")}
      icon={Coins}
      actions={<ToolHelp id="easyMoney" />}
      data-help-anchor="easyMoney"
      description={d ? t("easy.hint", { day: fmtDate(d.day, "dayMonth"), move: String(d.cfg.minMovePct), clean: fmtRate(d.cfg.cleanShare) }) : undefined}
    >
      <QueryState query={q} errorCompact errorTitle={t("easy.loadFailed")}>
        {(b) => !b.allowed ? null : !b.moves.length ? (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>{b.checked && b.noData < b.checked ? t("easy.empty", { day: fmtDate(b.day, "dayMonth") }) : t("easy.notClosed")}</p>
            <p className="text-xs">{t("easy.checked", { checked: b.checked, noData: b.noData })}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {b.moves.map((m) => <MoveCard key={m.ticker} m={m} note={b.notes[m.ticker] ?? ""} date={date} />)}
            </ul>
            <p className="text-xs text-muted-foreground">{t("easy.checked", { checked: b.checked, noData: b.noData })} {t("easy.people", { count: b.people })}</p>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
