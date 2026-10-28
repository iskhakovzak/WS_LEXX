/**
 * «Мой под» on /weekly-review: the member's pod for the shown week — the members' stats with the pod's sum and median
 * (api lib/pods/stats: other members' $ hidden for a trader, the $ sum from three active members), the shared week
 * review (pre-filled with the week's numbers the first time) and the pod feed. Nothing renders outside a pod.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2, UsersRound } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtDeskDateTime, fmtR, fmtRate, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { personName } from "@/i18n";
import { podsI18n } from "@/i18n/ns/pods";
import { podFeedQuery, podReviewQuery, podsHomeQuery, podStatsQuery, usePodMutations, type Pod, type PodStats } from "./api";

const usd = (v: number | null) => (v == null ? "—" : fmtUsd(v, { signed: true }));

function StatsTable({ s }: { s: PodStats }) {
  const { t } = podsI18n.useT();
  const { user } = useAuth();
  const me = user?.traderName ?? null;
  const th = "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground";
  const td = "px-2 py-1.5 tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead><tr><th className={th}>{t("stats.member")}</th><th className={th}>{t("stats.trades")}</th><th className={th}>{t("stats.winRate")}</th><th className={th}>{t("stats.avgR")}</th><th className={th}>{t("stats.net")}</th></tr></thead>
        <tbody>
          {s.members.map((r) => (
            <tr key={r.trader} className={cn("border-t border-border", r.trader === me && "bg-primary/5")}>
              <td className={cn(td, "font-medium text-foreground")}>{personName(r.trader)}</td>
              <td className={td}>{r.trades}</td>
              <td className={td}>{r.winRate == null ? "—" : fmtRate(r.winRate)}</td>
              <td className={td}>{r.avgR == null ? "—" : fmtR(r.avgR)}</td>
              <td className={td}>{usd(r.net)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border font-medium">
            <td className={td}>{t("stats.sum")}</td>
            <td className={td}>{s.sum.trades}</td>
            <td className={td}>{s.sum.winRate == null ? "—" : fmtRate(s.sum.winRate)}</td>
            <td className={td}>—</td>
            <td className={td}>{usd(s.sum.net)}</td>
          </tr>
          <tr className="border-t border-border text-muted-foreground">
            <td className={td}>{t("stats.median")}</td>
            <td className={td}>{s.median.trades ?? "—"}</td>
            <td className={td}>{s.median.winRate == null ? "—" : fmtRate(s.median.winRate)}</td>
            <td className={td}>{s.median.avgR == null ? "—" : fmtR(s.median.avgR)}</td>
            <td className={td}>{usd(s.median.net)}</td>
          </tr>
        </tbody>
      </table>
      {(s.median.net == null || !s.netVisible) && <p className="mt-1 text-xs text-muted-foreground">{t("stats.hiddenNet")}</p>}
    </div>
  );
}

function Review({ pod, week, stats }: { pod: Pod; week: string; stats: PodStats | undefined }) {
  const { t } = podsI18n.useT();
  const { toast } = useToast();
  const q = useQuery(podReviewQuery(pod.id, week));
  const mut = usePodMutations(pod.id);
  const template = stats ? t("review.template", {
    trades: stats.sum.trades, winRate: stats.sum.winRate == null ? "—" : fmtRate(stats.sum.winRate), avgR: stats.median.avgR == null ? "—" : fmtR(stats.median.avgR),
  }) : "";
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? q.data?.review?.body ?? template;
  const save = () => mut.saveReview.mutate({ week, body: text.trim() }, {
    onSuccess: () => { setDraft(null); toast({ title: t("review.saved") }); },
    onError: (e) => toast({ title: t("review.saveFailed"), description: humanizeApiError(e), variant: "destructive" }),
  });
  if (q.isLoading) return <ListSkeleton rows={2} dense />;
  if (q.isError) return <ErrorState compact error={q.error} onRetry={q.refetch} />;
  const r = q.data?.review;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("review.hint")}{r?.updatedBy ? ` · ${t("review.edited", { name: personName(r.updatedBy) })}` : ""}</p>
      <Textarea value={text} rows={5} maxLength={4000} disabled={!q.data?.canEdit} onChange={(e) => setDraft(e.target.value)} aria-label={t("review.title")} />
      {q.data?.canEdit && (
        <Button size="sm" className="self-start" disabled={!text.trim() || mut.saveReview.isPending || (draft == null && !!r)} onClick={save}>{t("review.save")}</Button>
      )}
    </div>
  );
}

function Feed({ pod }: { pod: Pod }) {
  const { t } = podsI18n.useT();
  const { toast } = useToast();
  const { user } = useAuth();
  const q = useQuery(podFeedQuery(pod.id));
  const mut = usePodMutations(pod.id);
  const [body, setBody] = React.useState("");
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    mut.post.mutate(body.trim(), { onSuccess: () => setBody(""), onError: (err) => toast({ title: t("feed.sendFailed"), description: humanizeApiError(err), variant: "destructive" }) });
  };
  return (
    <div className="flex flex-col gap-2">
      {q.data?.canPost && (
        <form onSubmit={send} className="flex gap-2">
          <Textarea value={body} rows={1} maxLength={4000} placeholder={t("feed.placeholder")} onChange={(e) => setBody(e.target.value)} className="min-h-9" aria-label={t("feed.title")} />
          <Button type="submit" size="sm" disabled={!body.trim() || mut.post.isPending}>{t("feed.send")}</Button>
        </form>
      )}
      {q.isLoading ? <ListSkeleton rows={2} dense /> : q.isError ? <ErrorState compact error={q.error} onRetry={q.refetch} /> : !q.data?.posts.length ? (
        <p className="text-sm text-muted-foreground">{t("feed.empty")}</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {q.data.posts.map((p) => (
            <li key={p.id} className="rounded-lg bg-[var(--glass-bg)] px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{personName(p.author)}</span>
                <span>{fmtDeskDateTime(p.createdAt)}</span>
                {p.author === user?.traderName && (
                  <Button size="icon" variant="ghost" className="ml-auto h-6 w-6" aria-label={t("feed.remove")} onClick={() => mut.removePost.mutate(p.id)}><Trash2 aria-hidden="true" /></Button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-line text-foreground">{p.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The member's pod for the week [weekStart, weekEnd]; renders nothing when the viewer is in no pod. */
export function PodPanel({ weekStart, weekEnd, className }: { weekStart: string; weekEnd: string; className?: string }) {
  const { t } = podsI18n.useT();
  const home = useQuery(podsHomeQuery());
  const pod = home.data?.mine ?? null;
  const stats = useQuery({ ...podStatsQuery(pod?.id ?? 0, weekStart, weekEnd), enabled: !!pod });
  if (!pod) return null;
  return (
    <Panel icon={UsersRound} title={t("title", { name: pod.name })} description={t("description")} className={className}>
      <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-12">
        <section className="lg:col-span-7" aria-label={t("stats.title")}>
          <h4 className="mb-1.5 text-sm font-semibold text-foreground">{t("stats.title")}</h4>
          {stats.isLoading ? <ListSkeleton rows={3} dense /> : stats.isError ? (
            <ErrorState compact error={stats.error} onRetry={stats.refetch} title={t("stats.loadFailed")} />
          ) : stats.data && stats.data.sum.trades === 0 ? (
            <EmptyState compact icon={UsersRound} title={t("stats.none")} />
          ) : stats.data ? <StatsTable s={stats.data} /> : null}
          <h4 className="mb-1.5 mt-4 text-sm font-semibold text-foreground">{t("review.title")}</h4>
          <Review pod={pod} week={weekStart} stats={stats.data} />
        </section>
        <section className="lg:col-span-5" aria-label={t("feed.title")}>
          <h4 className="mb-1.5 text-sm font-semibold text-foreground">{t("feed.title")}</h4>
          <Feed pod={pod} />
        </section>
      </div>
    </Panel>
  );
}
