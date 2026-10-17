/**
 * Curator "run now" dialog: date range → dry-run preview over the API → apply.
 */
import * as React from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { localDateString } from "@/lib/local-date";
import { useApiSync, type ApplyResult, type Preview } from "./api";
import { PreviewSummary, PreviewTable } from "./preview-table";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateString(d);
}

export function RunSyncDialog({ open, onOpenChange, configured }: { open: boolean; onOpenChange: (v: boolean) => void; configured: boolean }) {
  const { toast } = useToast();
  const [from, setFrom] = React.useState(() => daysAgo(3));
  const [to, setTo] = React.useState(() => localDateString());
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [applied, setApplied] = React.useState<ApplyResult | null>(null);
  const sync = useApiSync();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  const runPreview = async () => {
    try { setPreview((await sync.mutateAsync({ from, to, dryRun: true })) as Preview); setApplied(null); }
    catch (e) { toast({ title: "Не удалось получить данные из PropReports", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };
  const runApply = async () => {
    try {
      const r = (await sync.mutateAsync({ from, to, dryRun: false })) as ApplyResult;
      setApplied(r);
      toast({ title: `Синхронизация: +${r.inserted} новых, ${r.updated} обновлено`, description: `${r.conflicts} на сверку · ${r.skipped} пропущено${r.errors ? ` · ошибок: ${r.errors}` : ""}`, variant: r.errors ? "destructive" : undefined });
    } catch (e) { toast({ title: "Синхронизация не выполнена", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  const writable = preview && preview.counts.insert + preview.counts.update + preview.counts.adopt + preview.counts.conflict > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setPreview(null); setApplied(null); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Синхронизация по API</DialogTitle>
          <DialogDescription>Fills за период подтягиваются с хоста PropReports, собираются в раунд-трипы и сравниваются с журналом. Сначала предпросмотр, затем запись.</DialogDescription>
        </DialogHeader>
        {!configured ? (
          <p className="text-sm text-[hsl(var(--chart-3))]">API не настроено — задайте PROPREPORTS_DOMAIN и PROPREPORTS_TOKEN в .env.local и перезапустите сервер.</p>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1"><Label htmlFor="pr-from" className="text-xs text-muted-foreground">С</Label><Input id="pr-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} className="h-9 w-40" /></div>
              <div className="grid gap-1"><Label htmlFor="pr-to" className="text-xs text-muted-foreground">По</Label><Input id="pr-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} className="h-9 w-40" /></div>
              <div className="flex gap-1">
                {[1, 3, 7, 30].map((n) => <Button key={n} variant="ghost" size="sm" onClick={() => { setFrom(daysAgo(n)); setTo(localDateString()); setPreview(null); }}>{n} дн.</Button>)}
              </div>
              <Button variant="outline" onClick={runPreview} disabled={!valid || sync.isPending}>
                {sync.isPending && sync.variables?.dryRun ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Предпросмотр
              </Button>
              <Pill tone="neutral">не больше 92 дней за запуск</Pill>
            </div>
            {applied && (
              <div className="flex flex-wrap gap-2 text-sm">
                <Pill tone="up">+{applied.inserted} новых</Pill><Pill tone="accent">{applied.updated} обновлено</Pill><Pill tone="neutral">{applied.unchanged} без изменений</Pill>
                {applied.conflicts > 0 && <Pill tone="warn">{applied.conflicts} на сверку</Pill>}
                {applied.errors > 0 && <Pill tone="down">{applied.errors} ошибок</Pill>}
                {applied.errorText && <pre className="w-full whitespace-pre-wrap text-xs text-down">{applied.errorText}</pre>}
              </div>
            )}
            {preview && !applied && (
              <>
                <PreviewSummary preview={preview} />
                <PreviewTable preview={preview} />
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button>
          <Button onClick={runApply} disabled={!configured || !preview || !writable || sync.isPending || !!applied}>
            {sync.isPending && sync.variables?.dryRun === false ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}Записать в журнал
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
