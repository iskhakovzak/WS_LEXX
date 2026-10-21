/**
 * «Попросить куратора» (Волна 1 п. 1.1): one small button next to every «задаёт куратор» — limits (dashboard limit card,
 * /risk), a learning group (/academy/my), the desk plan (/game-plan). One click opens a short dialog with the message
 * prefilled; once sent the button turns into «Запрос отправлен» (one open request per kind — server
 * routes/curator-requests.ts). The curator answers from «Сегодня» → «Запросы»; the answer comes as a notification.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { http, isApiError } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { askCuratorI18n } from "@/i18n/ns/askCurator";

export type RequestKind = "limits" | "group" | "stage" | "plan" | "other" | "review";
export type CuratorRequest = {
  id: number; trader: string; traderId: number; kind: RequestKind; message: string; status: "open" | "done" | "dismissed"; note: string | null;
  createdAt: string; resolvedAt: string | null; resolvedBy: string | null;
  /** Kind «review» (Волна 2 п. 2.13): the thread — «/discussions?thread=7», «/trade-ideas?idea=3». Absent on older APIs. */
  link?: string | null;
};

/** The thread link of a «Попросить разбор» request (the server accepts exactly these two shapes). */
export const reviewLink = (where: "discussion" | "idea", id: number): string => (where === "discussion" ? `/discussions?thread=${id}` : `/trade-ideas?idea=${id}`);

export const askCuratorKeys = {
  all: ["curator-requests"] as const,
  mine: () => ["curator-requests", "mine"] as const,
  staff: (scope: string, status: string) => ["curator-requests", "staff", scope, status] as const,
};

/** The caller's own requests (open + resolved in the last 30 days); 404 (older API) → none. */
export function useMyCuratorRequests(enabled = true) {
  return useQuery({
    queryKey: askCuratorKeys.mine(),
    queryFn: () => http.get<{ requests: CuratorRequest[] }>("/api/curator-requests/mine").then((r) => r.requests)
      .catch((e: unknown) => { if (isApiError(e) && e.status === 404) return [] as CuratorRequest[]; throw e; }),
    staleTime: STALE.short,
    enabled,
  });
}

/** The open request of `kind` (for «review»: of that thread; null = none / still loading). Pure — the button and the tests share it. */
export function openRequestOf(list: readonly CuratorRequest[] | undefined, kind: RequestKind, link: string | null = null): CuratorRequest | null {
  return list?.find((r) => r.kind === kind && r.status === "open" && (!link || r.link === link)) ?? null;
}

/** `link` — kind «review» only: the thread the curator is asked to review (reviewLink). */
export function AskCuratorButton({ kind, link = null, className, size = "sm" }: { kind: RequestKind; link?: string | null; className?: string; size?: "sm" | "xs" }) {
  const { t } = askCuratorI18n.useT();
  const { user } = useAuth();
  const member = !!user && user.role !== "guest";
  const { toast } = useToast();
  const qc = useQueryClient();
  const mine = useMyCuratorRequests(member);
  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const send = useMutation({
    mutationFn: (body: { kind: RequestKind; message: string; link?: string }) => http.post<{ request: CuratorRequest }>("/api/curator-requests", body),
    onSuccess: () => {
      toast({ title: t("sent") });
      setOpen(false);
      void qc.invalidateQueries({ queryKey: askCuratorKeys.all });
    },
    onError: (e) => {
      // Already sent from another tab: show it as sent.
      if (isApiError(e) && e.code === "CURATOR_REQUEST_OPEN") { setOpen(false); void qc.invalidateQueries({ queryKey: askCuratorKeys.all }); return; }
      toast({ title: t("failed"), description: (e as Error).message, variant: "destructive" });
    },
  });
  if (!member) return null;
  const pending = openRequestOf(mine.data, kind, link);
  const btn = size === "xs" ? "h-7 px-2 text-xs" : undefined;
  if (pending) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)} title={t("pendingHint", { date: fmtDate(pending.createdAt, "shortDateTime") })}>
        <Check className="h-3.5 w-3.5 text-up" aria-hidden="true" />{t("pending")}
      </span>
    );
  }
  return (
    <>
      <Button
        type="button" variant="outline" size="sm" className={cn(btn, className)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMessage(t(`prefill.${kind}`)); setOpen(true); }}
      >
        <MessageCircleQuestion className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t(`button.${kind}`)}
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (!send.isPending) setOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogHint")}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">{t("messageLabel")}</span>
            <Textarea rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
          </label>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={send.isPending}>{t("cancel")}</Button>
            <Button type="button" onClick={() => send.mutate({ kind, message: message.trim(), ...(link ? { link } : {}) })} disabled={send.isPending}>{t("send")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
