/**
 * Bodies of the trade sheet's «Разбор» / «Заметки» / «Контекст» sections: the inline editor of the review text fields
 * (saves only changed fields, Ctrl+Enter) and the context chips (stop, risk, RVOL, float, conviction, grade…).
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fmtPrice, fmtUsd } from "@/lib/format";
import { tradesI18n } from "@/i18n/ns/trades";
import { commonI18n } from "@/i18n/ns/common";
import { daysHeld, eventLabel, horizonOf } from "./trade-utils";
import { stopIsEstimate } from "./sheet-model";
import { ConvictionDots } from "./trade-bits";
import { useTextDraft } from "@/hooks/use-text-draft";

export type TradePatch = Partial<Pick<Trade, "result" | "notes" | "whatWorked" | "whatFailed" | "conclusion" | "tags" | "screenshotNotes" | "setup">>
  & { confidenceGrade?: "A+" | "A" | "B" | "C" };
type OnPatch = (t: Trade, patch: TradePatch, opts?: { silent?: boolean }) => Promise<boolean>;

export type ReviewKey = "notes" | "whatWorked" | "whatFailed" | "conclusion";
/** «Разбор»: what worked / what failed / the lesson. */
export const REVIEW_TEXT_KEYS: readonly ReviewKey[] = ["whatWorked", "whatFailed", "conclusion"];
/** «Заметки»: the free notes field. */
export const NOTES_KEYS: readonly ReviewKey[] = ["notes"];

/** Field label in the current language (call in render). */
function fieldLabel(k: ReviewKey): string {
  return k === "notes" ? commonI18n.t("fields.notes") : tradesI18n.t(`reviewFields.${k}`);
}

/** Inline editor for some of the review text fields; saves only changed fields. */
export function ReviewEditor({ trade, keys, canEdit, onPatch, emptyText }: {
  trade: Trade; keys: readonly ReviewKey[]; canEdit: boolean; onPatch: OnPatch; emptyText: string;
}) {
  const { t } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const initial = React.useMemo(
    () => Object.fromEntries(keys.map((k) => [k, trade[k] ?? ""])) as Record<ReviewKey, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys, trade.id, trade.notes, trade.whatWorked, trade.whatFailed, trade.conclusion],
  );
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setDraft(initial), [initial]);
  // Unsaved review text survives a closed sheet / reload (local draft until «Сохранить»).
  const stored = useTextDraft(canEdit ? `trade-review:${trade.id}:${keys.join(",")}` : null, draft, setDraft, { base: initial });
  const dirtyKeys = keys.filter((k) => draft[k] !== initial[k]);
  const single = keys.length === 1;

  if (!canEdit) {
    const filled = keys.filter((k) => trade[k]);
    if (!filled.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
    return (
      <div className={cn("grid gap-3", !single && "sm:grid-cols-2")}>
        {filled.map((k) => (
          <div key={k} className="rounded-xl bg-[var(--glass-bg)] p-3">
            <p className="mb-1 text-xs text-muted-foreground">{fieldLabel(k)}</p>
            <p className="whitespace-pre-wrap text-sm">{trade[k]}</p>
          </div>
        ))}
      </div>
    );
  }

  async function save() {
    if (!dirtyKeys.length) return;
    setSaving(true);
    const patch: TradePatch = {};
    for (const k of dirtyKeys) patch[k] = draft[k].trim() ? draft[k] : null;
    if (await onPatch(trade, patch)) stored.clear();
    setSaving(false);
  }

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }}
    >
      <div className={cn("grid gap-3", !single && "sm:grid-cols-2")}>
        {keys.map((k) => (
          <div key={k} className={cn("space-y-1.5", !single && k === "conclusion" && "sm:col-span-2")}>
            <Label htmlFor={`rv-${trade.id}-${k}`} className={cn("text-xs text-muted-foreground", single && "sr-only")}>{fieldLabel(k)}</Label>
            <Textarea
              id={`rv-${trade.id}-${k}`}
              value={draft[k]}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              rows={single ? 4 : 3}
              placeholder={k === "conclusion" ? t("sheet.conclusionPlaceholder") : undefined}
              className={cn("resize-y rounded-xl text-sm", draft[k] !== initial[k] && "border-primary/60")}
            />
          </div>
        ))}
      </div>
      {dirtyKeys.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">{t("sheet.unsaved")}</span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(initial)} disabled={saving}>{tc("actions.undo")}</Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? tc("states.saving") : t("sheet.saveReview")}</Button>
        </div>
      )}
    </div>
  );
}

/** Context chips of the trade (size, gross / fees and hold are in the key facts; the data source is not shown). */
export function ContextRow({ trade: t, sessionsText }: {
  trade: Trade;
  /** «Премаркет → Основная» when the fills span two sessions. */
  sessionsText: string | null;
}) {
  const { t: tt } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const items: [string, React.ReactNode][] = [];
  if (t.stop != null && Number(t.stop) > 0) items.push([stopIsEstimate(t) ? tt("sheet.context.stopEstimate") : tc("trading.stop"), fmtPrice(t.stop)]);
  if (t.riskUsd != null) items.push([tc("trading.risk"), fmtUsd(t.riskUsd, { decimals: "trim" })]);
  if (sessionsText) items.push([tt("sheet.context.sessions"), sessionsText]);
  const held = daysHeld(t);
  if (held != null && horizonOf(t) !== "intraday") items.push([tt("sheet.context.days"), held]);
  if (t.relativeVolume != null) items.push(["RVOL", `${t.relativeVolume}x`]);
  if (t.float) items.push(["Float", t.float]);
  if (t.marketCap) items.push([tc("trading.marketCap"), t.marketCap]);
  if (t.sector) items.push([tc("trading.sector"), t.sector]);
  if (t.atr != null) items.push(["ATR", t.atr]);
  if (t.slippage != null) items.push([tt("sheet.context.slippage"), t.slippage]);
  if (t.eventType) items.push([tt("sheet.context.event"), eventLabel(t.eventType)]);
  const hasPsy = t.conviction != null || t.confidenceGrade;
  if (!items.length && !hasPsy) return null;
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[var(--glass-bg)] px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium tabular-nums">{v}</span>
            </span>
          ))}
        </div>
      )}
      {hasPsy && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {t.conviction != null && <span className="inline-flex items-center gap-2 text-muted-foreground">{tt("sheet.context.conviction")} <ConvictionDots value={t.conviction} /></span>}
          {t.confidenceGrade && (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              {tt("sheet.context.grade")} <Pill tone={t.confidenceGrade === "A+" ? "up" : t.confidenceGrade === "A" ? "accent" : t.confidenceGrade === "B" ? "warn" : "down"}>{t.confidenceGrade}</Pill>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
