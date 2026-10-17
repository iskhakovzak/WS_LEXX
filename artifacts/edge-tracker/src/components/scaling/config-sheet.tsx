import * as React from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill, Segmented } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Config, Op, Rule, RuleInput, Tier, TierInput, Unit } from "./use-scaling";
import { useSaveRules, useSaveTiers } from "./use-scaling";
import { OP_LABEL } from "./format";

type Tab = "tiers" | "rules";

const MONEY_FIELDS: { key: keyof Tier; label: string }[] = [
  { key: "accountSize", label: "Buying power" },
  { key: "dailyLossLimit", label: "Дневной лимит" },
  { key: "weeklyLossLimit", label: "Недельный лимит" },
  { key: "maxDrawdown", label: "Макс. просадка" },
  { key: "maxRiskPerTrade", label: "Риск на сделку" },
  { key: "maxPositionUsd", label: "Макс. позиция" },
  { key: "maxOvernightExposure", label: "Овернайт-экспозиция" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null);

function TiersEditor({ initial, onSaved }: { initial: Tier[]; onSaved: () => void }) {
  const [tiers, setTiers] = React.useState<Tier[]>(initial);
  const [dirty, setDirty] = React.useState(false);
  const { toast } = useToast();
  const save = useSaveTiers();
  const update = (i: number, patch: Partial<Tier>) => {
    setTiers((xs) => xs.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    setDirty(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    setTiers((xs) => {
      const j = i + dir;
      if (j < 0 || j >= xs.length) return xs;
      const copy = [...xs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
    setDirty(true);
  };
  const remove = (i: number) => { setTiers((xs) => xs.filter((_, j) => j !== i)); setDirty(true); };
  const add = () => {
    const last = tiers[tiers.length - 1];
    setTiers((xs) => [...xs, {
      key: `tier-${xs.length + 1}`, name: `Тир ${xs.length + 1}`, order: xs.length + 1,
      accountSize: last?.accountSize ?? null, dailyLossLimit: last?.dailyLossLimit ?? null, weeklyLossLimit: last?.weeklyLossLimit ?? null,
      maxDrawdown: last?.maxDrawdown ?? null, maxRiskPerTrade: last?.maxRiskPerTrade ?? null, maxPositionUsd: last?.maxPositionUsd ?? null,
      maxOvernightExposure: last?.maxOvernightExposure ?? null, maxOpenPositions: last?.maxOpenPositions ?? null,
      allowOvernight: last?.allowOvernight ?? false, allowSwing: last?.allowSwing ?? false, description: "",
    }]);
    setDirty(true);
  };
  const submit = async () => {
    const body: TierInput[] = tiers.map((t, i) => ({ ...t, key: slug(t.key) || `tier-${i + 1}`, order: i + 1, description: t.description || null }));
    const keys = new Set(body.map((t) => t.key));
    if (keys.size !== body.length) { toast({ title: "Ключи тиров должны быть уникальными", variant: "destructive" }); return; }
    try {
      await save.mutateAsync(body);
      toast({ title: "Лестница тиров сохранена" });
      setDirty(false);
      onSaved();
    } catch (e) {
      toast({ title: "Не удалось сохранить тиры", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Порядок сверху вниз = от стартового тира к верхнему. Лимиты записываются в риск-лимиты трейдера при одобрении повышения/понижения.
        Тиры, удалённые из списка, деактивируются (история сохраняется).
      </p>
      <ol className="flex flex-col gap-3">
        {tiers.map((t, i) => (
          <li key={i} className="glass-panel flex flex-col gap-3 rounded-xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="purple">{i + 1}</Pill>
              <Input value={t.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Название тира" className="w-40" maxLength={60} />
              <Input value={t.key} onChange={(e) => update(i, { key: e.target.value })} aria-label="Ключ тира (латиница)" className="w-32 font-mono text-xs" maxLength={40} placeholder="key" />
              <Input value={t.description ?? ""} onChange={(e) => update(i, { description: e.target.value })} aria-label="Описание тира" className="min-w-[160px] flex-1" maxLength={300} placeholder="Описание" />
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Выше" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ниже" onClick={() => move(i, 1)} disabled={i === tiers.length - 1}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-down" aria-label="Удалить тир" onClick={() => remove(i)} disabled={tiers.length <= 1}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MONEY_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-2xs text-muted-foreground">
                  {f.label}, $
                  <Input type="number" inputMode="decimal" min={0} value={t[f.key] == null ? "" : String(t[f.key])} onChange={(e) => update(i, { [f.key]: numOrNull(e.target.value) } as Partial<Tier>)} className="h-8 text-sm" />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
                Открытых позиций
                <Input type="number" inputMode="numeric" min={0} value={t.maxOpenPositions == null ? "" : String(t.maxOpenPositions)} onChange={(e) => update(i, { maxOpenPositions: numOrNull(e.target.value) == null ? null : Math.round(Number(e.target.value)) })} className="h-8 text-sm" />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-2"><Switch checked={t.allowOvernight} onCheckedChange={(v) => update(i, { allowOvernight: v })} aria-label="Овернайт разрешён" /> Овернайт</label>
              <label className="flex items-center gap-2"><Switch checked={t.allowSwing} onCheckedChange={(v) => update(i, { allowSwing: v })} aria-label="Свинг разрешён" /> Свинг</label>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={add} disabled={tiers.length >= 20}><Plus className="h-4 w-4" aria-hidden="true" /> Добавить тир</Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setTiers(initial); setDirty(false); }} disabled={!dirty}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Сбросить</Button>
          <Button size="sm" onClick={submit} disabled={!dirty || save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить тиры"}</Button>
        </div>
      </div>
    </div>
  );
}

function RulesEditor({ initial, config, onSaved }: { initial: Rule[]; config: Config; onSaved: () => void }) {
  const [rules, setRules] = React.useState<RuleInput[]>(initial);
  const [dirty, setDirty] = React.useState(false);
  const { toast } = useToast();
  const save = useSaveRules();
  const metrics = config.meta.metrics;
  const update = (i: number, patch: Partial<RuleInput>) => { setRules((xs) => xs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true); };
  const remove = (i: number) => { setRules((xs) => xs.filter((_, j) => j !== i)); setDirty(true); };
  const add = (kind: "promote" | "demote") => {
    setRules((xs) => [...xs, { kind, metric: kind === "promote" ? "net_pnl" : "limit_breaches", op: kind === "promote" ? ">=" : ">=", value: kind === "promote" ? 5 : 3, unit: kind === "promote" ? "x_daily_limit" : "abs", windowDays: 20, tierKey: null, label: null, enabled: true }]);
    setDirty(true);
  };
  const submit = async () => {
    try {
      await save.mutateAsync(rules.map((r) => ({ ...r, value: Number(r.value), windowDays: Math.max(1, Math.round(Number(r.windowDays) || 20)) })));
      toast({ title: "Правила сохранены" });
      setDirty(false);
      onSaved();
    } catch (e) {
      toast({ title: "Не удалось сохранить правила", description: (e as Error).message, variant: "destructive" });
    }
  };
  const group = (kind: "promote" | "demote") => rules.map((r, i) => ({ r, i })).filter((x) => x.r.kind === kind);
  const Row = ({ r, i }: { r: RuleInput; i: number }) => {
    const m = metrics.find((x) => x.key === r.metric);
    return (
      <li className={cn("glass-panel flex flex-col gap-2 rounded-xl p-3", !r.enabled && "opacity-60")}>
        <div className="flex flex-wrap items-center gap-2">
          <Switch checked={r.enabled} onCheckedChange={(v) => update(i, { enabled: v })} aria-label="Правило включено" />
          <Select value={r.metric} onValueChange={(v) => update(i, { metric: v })}>
            <SelectTrigger className="w-56" aria-label="Метрика"><SelectValue /></SelectTrigger>
            <SelectContent>{metrics.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={r.op} onValueChange={(v) => update(i, { op: v as Op })}>
            <SelectTrigger className="w-20" aria-label="Оператор"><SelectValue /></SelectTrigger>
            <SelectContent>{config.meta.ops.map((o) => <SelectItem key={o} value={o}>{OP_LABEL[o]}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" inputMode="decimal" step="any" value={String(r.value)} onChange={(e) => update(i, { value: Number(e.target.value) })} aria-label="Порог" className="w-24" />
          {(m?.unit === "usd") ? (
            <Select value={r.unit} onValueChange={(v) => update(i, { unit: v as Unit })}>
              <SelectTrigger className="w-52" aria-label="Единица порога"><SelectValue /></SelectTrigger>
              <SelectContent>{config.meta.units.map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">{m?.unit === "pct" ? "%" : m?.unit === "r" ? "R" : m?.unit === "x" ? "×" : m?.unit === "score" ? "/10" : ""}</span>
          )}
          <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 text-down" aria-label="Удалить правило" onClick={() => remove(i)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">окно
            <Input type="number" inputMode="numeric" min={1} max={260} value={String(r.windowDays)} onChange={(e) => update(i, { windowDays: Number(e.target.value) })} aria-label="Окно, торговых дней" className="h-7 w-16 text-xs" />
            торг. дн.
          </label>
          <label className="flex items-center gap-1.5">тир
            <Select value={r.tierKey ?? "__all"} onValueChange={(v) => update(i, { tierKey: v === "__all" ? null : v })}>
              <SelectTrigger className="h-7 w-36 text-xs" aria-label="Для какого тира"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">все тиры</SelectItem>
                {config.tiers.map((t) => <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <Input value={r.label ?? ""} onChange={(e) => update(i, { label: e.target.value || null })} aria-label="Название правила" placeholder={m?.label ?? "Название"} className="h-7 min-w-[180px] flex-1 text-xs" maxLength={120} />
        </div>
        {m?.hint && <p className="text-2xs text-muted-foreground/80">{m.hint}</p>}
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Повышение — когда выполнены <b>все</b> включённые правила тира. Понижение — когда сработало <b>любое</b>; понижение важнее повышения.
        Деньги берутся из брокерских сделок (PropReports), если они есть, иначе из журнала; без данных по $ правило показывает «нет данных».
      </p>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between"><h3 className="micro-label">Повышение</h3><Button variant="ghost" size="sm" onClick={() => add("promote")}><Plus className="h-4 w-4" aria-hidden="true" /> Правило</Button></div>
        <ul className="flex flex-col gap-2">{group("promote").map(({ r, i }) => <Row key={i} r={r} i={i} />)}</ul>
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between"><h3 className="micro-label">Понижение</h3><Button variant="ghost" size="sm" onClick={() => add("demote")}><Plus className="h-4 w-4" aria-hidden="true" /> Правило</Button></div>
        <ul className="flex flex-col gap-2">{group("demote").map(({ r, i }) => <Row key={i} r={r} i={i} />)}</ul>
      </section>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setRules(initial); setDirty(false); }} disabled={!dirty}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Сбросить</Button>
        <Button size="sm" onClick={submit} disabled={!dirty || save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить правила"}</Button>
      </div>
    </div>
  );
}

/** Curator editor for the tier ladder and the rule set, in a side sheet. */
export function ConfigSheet({ config, open, onOpenChange }: { config: Config | undefined; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [tab, setTab] = React.useState<Tab>("tiers");
  // Remount editors after a save so their local state picks up server-normalised values.
  const [epoch, setEpoch] = React.useState(0);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <div className="flex flex-col gap-4">
          <SheetHeader className="pr-10 text-left">
            <SheetTitle>Тиры и правила</SheetTitle>
            <SheetDescription>Лестница buying power и объективные условия перехода между ступенями</SheetDescription>
          </SheetHeader>
          <Segmented ariaLabel="Раздел настроек" value={tab} onChange={setTab} size="sm" options={[{ value: "tiers", label: "Тиры", count: config?.tiers.length }, { value: "rules", label: "Правила", count: config?.rules.length }]} />
          {!config ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : tab === "tiers" ? (
            <TiersEditor key={`t${epoch}`} initial={config.tiers} onSaved={() => setEpoch((e) => e + 1)} />
          ) : (
            <RulesEditor key={`r${epoch}`} initial={config.rules} config={config} onSaved={() => setEpoch((e) => e + 1)} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
