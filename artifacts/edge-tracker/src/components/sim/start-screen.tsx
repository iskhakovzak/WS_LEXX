
/**
 * Trainer home, lower row: the viewer's recent games (open one for its review) and the week of the desk (opt-in).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { DataTable, EmptyState, ErrorState, ListSkeleton, Panel, toneOf, toneText } from "@/components/ds";
import { fmtDate, fmtPct, fmtR, fmtRate, fmtUsd, fmtCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import { simOwnI18n } from "@/i18n/ns/simOwn";
import { personName } from "@/i18n";
import { boardQuery, myStatsQuery, simApi, simKeys, type FinishedGame } from "./api";

export function RecentGames({ onOpen }: { onOpen: (id: number) => void }) {
  const { t } = simI18n.useT();
  const q = useQuery(myStatsQuery());
  const rows = q.data?.recent ?? [];
  return (
    <Panel title={t("progress.recent")} icon={History} fill className="lg:col-span-7">
      {q.isLoading ? <ListSkeleton rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} inset /> : rows.length === 0 ? (
        <EmptyState compact icon={History} title={t("progress.empty")} />
      ) : (
        <DataTable ariaLabel={t("progress.recent")} maxHeight={360}>
          <table>
            <thead>
              <tr>
                <th>{t("progress.cols.when")}</th>
                <th>{t("progress.cols.ticker")}</th>
                <th>{t("progress.cols.level")}</th>
                <th className="text-right">{t("progress.cols.r")}</th>
                <th className="text-right">{t("progress.cols.net")}</th>
                <th className="text-right">{t("progress.cols.vsBh")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => <RecentRow key={g.id} g={g} onOpen={onOpen} />)}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}

function RecentRow({ g, onOpen }: { g: FinishedGame; onOpen: (id: number) => void }) {
  const { t } = simI18n.useT();
  const vs = g.own ? g.ownDiff ?? 0 : g.pct - g.bhPct;
  return (
    <tr className="cursor-pointer" onClick={() => onOpen(g.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(g.id); }} tabIndex={0}>
      <td className="whitespace-nowrap text-muted-foreground">{fmtDate(g.finishedAt, "dateTime")}</td>
      <td className="font-medium">{g.ticker}</td>
      <td className="whitespace-nowrap text-muted-foreground">{g.own ? simOwnI18n.t("progressLabel") : `${t(`mode.${g.mode}`)} · ${t(`difficulty.${g.difficulty}`)}`}</td>
      <td className={cn("text-right tabular-nums", toneText(toneOf(g.r)))}>{fmtR(g.r)}</td>
      <td className={cn("text-right tabular-nums", toneText(toneOf(g.net)))}>{fmtUsd(g.net, { signed: true, decimals: "auto" })}</td>
      <td className={cn("text-right tabular-nums", toneText(toneOf(vs)))}>{g.own ? fmtUsd(vs, { signed: true, decimals: "auto" }) : fmtPct(vs, 1)}</td>
    </tr>
  );
}

export function WeeklyBoard() {
  const { t } = simI18n.useT();
  const qc = useQueryClient();
  const q = useQuery(boardQuery());
  const me = useQuery(myStatsQuery());
  const visible = me.data?.prefs.leaderboardVisible ?? false;
  const m = useMutation({
    mutationFn: (v: boolean) => simApi.prefs(v),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: simKeys.board() }); void qc.invalidateQueries({ queryKey: simKeys.me() }); },
    // The switch snaps back on failure; say why instead of silently undoing the click.
    onError: (err) => toast({ title: humanizeApiError(err, t("board.saveError")), variant: "destructive" }),
  });
  const b = q.data;
  return (
    <Panel
      title={t("board.title")} icon={Users} fill className="lg:col-span-5"
      description={b ? t("board.subtitle", { from: fmtDate(b.from, "dayMonth"), to: fmtDate(b.to, "dayMonth") }) : undefined}
      actions={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("board.visible")}
          <Switch checked={m.isPending ? !!m.variables : visible} onCheckedChange={(v) => m.mutate(v)} disabled={me.isLoading || m.isPending} />
        </label>
      }
    >
      {q.isLoading ? <ListSkeleton rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} inset /> : !b || b.rows.length === 0 ? (
        // Nobody visible is not «nobody played»: players who hid their results still count (MAKSIM-42).
        <EmptyState compact icon={Users} title={b && b.hidden > 0 ? t("board.hidden", { count: b.hidden }) : t("board.empty")} />
      ) : (
        <>
          <DataTable ariaLabel={t("board.title")} maxHeight={360}>
            <table>
              <thead>
                <tr>
                  <th className="w-10">{t("board.cols.rank")}</th>
                  <th>{t("board.cols.name")}</th>
                  <th className="text-right">{t("board.cols.games")}</th>
                  <th className="text-right">{t("board.cols.r")}</th>
                  <th className="text-right">{t("board.cols.wins")}</th>
                  <th className="text-right">{t("board.cols.best")}</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={r.userId} className={cn(r.me && "bg-primary/[0.07]")}>
                    <td className="tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="max-w-[12rem] truncate font-medium" title={personName(r.name)}>{personName(r.name)}{r.me && <span className="ml-1.5 text-2xs font-normal text-muted-foreground">{t("board.you")}</span>}</td>
                    <td className="text-right tabular-nums">{fmtCount(r.games)}</td>
                    <td className={cn("text-right font-semibold tabular-nums", toneText(toneOf(r.r)))}>{fmtR(r.r)}</td>
                    <td className="text-right tabular-nums">{fmtRate(r.games ? r.wins / r.games : 0)}</td>
                    <td className={cn("text-right tabular-nums", toneText(toneOf(r.best)))}>{fmtR(r.best)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          {b.hidden > 0 && <p className="mt-2 text-2xs text-muted-foreground">{t("board.hidden", { count: b.hidden })}</p>}
        </>
      )}
    </Panel>
  );
}
