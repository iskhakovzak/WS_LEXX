/**
 * «Сегодня» → «Запросы» (Волна 1 п. 1.1): open «Попросить куратора» requests of my group (or the whole desk with
 * «Все»), oldest first. «Готово» / «Закрыть» with an optional answer; the trader gets it as a notification. Hidden
 * when nothing is open (no empty banner on the curator's main screen).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageCircleQuestion, X } from "lucide-react";
import { Panel, Pill, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { http, isApiError } from "@/lib/api/http";
import { STALE, POLL } from "@/lib/api/keys";
import { fmtDeskDateTime } from "@/lib/format";
import { personName } from "@/i18n";
import { askCuratorI18n } from "@/i18n/ns/askCurator";
import { askCuratorKeys, type CuratorRequest, type RequestKind } from "@/components/shared/ask-curator";
import type { Scope } from "./api";

const KIND_TONE: Record<RequestKind, Tone> = { limits: "warn", group: "accent", stage: "purple", plan: "neutral", other: "neutral" };

/** Cabinet scope → the API's «Моя группа / Все» (auto = the server default: my group when I have one). */
export const requestsScope = (scope: Scope | "auto"): "group" | "all" | null => (scope === "mine" ? "group" : scope === "desk" ? "all" : null);

export function useOpenCuratorRequests(scope: Scope | "auto") {
  const s = requestsScope(scope);
  return useQuery({
    queryKey: askCuratorKeys.staff(s ?? "auto", "open"),
    queryFn: () => http.get<{ requests: CuratorRequest[] }>("/api/curator-requests", { query: { status: "open", scope: s } }).then((r) => r.requests)
      .catch((e: unknown) => { if (isApiError(e) && e.status === 404) return [] as CuratorRequest[]; throw e; }),
    staleTime: STALE.short,
    refetchInterval: POLL.twoMinutes,
  });
}

export function CuratorRequestsPanel({ scope, onOpenTrader }: { scope: Scope | "auto"; onOpenTrader: (trader: string, tab?: string) => void }) {
  const { t } = askCuratorI18n.useT();
  const q = useOpenCuratorRequests(scope);
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <Panel id="curator-requests" title={t("panel.title")} icon={MessageCircleQuestion} actions={<Pill tone="accent">{list.length}</Pill>}>
      <ul className="flex flex-col gap-2">
        {list.map((r) => <RequestRow key={r.id} r={r} onOpenTrader={onOpenTrader} />)}
      </ul>
    </Panel>
  );
}

function RequestRow({ r, onOpenTrader }: { r: CuratorRequest; onOpenTrader: (trader: string, tab?: string) => void }) {
  const { t } = askCuratorI18n.useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = React.useState("");
  const resolve = useMutation({
    mutationFn: (status: "done" | "dismissed") => http.patch<{ request: CuratorRequest }>(`/api/curator-requests/${r.id}`, { status, note: note.trim() || null }),
    onSuccess: () => {
      toast({ title: t("panel.resolved") });
      void qc.invalidateQueries({ queryKey: askCuratorKeys.all });
    },
    onError: (e) => toast({ title: t("panel.failed"), description: (e as Error).message, variant: "destructive" }),
  });
  const tab = r.kind === "limits" ? "risk" : undefined;
  return (
    <li className="tile flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="font-medium text-foreground hover:underline" onClick={() => onOpenTrader(r.trader, tab)}>{personName(r.trader)}</button>
        <Pill tone={KIND_TONE[r.kind]}>{t(`panel.kind.${r.kind}`)}</Pill>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmtDeskDateTime(r.createdAt, { style: "numericDateTime" })}</span>
      </div>
      <p className="text-sm text-muted-foreground">{r.message || t("panel.noMessage")}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input className="h-8 min-w-0 flex-1 text-sm" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("panel.notePh")} aria-label={t("panel.notePh")} />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => resolve.mutate("done")} disabled={resolve.isPending}><Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("panel.done")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => resolve.mutate("dismissed")} disabled={resolve.isPending}><X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("panel.dismiss")}</Button>
        </div>
      </div>
    </li>
  );
}
