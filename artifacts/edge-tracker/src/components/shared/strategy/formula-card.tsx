/**
 * «Формула стратегии» of a playbook setup: three connected lines — catalyst (type, required strength / direction) →
 * setup → trade (the exact entry). Read-only for anyone but the setup's editor (a curator looking at a trader's
 * personal setup sees it as written). Editing autosaves: the selects at once, the two lines ~1 s after typing stops.
 * Used by the setup card (playbook «Описание») and the academy lesson «Три строки стратегии».
 */
import * as React from "react";
import { ArrowDown, Check, Loader2, Workflow } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { strategyI18n } from "@/i18n/ns/strategy";
import { useSaveFormula } from "./api";
import { DIRECTIONS, KINDS, STRENGTHS, emptyFormula, isEmptyFormula, type StrategyFormula } from "./model";

const ANY = "__any";
const SAVE_MS = 900;

/** The catalyst line as text («Отчёт · сильный · медвежий»; «любой катализатор» when nothing is required). */
export function catalystLine(f: StrategyFormula | null | undefined): string {
  const t = strategyI18n.t;
  const c = f?.catalyst;
  const parts = [
    c?.kind ? t(`catalyst.kind.${c.kind}`) : null,
    c?.strength ? t(`catalyst.strength.${c.strength}`) : null,
    c?.direction ? t(`catalyst.direction.${c.direction}`) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("formula.anyKind");
}

function Step({ label, tone, last, children }: { label: string; tone: "accent" | "up" | "warn"; last?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex min-w-0 gap-3 pb-3 last:pb-0">
      {/* Connectedness: the three lines read as one chain (rail + arrow), not three loose fields. */}
      <span className="flex w-5 shrink-0 flex-col items-center" aria-hidden="true">
        <span className={cn("mt-1.5 h-2 w-2 rounded-full bg-current", toneText(tone))} />
        {!last && <span className="mt-1 w-px flex-1 bg-[var(--field-border)]" />}
        {!last && <ArrowDown className="-mt-1 h-3 w-3 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium", toneText(tone))}>{label}</p>
        <div className="mt-0.5 min-w-0 text-sm text-foreground">{children}</div>
      </div>
    </li>
  );
}

export function StrategyFormulaCard({
  setupId, formula, canEdit, className, title = true, onSaved, footer,
}: {
  /** Rendered under the three lines (the playbook card: the setup's timing matrix — the «when» of the trade line). */
  footer?: React.ReactNode;
  setupId: number;
  formula: StrategyFormula | null | undefined;
  canEdit: boolean;
  className?: string;
  /** Own heading row (off inside a block that has one). */
  title?: boolean;
  onSaved?: (f: StrategyFormula | null) => void;
}) {
  const { t } = strategyI18n.useT();
  const save = useSaveFormula(setupId);
  const [draft, setDraft] = React.useState<StrategyFormula>(() => formula ?? emptyFormula());
  const editing = React.useRef(false);
  const timer = React.useRef<number | null>(null);
  const [state, setState] = React.useState<"idle" | "saving" | "saved">("idle");
  React.useEffect(() => { if (!editing.current) setDraft(formula ?? emptyFormula()); }, [formula]);

  const flush = React.useCallback((f: StrategyFormula) => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const clean: StrategyFormula | null = isEmptyFormula(f) ? null : { ...f, setup: f.setup?.trim() || null, trade: f.trade?.trim() || null };
    setState("saving");
    save.mutate(clean, { onSuccess: () => { setState("saved"); onSaved?.(clean); }, onError: () => setState("idle") });
  }, [save, onSaved]);
  // Leaving the card with typing in flight still saves it (the mutation outlives the component).
  const latest = React.useRef({ draft, flush });
  latest.current = { draft, flush };
  React.useEffect(() => () => { if (timer.current) latest.current.flush(latest.current.draft); }, []);
  const change = (next: StrategyFormula, immediate: boolean) => {
    setDraft(next);
    if (timer.current) window.clearTimeout(timer.current);
    if (immediate) flush(next);
    else timer.current = window.setTimeout(() => flush(next), SAVE_MS);
  };
  const cat = draft.catalyst ?? emptyFormula().catalyst;
  const setCat = (patch: Partial<StrategyFormula["catalyst"]>) => change({ ...draft, catalyst: { ...cat, ...patch } }, true);

  const head = title && (
    <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Workflow className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t("formula.title")}
      </h3>
      {canEdit && state !== "idle" && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {state === "saving" ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
          {state === "saving" ? t("formula.saving") : t("formula.saved")}
        </span>
      )}
    </div>
  );

  if (!canEdit) {
    return (
      <section className={className} aria-label={t("formula.title")}>
        {head}
        {isEmptyFormula(formula) ? (
          <p className="text-sm text-muted-foreground">{t("formula.empty")}</p>
        ) : (
          <ol>
            <Step label={t("formula.line.catalyst")} tone="accent">{catalystLine(formula)}</Step>
            <Step label={t("formula.line.setup")} tone="warn">{formula?.setup || "—"}</Step>
            <Step label={t("formula.line.trade")} tone="up" last>{formula?.trade || "—"}</Step>
          </ol>
        )}
        {footer}
      </section>
    );
  }

  const sel = "h-8 w-auto min-w-[8.5rem] gap-2 text-xs";
  return (
    <section className={className} aria-label={t("formula.title")}>
      {head}
      <ol>
        <Step label={t("formula.line.catalyst")} tone="accent">
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={cat.kind ?? ANY} onValueChange={(v) => setCat({ kind: v === ANY ? null : (v as StrategyFormula["catalyst"]["kind"]) })}>
              <SelectTrigger className={sel} aria-label={t("formula.kindAria")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t("formula.anyKind")}</SelectItem>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`catalyst.kind.${k}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={cat.strength ?? ANY} onValueChange={(v) => setCat({ strength: v === ANY ? null : (v as StrategyFormula["catalyst"]["strength"]) })}>
              <SelectTrigger className={sel} aria-label={t("formula.strengthAria")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t("formula.anyStrength")}</SelectItem>
                {STRENGTHS.map((s) => <SelectItem key={s} value={s}>{t(`catalyst.strength.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={cat.direction ?? ANY} onValueChange={(v) => setCat({ direction: v === ANY ? null : (v as StrategyFormula["catalyst"]["direction"]) })}>
              <SelectTrigger className={sel} aria-label={t("formula.directionAria")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t("formula.anyDirection")}</SelectItem>
                {DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{t(`catalyst.direction.${d}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </Step>
        <Step label={t("formula.line.setup")} tone="warn">
          <Input
            aria-label={t("formula.line.setup")}
            className="h-8 text-sm"
            maxLength={300}
            placeholder={t("formula.setupPlaceholder")}
            value={draft.setup ?? ""}
            onFocus={() => { editing.current = true; }}
            onBlur={() => { editing.current = false; if (timer.current) flush(draft); }}
            onChange={(e) => change({ ...draft, setup: e.target.value }, false)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </Step>
        <Step label={t("formula.line.trade")} tone="up" last>
          <Input
            aria-label={t("formula.line.trade")}
            className="h-8 text-sm"
            maxLength={300}
            placeholder={t("formula.tradePlaceholder")}
            value={draft.trade ?? ""}
            onFocus={() => { editing.current = true; }}
            onBlur={() => { editing.current = false; if (timer.current) flush(draft); }}
            onChange={(e) => change({ ...draft, trade: e.target.value }, false)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </Step>
      </ol>
      {footer}
    </section>
  );
}
