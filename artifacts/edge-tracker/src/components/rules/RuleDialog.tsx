import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ClipboardCheck, Clock, Gauge, Layers, ListChecks, ShieldAlert, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiJson, useRulePreview } from "./api";
import { fmtPct, fmtUsd, violationsWord } from "./constants";
import { autoName, type RuleDraft } from "./templates";
import type { Rule, RuleField, RuleGroup, RuleKindDef, RuleReport } from "./types";

const GROUP_META: Record<RuleGroup, { label: string; icon: LucideIcon }> = {
  loss: { label: "Убытки и тильт", icon: ShieldAlert },
  volume: { label: "Количество сделок", icon: ListChecks },
  time: { label: "Время", icon: Clock },
  size: { label: "Размер позиции", icon: Gauge },
  process: { label: "Процесс", icon: Layers },
  self: { label: "Самооценка", icon: ClipboardCheck },
};
const GROUP_ORDER: RuleGroup[] = ["loss", "volume", "time", "size", "process", "self"];

const RISK_LIMIT_LABEL: Record<string, string> = {
  daily_loss_limit: "дневной лимит убытка",
  max_position_usd: "макс. позиция",
  max_risk_per_trade: "макс. риск на сделку",
};

/** Form values are kept as strings (inputs); converted on save/preview. */
type FormValues = Record<string, string>;

function hhmmToClock(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
}

function toForm(fields: RuleField[], th: Record<string, unknown>, useDefaults: boolean): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    const raw = th[f.key];
    const has = raw !== undefined && raw !== null && raw !== "";
    if (f.type === "tickers") out[f.key] = Array.isArray(raw) ? raw.join(", ") : has ? String(raw) : "";
    else if (f.type === "time") out[f.key] = hhmmToClock(has ? raw : useDefaults ? f.default : "");
    else out[f.key] = has ? String(raw) : useDefaults && !f.optional ? String(f.default) : "";
  }
  return out;
}

function toThreshold(fields: RuleField[], v: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (v[f.key] ?? "").trim();
    if (!raw) continue;
    if (f.type === "tickers") out[f.key] = raw.split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase());
    else if (f.type === "time") out[f.key] = raw.replace(":", "");
    else out[f.key] = Number(raw.replace(",", "."));
  }
  return out;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function RuleDialog({
  open,
  onOpenChange,
  trader,
  kinds,
  editing,
  draft,
  days,
  canManageTeam,
  canManageDesk,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trader: string;
  kinds: RuleKindDef[];
  editing: (Rule | RuleReport) | null;
  draft: RuleDraft | null;
  days: number;
  /** Staff reviewing another trader: the rule becomes an office rule. */
  canManageTeam: boolean;
  canManageDesk: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [values, setValues] = useState<FormValues>({});
  const [note, setNote] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [scope, setScope] = useState<"trader" | "desk">("trader");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindDef = kinds.find((k) => k.kind === kind);
  const isEdit = !!editing;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setScope("trader");
    if (editing) {
      const def = kinds.find((k) => k.kind === editing.kind);
      setKind(editing.kind);
      setName(editing.name);
      setNameTouched(true);
      setValues(toForm(def?.fields ?? [], editing.threshold ?? {}, false));
      setNote(editing.note ?? "");
      setEnabled(editing.enabled);
    } else if (draft) {
      const def = kinds.find((k) => k.kind === draft.kind);
      setKind(draft.kind);
      setName(draft.name);
      setNameTouched(true);
      setValues(toForm(def?.fields ?? [], draft.threshold ?? {}, true));
      setNote(draft.note ?? "");
      setEnabled(draft.enabled !== false);
    } else {
      setKind("");
      setName("");
      setNameTouched(false);
      setValues({});
      setNote("");
      setEnabled(true);
    }
  }, [open, editing, draft, kinds]);

  function pickKind(k: RuleKindDef) {
    setKind(k.kind);
    const v = toForm(k.fields, {}, true);
    setValues(v);
    setNameTouched(false);
    setName(autoName(k.label, k.kind, toThreshold(k.fields, v)));
    setError(null);
  }

  function setField(key: string, val: string) {
    const next = { ...values, [key]: val };
    setValues(next);
    if (!nameTouched && kindDef) setName(autoName(kindDef.label, kindDef.kind, toThreshold(kindDef.fields, next)));
  }

  const threshold = useMemo(() => (kindDef ? toThreshold(kindDef.fields, values) : null), [kindDef, values]);
  const debouncedTh = useDebounced(threshold, 400);
  const previewOn = open && !!kindDef && kindDef.auto !== false;
  const preview = useRulePreview(trader, days, kind, debouncedTh, previewOn);

  const grouped = useMemo(() => {
    const m = new Map<RuleGroup, RuleKindDef[]>();
    for (const k of kinds) {
      if (k.legacy && (k.kind === "trade_without_checklist" || k.kind === "position_size_pct" || k.kind === "max_loss_per_day_pct" || k.kind === "max_risk_per_trade_usd" || k.kind === "no_swing")) continue;
      const g = (k.group ?? "process") as RuleGroup;
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(k);
    }
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
  }, [kinds]);

  async function save() {
    if (!kindDef || !threshold) return;
    const n = name.trim();
    if (!n) { setError("Введите название"); return; }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await apiJson(`/rules/${editing.id}`, { method: "PATCH", json: { name: n, threshold, enabled, note: note.trim() || null } }, "Не удалось сохранить правило");
        toast({ title: "Правило обновлено" });
      } else {
        const body: Record<string, unknown> = { name: n, kind, threshold, enabled, note: note.trim() || null };
        if (scope === "desk") body.desk = true;
        else body.trader = trader;
        await apiJson(`/rules`, { method: "POST", json: body }, "Не удалось создать правило");
        toast({ title: "Правило добавлено", description: kindDef.auto === false ? "Отмечайте его раз в день в журнале" : "Проверяется по всем сделкам автоматически" });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const showGallery = !isEdit && !kindDef;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("max-h-[92dvh] overflow-y-auto", showGallery ? "max-w-3xl" : "max-w-xl")}
        onKeyDown={(e) => { if (!showGallery && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (!saving) save(); } }}
      >
        <DialogHeader>
          <DialogTitle>{showGallery ? "Новое правило" : kindDef?.label ?? "Правило"}</DialogTitle>
          <DialogDescription>
            {showGallery
              ? "Выберите, что контролировать. Сделки проверяются автоматически — вы сразу увидите, сколько раз правило нарушалось и во что это обошлось."
              : kindDef?.hint ?? ""}
          </DialogDescription>
        </DialogHeader>

        {showGallery ? (
          <div className="flex flex-col gap-4">
            {grouped.map(([g, list]) => {
              const meta = GROUP_META[g];
              const Icon = meta.icon;
              return (
                <section key={g} className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />{meta.label}
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {list.map((k) => (
                      <button
                        key={k.kind}
                        type="button"
                        onClick={() => pickKind(k)}
                        className="tile tile-interactive press flex min-h-[64px] flex-col items-start gap-0.5 p-3 text-left"
                      >
                        <span className="text-sm font-medium text-foreground">{k.label}</span>
                        {k.hint && <span className="line-clamp-2 text-xs text-muted-foreground">{k.hint}</span>}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : kindDef ? (
          <div className="flex flex-col gap-4">
            {!isEdit && !draft && (
              <button type="button" onClick={() => setKind("")} className="-mt-1 inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Другой тип правила
              </button>
            )}

            {kindDef.fields.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {kindDef.fields.map((f) => (
                  <FieldInput key={f.key} field={f} value={values[f.key] ?? ""} onChange={(v) => setField(f.key, v)} />
                ))}
              </div>
            )}

            {kindDef.auto === false && (
              <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-foreground">
                Это правило нельзя проверить по сделкам. Раз в день в журнале появится отметка «соблюдал / нарушил» — из неё считается соблюдение и разница в результате.
              </p>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-name" className="text-sm font-medium">Название</Label>
              <Input
                id="rule-name"
                value={name}
                maxLength={120}
                aria-invalid={!!error && !name.trim() || undefined}
                onChange={(e) => { setName(e.target.value); setNameTouched(true); setError(null); }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-note" className="text-sm font-medium">Зачем это правило <span className="font-normal text-muted-foreground">— необязательно</span></Label>
              <Textarea id="rule-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: после трёх стопов я начинаю отыгрываться" />
            </div>

            {!isEdit && (canManageDesk || canManageTeam) && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Для кого</span>
                <Segmented<"trader" | "desk">
                  ariaLabel="Для кого правило"
                  size="sm"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: "trader", label: canManageTeam ? `${trader} · правило офиса` : trader },
                    ...(canManageDesk ? [{ value: "desk" as const, label: <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />Весь деск</span> }] : []),
                  ]}
                />
                {(scope === "desk" || canManageTeam) && (
                  <span className="text-xs text-muted-foreground">Трейдер увидит правило с пометкой «Офис» и не сможет его изменить или выключить.</span>
                )}
              </div>
            )}

            {isEdit && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Switch id="rule-enabled" checked={enabled} onCheckedChange={setEnabled} />
                  <Label htmlFor="rule-enabled" className="cursor-pointer text-sm">Правило активно</Label>
                </div>
                {editing?.enabled && !enabled && (
                  <span className="text-xs text-muted-foreground">
                    Правило перестанет проверяться. Найденные нарушения и комментарии к ним сохранятся в архиве и вернутся, если включить его снова.
                  </span>
                )}
              </div>
            )}

            {previewOn && <PreviewBox q={preview} days={days} />}
            {error && <p className="text-sm text-down" role="alert">{error}</p>}
          </div>
        ) : null}

        {!showGallery && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button onClick={save} disabled={saving || !kindDef}>{saving ? "Сохранение…" : isEdit ? "Сохранить" : "Добавить правило"}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({ field, value, onChange }: { field: RuleField; value: string; onChange: (v: string) => void }) {
  const id = `rule-f-${field.key}`;
  const placeholder = field.optional && field.riskLimit ? `из риск-деска (${RISK_LIMIT_LABEL[field.riskLimit]})` : undefined;
  return (
    <div className={cn("flex flex-col gap-1", field.type === "tickers" && "sm:col-span-2")}>
      <Label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.type === "time" && <span className="font-normal text-muted-foreground"> · ET</span>}
      </Label>
      {field.type === "tickers" ? (
        <Input id={id} value={value} placeholder="TSLA, GME, AMC" className="uppercase" onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "time" ? (
        <Input id={id} type="time" step={60} value={value} className="tabular-nums" onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="relative">
          <Input id={id} type="number" inputMode="decimal" min={0} step="any" value={value} placeholder={placeholder} className={cn("tabular-nums", field.unit && "pr-12")} onChange={(e) => onChange(e.target.value)} />
          {field.unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{field.unit}</span>}
        </div>
      )}
    </div>
  );
}

function PreviewBox({ q, days }: { q: ReturnType<typeof useRulePreview>; days: number }) {
  const r = q.data;
  return (
    <div className="tile flex min-h-[84px] flex-col gap-1.5 p-3" aria-live="polite">
      <span className="text-xs font-medium text-muted-foreground">Если бы правило действовало последние {days} дней</span>
      {q.isLoading || q.isFetching && !r ? (
        <span className="skeleton block h-5 w-3/4" aria-hidden="true" />
      ) : q.error ? (
        <span className="text-sm text-muted-foreground">{q.error instanceof Error ? q.error.message : "Предпросмотр недоступен"}</span>
      ) : !r ? null : r.status === "no_data" ? (
        <span className="text-sm text-muted-foreground">По вашим сделкам это правило проверить нельзя — нет нужных данных.</span>
      ) : r.violations === 0 ? (
        <span className="text-sm text-foreground">Ни одного нарушения за {r.days} торговых дней — правило уже соблюдается.</span>
      ) : (
        <>
          <span className="text-sm text-foreground">
            <b className="tabular-nums">{r.violations}</b> {violationsWord(r.violations)} в <b className="tabular-nums">{r.violatedDays}</b> из {r.days} дней · соблюдение <b className="tabular-nums">{fmtPct(r.compliance)}</b>
          </span>
          {r.impact != null && (
            <span className="text-sm">
              {r.impact < 0 ? "Нарушения стоили " : r.impact > 0 ? "Нарушения принесли " : "Влияние на результат "}
              <b className={cn("tabular-nums", r.impact < 0 ? "text-down" : r.impact > 0 ? "text-up" : "")}>{fmtUsd(r.impact, { sign: false })}</b>
              {r.broken.avg != null && r.clean.avg != null && (
                <span className="text-muted-foreground"> · сделка с нарушением в среднем {fmtUsd(r.broken.avg)} против {fmtUsd(r.clean.avg)}</span>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
