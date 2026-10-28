/**
 * Curator / admin dialogs of the corporate and index events block: one entry (the day of the view pre-filled, the
 * index pre-picked for index types, a ticker otherwise) and the type → playbook setup map.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { corpEventsI18n } from "@/i18n/ns/corpEvents";
import {
  CORP_TYPES, INDEX_CODES, MANUAL_TYPES, officeSetupsQuery, useCorpMutations, type CorpType, type IndexCode,
} from "./corp-events-api";

export type CorpDraft = { id?: number; day: string; type: CorpType; ticker: string; indexCode: IndexCode | null; note: string };
const INDEX_TYPES: ReadonlySet<CorpType> = new Set(["sp_add", "sp_remove", "index_rebalance"]);
const NONE = "__none";

export function CorpEventDialog({ draft, onClose }: { draft: CorpDraft; onClose: () => void }) {
  const { t } = corpEventsI18n.useT();
  const { toast } = useToast();
  const mut = useCorpMutations();
  const [f, setF] = React.useState(draft);
  const set = <K extends keyof CorpDraft>(k: K, v: CorpDraft[K]) => setF((x) => ({ ...x, [k]: v }));
  const withIndex = INDEX_TYPES.has(f.type);
  const ticker = f.ticker.trim().toUpperCase();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f.day) && (!!ticker || (withIndex && !!f.indexCode));
  const saving = mut.create.isPending || mut.update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const body = { day: f.day, type: f.type, ticker: ticker || null, indexCode: withIndex ? f.indexCode : null, note: f.note.trim() || null };
    const opts = {
      onSuccess: () => { toast({ title: t("saved") }); onClose(); },
      onError: (err: unknown) => toast({ title: t("saveFailed"), description: humanizeApiError(err), variant: "destructive" }),
    };
    if (f.id != null) mut.update.mutate({ id: f.id, ...body }, opts);
    else mut.create.mutate(body, opts);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader><DialogTitle>{f.id != null ? t("edit") : t("addTitle")}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="corp-day">{t("field.day")}</Label>
              <Input id="corp-day" type="date" value={f.day} onChange={(e) => set("day", e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="corp-type">{t("field.type")}</Label>
              <Select value={f.type} onValueChange={(v) => set("type", v as CorpType)}>
                <SelectTrigger id="corp-type"><SelectValue /></SelectTrigger>
                <SelectContent>{MANUAL_TYPES.map((x) => <SelectItem key={x} value={x}>{t(`type.${x}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="corp-ticker">{t("field.ticker")}</Label>
              <Input id="corp-ticker" value={f.ticker} maxLength={12} autoCapitalize="characters" onChange={(e) => set("ticker", e.target.value)} />
            </div>
            {withIndex && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="corp-index">{t("field.index")}</Label>
                <Select value={f.indexCode ?? NONE} onValueChange={(v) => set("indexCode", v === NONE ? null : (v as IndexCode))}>
                  <SelectTrigger id="corp-index"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {INDEX_CODES.map((x) => <SelectItem key={x} value={x}>{t(`index.${x}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="corp-note">{t("field.note")}</Label>
            <Input id="corp-note" value={f.note} maxLength={500} onChange={(e) => set("note", e.target.value)} />
          </div>
          {!valid && <p className="text-xs text-muted-foreground">{t("tickerOrIndex")}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={!valid || saving}>{t("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CorpSetupsDialog({ current, onClose }: { current: Partial<Record<CorpType, { id: number; name: string }>>; onClose: () => void }) {
  const { t } = corpEventsI18n.useT();
  const { toast } = useToast();
  const mut = useCorpMutations();
  const setups = useQuery(officeSetupsQuery(true));
  const pick = (type: CorpType, v: string) => mut.setSetup.mutate(
    { type, playbookId: v === NONE ? null : Number(v) },
    { onError: (err) => toast({ title: t("saveFailed"), description: humanizeApiError(err), variant: "destructive" }) },
  );
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("setups")}</DialogTitle>
          <DialogDescription>{t("setupsHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {CORP_TYPES.map((type) => (
            <div key={type} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3">
              <Label htmlFor={`corp-setup-${type}`}>{t(`type.${type}`)}</Label>
              <Select value={current[type] ? String(current[type]!.id) : NONE} onValueChange={(v) => pick(type, v)}>
                <SelectTrigger id={`corp-setup-${type}`}><SelectValue placeholder={t("setupPick")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noSetup")}</SelectItem>
                  {(setups.data ?? []).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
