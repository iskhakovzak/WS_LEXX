import * as React from "react";
import { Flag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FilterChip } from "@/components/ds";
import { http } from "@/lib/api/http";
import { humanizeApiError } from "@/lib/api/errors";
import { useToast } from "@/hooks/use-toast";

export type ReportTarget = { type: "discussion" | "comment"; id: number; preview: string; author?: string | null };

const REASONS = ["Спам или реклама", "Оскорбление", "Дезинформация", "Не по теме", "Другое"];

/** Replaces the old window.prompt: preset reasons + optional details. */
/** The reporter is the signed-in member — the server takes it from the token. */
export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // Last opened target: keeps the title/preview stable while the dialog animates out (target is already null then).
  const [shown, setShown] = React.useState<ReportTarget | null>(target);

  React.useEffect(() => {
    if (target) { setShown(target); setReason(null); setDetails(""); setBusy(false); }
  }, [target]);

  const needsDetails = reason === "Другое";
  const canSubmit = !!reason && (!needsDetails || details.trim().length > 0) && !busy;

  async function submit() {
    if (!target || !canSubmit) return;
    setBusy(true);
    try {
      const full = [reason, details.trim()].filter(Boolean).join(": ");
      await http.post("/api/reports", { targetType: target.type, targetId: target.id, reason: full.slice(0, 2000) });
      toast({ title: "Жалоба отправлена", description: "Кураторы рассмотрят её в админке." });
      onClose();
    } catch (e) {
      toast({ title: "Ошибка", description: humanizeApiError(e, "Не удалось отправить жалобу"), variant: "destructive" });
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Flag className="h-4 w-4 text-down" aria-hidden="true" />Пожаловаться на {shown?.type === "comment" ? "комментарий" : "тему"}</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {shown?.author ? `${shown.author}: ` : ""}{shown?.preview}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Причина жалобы" className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <FilterChip key={r} active={reason === r} onClick={() => setReason(r)}>{r}</FilterChip>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-details" className="text-xs text-muted-foreground">
              Подробности{needsDetails ? " (обязательно)" : " (необязательно)"}
            </Label>
            <Textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={1500}
              placeholder="Что именно не так?"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit}>{busy ? "Отправляем…" : "Отправить жалобу"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
