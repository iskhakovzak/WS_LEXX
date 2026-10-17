import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import type { LimitsInput, RiskLimits } from "./use-risk";
import { ApiError } from "@/lib/api/http";
import { useSaveLimits } from "./use-risk";
import { TIERS } from "./primitives";
import { fmtDate, fmtUsd } from "@/lib/format";

/** Scaling plan: default limits per tier (curator can override any field). */
export const TIER_PRESETS: Record<string, Omit<LimitsInput, "tier" | "notes">> = {
  trainee: { accountSize: 10_000, dailyLossLimit: 150, weeklyLossLimit: 400, maxDrawdown: 800, maxRiskPerTrade: 50, maxPositionUsd: 10_000, maxOvernightExposure: 0, maxOpenPositions: 2, allowOvernight: false, allowSwing: false },
  junior: { accountSize: 25_000, dailyLossLimit: 300, weeklyLossLimit: 900, maxDrawdown: 2_000, maxRiskPerTrade: 100, maxPositionUsd: 25_000, maxOvernightExposure: 5_000, maxOpenPositions: 3, allowOvernight: false, allowSwing: false },
  trader: { accountSize: 50_000, dailyLossLimit: 600, weeklyLossLimit: 1_800, maxDrawdown: 4_000, maxRiskPerTrade: 200, maxPositionUsd: 50_000, maxOvernightExposure: 20_000, maxOpenPositions: 5, allowOvernight: true, allowSwing: false },
  senior: { accountSize: 100_000, dailyLossLimit: 1_200, weeklyLossLimit: 3_500, maxDrawdown: 8_000, maxRiskPerTrade: 400, maxPositionUsd: 100_000, maxOvernightExposure: 50_000, maxOpenPositions: 8, allowOvernight: true, allowSwing: true },
  lead: { accountSize: 250_000, dailyLossLimit: 2_500, weeklyLossLimit: 7_000, maxDrawdown: 15_000, maxRiskPerTrade: 800, maxPositionUsd: 250_000, maxOvernightExposure: 120_000, maxOpenPositions: 12, allowOvernight: true, allowSwing: true },
};

const moneyStr = z
  .string()
  .trim()
  .refine((s) => s === "" || (/^\d+(\.\d{1,2})?$/.test(s.replace(/[\s,]/g, "")) && Number(s.replace(/[\s,]/g, "")) <= 1e12), "Введите сумму ≥ 0 (до 2 знаков после точки)");
const intStr = z.string().trim().refine((s) => s === "" || (/^\d+$/.test(s) && Number(s) <= 1000), "Целое число от 0 до 1000");

const schema = z
  .object({
    tier: z.string(),
    accountSize: moneyStr,
    dailyLossLimit: moneyStr,
    weeklyLossLimit: moneyStr,
    maxDrawdown: moneyStr,
    maxRiskPerTrade: moneyStr,
    maxPositionUsd: moneyStr,
    maxOvernightExposure: moneyStr,
    maxOpenPositions: intStr,
    allowOvernight: z.boolean(),
    allowSwing: z.boolean(),
    notes: z.string().max(2000, "Не больше 2000 символов"),
    reason: z.string().max(500, "Не больше 500 символов"),
  })
  .superRefine((v, ctx) => {
    const n = (s: string) => (s === "" ? null : Number(s.replace(/[\s,]/g, "")));
    const d = n(v.dailyLossLimit), w = n(v.weeklyLossLimit), dd = n(v.maxDrawdown), r = n(v.maxRiskPerTrade);
    if (d != null && w != null && w < d) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weeklyLossLimit"], message: "Недельный лимит не может быть меньше дневного" });
    if (d != null && r != null && r > d) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxRiskPerTrade"], message: "Риск на сделку больше дневного лимита" });
    if (d != null && dd != null && dd < d) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxDrawdown"], message: "Макс. просадка меньше дневного лимита" });
  });

type FormValues = z.infer<typeof schema>;

const s = (v: number | null | undefined) => (v == null ? "" : String(v));
const toNum = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[\s,]/g, "")));

function toForm(l: RiskLimits | null): FormValues {
  return {
    tier: l?.tier ?? "",
    accountSize: s(l?.accountSize),
    dailyLossLimit: s(l?.dailyLossLimit),
    weeklyLossLimit: s(l?.weeklyLossLimit),
    maxDrawdown: s(l?.maxDrawdown),
    maxRiskPerTrade: s(l?.maxRiskPerTrade),
    maxPositionUsd: s(l?.maxPositionUsd),
    maxOvernightExposure: s(l?.maxOvernightExposure),
    maxOpenPositions: s(l?.maxOpenPositions),
    allowOvernight: l?.allowOvernight ?? true,
    allowSwing: l?.allowSwing ?? true,
    notes: l?.notes ?? "",
    reason: "",
  };
}

const MONEY_FIELDS: { name: keyof FormValues; label: string; hint?: string }[] = [
  { name: "accountSize", label: "Размер счёта, $", hint: "База для % просадки" },
  { name: "maxPositionUsd", label: "Buying power на позицию, $" },
  { name: "dailyLossLimit", label: "Дневной лимит убытка, $", hint: "дневной стоп" },
  { name: "weeklyLossLimit", label: "Недельный лимит убытка, $" },
  { name: "maxDrawdown", label: "Макс. просадка от пика, $" },
  { name: "maxRiskPerTrade", label: "Макс. риск на сделку, $", hint: "1R" },
  { name: "maxOvernightExposure", label: "Макс. овернайт-экспозиция, $", hint: "Позиции через закрытие" },
];

export function LimitsForm({ trader, limits, onSaved }: { trader: string; limits: RiskLimits | null; onSaved?: () => void }) {
  const { toast } = useToast();
  const save = useSaveLimits(trader);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(limits) });

  // Reset when switching trader or after server data changes (not while user edits).
  const key = `${trader}|${limits?.updatedAt ?? ""}`;
  React.useEffect(() => {
    form.reset(toForm(limits));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const tier = form.watch("tier");
  const applyPreset = () => {
    const p = TIER_PRESETS[tier];
    if (!p) return;
    (Object.keys(p) as (keyof typeof p)[]).forEach((k) => {
      const v = p[k];
      form.setValue(k as keyof FormValues, (typeof v === "boolean" ? v : s(v as number | null)) as never, { shouldDirty: true, shouldValidate: true });
    });
  };

  const onSubmit = (v: FormValues) => {
    const body: LimitsInput = {
      tier: v.tier || null,
      accountSize: toNum(v.accountSize),
      dailyLossLimit: toNum(v.dailyLossLimit),
      weeklyLossLimit: toNum(v.weeklyLossLimit),
      maxDrawdown: toNum(v.maxDrawdown),
      maxRiskPerTrade: toNum(v.maxRiskPerTrade),
      maxPositionUsd: toNum(v.maxPositionUsd),
      maxOvernightExposure: toNum(v.maxOvernightExposure),
      maxOpenPositions: toNum(v.maxOpenPositions),
      allowOvernight: v.allowOvernight,
      allowSwing: v.allowSwing,
      notes: v.notes.trim() || null,
      reason: v.reason.trim() || null,
    };
    save.mutate(body, {
      onSuccess: () => {
        toast({ title: "Лимиты сохранены", description: trader });
        onSaved?.();
      },
      onError: (e) => {
        // Server-side validation: map each issue to its field; the rest goes to the toast.
        const issues = e instanceof ApiError ? e.field<{ path: string; message: string }[]>("issues") ?? [] : [];
        let mapped = 0;
        for (const it of issues) {
          const path = String(it.path ?? "");
          if (path && path in toForm(null)) {
            form.setError(path as keyof FormValues, { type: "server", message: it.message });
            mapped++;
          }
        }
        toast({
          title: "Не удалось сохранить",
          description: mapped ? `Проверьте поля: ${issues.map((i) => i.message).join("; ")}` : (e as Error).message,
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-wrap items-end gap-2">
          <FormField
            control={form.control}
            name="tier"
            render={({ field }) => (
              <FormItem className="min-w-[180px] flex-1">
                <FormLabel>Тир (план масштабирования)</FormLabel>
                <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Без тира" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Без тира</SelectItem>
                    {TIERS.map((t, i) => (
                      <SelectItem key={t.value} value={t.value}>{i + 1}. {t.label} — BP {fmtUsd(TIER_PRESETS[t.value]?.maxPositionUsd ?? null, { decimals: 0, compact: 10_000 })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="button" variant="outline" size="sm" onClick={applyPreset} disabled={!TIER_PRESETS[tier]}>
            <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Заполнить по тиру
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MONEY_FIELDS.map((f) => (
            <FormField
              key={f.name}
              control={form.control}
              name={f.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{f.label}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="не задан" autoComplete="off" {...field} value={field.value as string} />
                  </FormControl>
                  {f.hint && <FormDescription className="text-2xs">{f.hint}</FormDescription>}
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <FormField
            control={form.control}
            name="maxOpenPositions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Макс. открытых позиций</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" placeholder="не задан" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { name: "allowOvernight", label: "Разрешён овернайт", hint: "Перенос позиций через закрытие" },
            { name: "allowSwing", label: "Разрешён свинг", hint: "Удержание дни–недели" },
          ] as const).map((f) => (
            <FormField
              key={f.name}
              control={form.control}
              name={f.name}
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2.5 ring-1 ring-inset ring-[var(--field-border)]">
                  <div>
                    <FormLabel className="text-sm">{f.label}</FormLabel>
                    <FormDescription className="text-2xs">{f.hint}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          ))}
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Заметка куратора</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="Например: после 3 зелёных недель — повышение до «Трейдер»" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Причина изменения</FormLabel>
              <FormControl>
                <Input placeholder="Например: 2 недели без нарушений — повышение тира" autoComplete="off" {...field} />
              </FormControl>
              <FormDescription className="text-2xs">Попадёт в историю изменений лимитов</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {limits?.updatedBy ? `Изменено: ${limits.updatedBy}${limits.updatedAt ? `, ${fmtDate(limits.updatedAt, "shortDateTime")}` : ""}` : "Лимиты ещё не заданы"}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => form.reset(toForm(limits))} disabled={!form.formState.isDirty || save.isPending}>
              Сбросить
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending ? "Сохранение…" : "Сохранить лимиты"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
