import * as React from "react";
import { Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { blankEvent, formToBody, SessionPicker, TypeSelect, type EventFormData } from "./event-form-dialog";
import { fmtDay } from "./event-meta";

/** Compact "+" popover: a short day note (ticker, type, session, text) → create. */
export function QuickAdd({
  date, onCreate, onMore,
}: {
  date: string;
  onCreate: (body: ReturnType<typeof formToBody>) => Promise<unknown>;
  onMore: (prefill: EventFormData) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState<EventFormData>(() => blankEvent({ date }));
  const [busy, setBusy] = React.useState(false);
  const uid = React.useId();

  React.useEffect(() => { if (open) setF(blankEvent({ date })); }, [open, date]);
  const valid = f.ticker.trim() !== "" && f.headline.trim() !== "";

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onCreate(formToBody(f));
      setOpen(false);
    } catch {
      /* toast is shown by the mutation */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Добавить заметку на ${fmtDay(date, { day: "numeric", month: "long" })}`}>
          <Plus className="!size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-4">
        <div
          className="flex flex-col gap-3"
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && (ev.target as HTMLElement).tagName === "INPUT") { ev.preventDefault(); void submit(); }
          }}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Заметка</span>
            <span className="text-xs text-muted-foreground">{fmtDay(date, { weekday: "short", day: "numeric", month: "short" })}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`${uid}-t`} className="text-xs text-muted-foreground">Тикер</Label>
              <Input id={`${uid}-t`} autoFocus value={f.ticker} placeholder="NVDA" className="uppercase" onChange={(e) => setF((p) => ({ ...p, ticker: e.target.value.toUpperCase() }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${uid}-ty`} className="text-xs text-muted-foreground">Тип</Label>
              <TypeSelect id={`${uid}-ty`} value={f.eventType} onChange={(v) => setF((p) => ({ ...p, eventType: v }))} />
            </div>
          </div>
          <SessionPicker value={f.session} onChange={(v) => setF((p) => ({ ...p, session: v }))} size="sm" />
          <div className="space-y-1">
            <Label htmlFor={`${uid}-h`} className="text-xs text-muted-foreground">Что ждёте или увидели</Label>
            <Input id={`${uid}-h`} value={f.headline} placeholder="Напр.: гэп после отчёта, жду отката" onChange={(e) => setF((p) => ({ ...p, headline: e.target.value }))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); onMore(f); }}>Подробнее…</Button>
            <Button type="button" size="sm" disabled={!valid || busy} onClick={() => void submit()}>{busy ? "Добавляем…" : "Добавить"}</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
