import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagSelector } from "@/components/tag-selector";
import { ScreenshotFields, screenshotUrlsToString, stringToScreenshotUrls } from "@/components/screenshot-fields";
import { TickerFundamentalsBar } from "@/components/ticker-fundamentals-bar";
import { suggestTagsFromFundamentals } from "@/lib/tags";
import type { TickerFundamentals } from "@/lib/market-intel";
import { Pill, toneText } from "@/components/ds";
import { STATUSES, STATUS_LABELS, normStatus, splitTags, type WatchlistItem } from "./lib";

const LazyVoiceRecorder = React.lazy(() => import("@/components/voice-recorder").then((m) => ({ default: m.VoiceRecorder })));

const TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;
function priceError(v: string): string | null {
  if (!v.trim()) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? null : "Введите число ≥ 0";
}

export type WatchlistFormData = {
  ticker: string; catalyst: string; targetPrice: string; stopPrice: string;
  status: string; notes: string; sector: string; tags: string; screenshotUrls: string[];
  marketCap?: string | null; float?: string | null; adv?: string | null;
  atr?: number | null; relativeVolume?: number | null; beta?: number | null;
  shortInterest?: number | null; longName?: string | null;
};

export const blankForm = (ticker = ""): WatchlistFormData => ({ ticker, catalyst: "", targetPrice: "", stopPrice: "", status: "watching", notes: "", sector: "", tags: "", screenshotUrls: [""] });
export function itemToForm(i: WatchlistItem): WatchlistFormData {
  return {
    ticker: i.ticker, catalyst: i.catalyst ?? "",
    targetPrice: i.targetPrice != null ? String(Number(i.targetPrice)) : "",
    stopPrice: i.stopPrice != null ? String(Number(i.stopPrice)) : "",
    status: normStatus(i.status), notes: i.notes ?? "", sector: i.sector ?? "", tags: i.tags ?? "",
    screenshotUrls: stringToScreenshotUrls(i.screenshotUrl),
  };
}

const CATALYST_PRESETS = ["Отчёт BMO", "Отчёт AMC", "Апгрейд", "Даунгрейд", "FDA", "M&A", "Размещение", "Гайденс", "Сектор в игре"];

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="micro-label mb-2">{title}</legend>
      {children}
    </fieldset>
  );
}

export function WatchlistFormDialog({
  open, editing, initial, existingTickers, saving, onClose, onSubmit,
}: {
  open: boolean;
  editing: WatchlistItem | null;
  initial: WatchlistFormData;
  existingTickers: Set<string>;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = React.useState<WatchlistFormData>(initial);
  const [errors, setErrors] = React.useState<{ ticker?: string; targetPrice?: string; stopPrice?: string }>({});
  React.useEffect(() => { if (open) { setForm(initial); setErrors({}); } }, [open, initial]);

  function set(k: keyof WatchlistFormData, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "ticker" || k === "targetPrice" || k === "stopPrice") setErrors((e) => ({ ...e, [k]: undefined }));
  }

  const handleFundamentalsLoaded = React.useCallback((d: TickerFundamentals) => {
    const suggestions = suggestTagsFromFundamentals(d);
    setForm((f) => {
      const merged = Array.from(new Set([...splitTags(f.tags), ...suggestions]));
      return {
        ...f, tags: merged.join(", "), sector: f.sector || d.sector || "",
        marketCap: d.marketCap ?? null, float: d.float ?? null, adv: d.averageDailyVolume ?? null,
        atr: d.atr ?? null, relativeVolume: d.relativeVolume ?? null, beta: d.beta ?? null,
        shortInterest: d.shortInterest ?? null, longName: d.longName ?? null,
      };
    });
  }, []);

  const tickerUp = form.ticker.trim().toUpperCase();
  const duplicate = !editing && tickerUp && existingTickers.has(tickerUp);
  const stop = Number(form.stopPrice.replace(",", "."));
  const target = Number(form.targetPrice.replace(",", "."));
  const hasLevels = form.stopPrice.trim() && form.targetPrice.trim() && Number.isFinite(stop) && Number.isFinite(target) && stop !== target;

  function handleSave() {
    const nextErrors = {
      ticker: !tickerUp ? "Укажите тикер" : !TICKER_RE.test(tickerUp) ? "Только латиница, цифры и . - (до 12 символов)" : undefined,
      targetPrice: priceError(form.targetPrice) ?? undefined,
      stopPrice: priceError(form.stopPrice) ?? undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.ticker || nextErrors.targetPrice || nextErrors.stopPrice) return;
    const toNum = (v: string) => (v.trim() ? v.replace(",", ".").trim() : "");
    const { screenshotUrls, ...rest } = form;
    onSubmit({
      ...rest,
      ticker: tickerUp,
      targetPrice: toNum(form.targetPrice),
      stopPrice: toNum(form.stopPrice),
      screenshotUrl: screenshotUrlsToString(screenshotUrls) || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-full max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Редактировать ${editing.ticker}` : "Добавить тикер"}</DialogTitle>
          <DialogDescription>Score пересчитается автоматически по катализатору, float, ATR, rVol и сектору.</DialogDescription>
        </DialogHeader>
        <div
          className="space-y-5"
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (!saving) handleSave(); } }}
        >
          <FieldGroup title="Основное">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="wl-ticker">Тикер *</Label>
                <Input id="wl-ticker" autoFocus className="uppercase" value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="AAPL" autoComplete="off"
                  aria-invalid={!!errors.ticker} aria-describedby={errors.ticker ? "wl-ticker-err" : duplicate ? "wl-ticker-dup" : undefined} />
                {errors.ticker && <p id="wl-ticker-err" className="text-xs text-down">{errors.ticker}</p>}
                {!errors.ticker && duplicate && <p id="wl-ticker-dup" className="text-xs text-[hsl(var(--chart-3))]">Уже есть в вотчлисте</p>}
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="wl-status">Статус</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger id="wl-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wl-stop" className={toneText("down")}>Стоп, $</Label>
                <Input id="wl-stop" inputMode="decimal" value={form.stopPrice} onChange={(e) => set("stopPrice", e.target.value)} placeholder="170"
                  aria-invalid={!!errors.stopPrice} aria-describedby={errors.stopPrice ? "wl-stop-err" : undefined} />
                {errors.stopPrice && <p id="wl-stop-err" className="text-xs text-down">{errors.stopPrice}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wl-target" className={toneText("up")}>Цель, $</Label>
                <Input id="wl-target" inputMode="decimal" value={form.targetPrice} onChange={(e) => set("targetPrice", e.target.value)} placeholder="180"
                  aria-invalid={!!errors.targetPrice} aria-describedby={errors.targetPrice ? "wl-target-err" : undefined} />
                {errors.targetPrice && <p id="wl-target-err" className="text-xs text-down">{errors.targetPrice}</p>}
              </div>
            </div>
            {hasLevels && (
              <p className="text-xs text-muted-foreground">
                Направление: <Pill tone={target > stop ? "up" : "down"} className="text-2xs">{target > stop ? "Лонг" : "Шорт"}</Pill> — определяется по взаимному положению стопа и цели.
              </p>
            )}
            <TickerFundamentalsBar ticker={form.ticker} onLoaded={handleFundamentalsLoaded} />
          </FieldGroup>

          <FieldGroup title="Контекст">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
              <div className="space-y-1.5">
                <Label htmlFor="wl-sector">Сектор</Label>
                <Input id="wl-sector" value={form.sector} onChange={(e) => set("sector", e.target.value)} placeholder="Technology" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="wl-catalyst">Катализатор</Label>
                  <React.Suspense fallback={null}><LazyVoiceRecorder onTranscript={(text) => set("catalyst", form.catalyst ? `${form.catalyst}\n${text}` : text)} /></React.Suspense>
                </div>
                <Textarea id="wl-catalyst" className="min-h-[64px]" value={form.catalyst} onChange={(e) => set("catalyst", e.target.value)} placeholder="Отчёт, новость, FDA…" />
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Быстрые катализаторы">
                  {CATALYST_PRESETS.map((p) => (
                    <button key={p} type="button" className="chip min-h-7 px-2.5 text-xs"
                      onClick={() => set("catalyst", form.catalyst.includes(p) ? form.catalyst : form.catalyst ? `${form.catalyst}, ${p}` : p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </FieldGroup>

          <FieldGroup title="Теги">
            <TagSelector selectedTags={splitTags(form.tags)} onChange={(tags) => set("tags", tags.join(", "))} />
          </FieldGroup>

          <FieldGroup title="Сценарий и заметки">
            <div className="flex justify-end">
              <React.Suspense fallback={null}><LazyVoiceRecorder onTranscript={(text) => set("notes", form.notes ? `${form.notes}\n${text}` : text)} /></React.Suspense>
            </div>
            <Textarea aria-label="Сценарий и заметки" className="min-h-[88px]" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Вход от уровня…, стоп под…, частичная фиксация у…" />
          </FieldGroup>

          <FieldGroup title="Скриншоты">
            <ScreenshotFields urls={form.screenshotUrls} onChange={(urls) => setForm((f) => ({ ...f, screenshotUrls: urls }))} />
          </FieldGroup>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="button" onClick={handleSave} disabled={!form.ticker.trim() || saving} title="Ctrl+Enter">{saving ? "Сохраняем…" : editing ? "Сохранить" : "Добавить"}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
