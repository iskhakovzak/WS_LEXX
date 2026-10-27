/**
 * «Написать» — the curator's short personal message to a trader (POST /api/state/message → an in-app «curator_message»
 * notification; never Telegram). Opened from the silence signal: the curator cabinet's «молчит N дней» rows and the
 * trader_silence notification (/curator?write=<trader>). Prefilled with a kind, no-pressure opener (law: prefill).
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { sendTraderMessage } from "@/lib/day-state";
import { personName } from "@/i18n";
import { dayStateI18n } from "@/i18n/ns/dayState";

export function WriteTraderDialog({ trader, onClose }: { trader: string | null; onClose: () => void }) {
  const { t } = dayStateI18n.useT();
  const { toast } = useToast();
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    if (trader) setText(t("write.prefill"));
  }, [trader, t]);
  const send = useMutation({
    mutationFn: (v: { trader: string; text: string }) => sendTraderMessage(v.trader, v.text),
    onSuccess: (r) => {
      toast({ title: r.delivered ? t("write.sent") : t("write.muted") });
      onClose();
    },
    onError: (e) => toast({ title: t("write.failed"), description: humanizeApiError(e), variant: "destructive" }),
  });
  const body = text.trim();
  return (
    <Dialog open={!!trader} onOpenChange={(v) => { if (!v && !send.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("write.title", { name: trader ? personName(trader) : "" })}</DialogTitle>
          <DialogDescription>{t("write.description")}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">{t("write.label")}</span>
          <Textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={send.isPending}>{t("write.cancel")}</Button>
          <Button type="button" onClick={() => trader && send.mutate({ trader, text: body })} disabled={send.isPending || !body}>{t("write.send")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
