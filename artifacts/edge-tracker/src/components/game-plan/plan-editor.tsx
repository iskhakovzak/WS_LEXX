import { useCallback, useId, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Check, Compass, Globe2, Plus, ShieldAlert, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import { IMPACT, MARKET_BIAS, RISK_MODE, type Impact, type MarketBias, type RiskMode } from "./types";
import {
  MAX_PLAN_MEDIA,
  MAX_PLAN_TV,
  MAX_TICKERS,
  blockDone,
  emptyTicker,
  newKey,
  type DraftErrors,
  type PlanDraft,
  type TickerDraft,
} from "./plan-draft";
import { MediaStrip, PasteRouterProvider, TvLinkField, useEditorPaste } from "./plan-media";
import type { MediaContext } from "./media";
import { OwnRuleField } from "./own-rule-field";
import { Block, Field, IndexLevels, type SetDraft, type TickerSuggestion } from "./plan-editor-parts";
import { TickerEditor } from "./ticker-editor";
import { WatchlistPicker } from "./watchlist-picker";
import { gpI18n } from "@/i18n/ns/gamePlan";

export { Field, type SetDraft, type TickerSuggestion };

/** Quick rules in the UI language (they are inserted into the trader's own focus text). */
const FOCUS_CHIP_KEYS = ["a", "b", "c", "d", "e"] as const;

/**
 * Block editor shared by the desk plan (sheet) and a personal plan (inline).
 * Quick blocks: Рынок · Тикеры · Риск · Фокус. Ctrl+V anywhere pastes a screenshot into the focused block.
 */
export function PlanEditor(props: {
  mode: MediaContext;
  date: string;
  draft: PlanDraft;
  setDraft: SetDraft;
  errors: DraftErrors;
  /** Extra buttons in the «Тикеры» header (e.g. «Из плана деска»). */
  tickerActions?: React.ReactNode;
  /** Right side of the block nav (templates menu, status). */
  navSlot?: React.ReactNode;
  /** Offset for the sticky block nav inside its scroller. */
  stickyClassName?: string;
  /** Personal plan for the focus day: today's focus (MistakeId), listed first in «Правило дня». */
  focusMistake?: string | null;
}) {
  return (
    <PasteRouterProvider>
      <EditorInner {...props} />
    </PasteRouterProvider>
  );
}

function EditorInner({
  mode,
  date,
  draft,
  setDraft,
  errors,
  tickerActions,
  navSlot,
  stickyClassName,
  focusMistake,
}: Parameters<typeof PlanEditor>[0]) {
  const { t: tr } = gpI18n.useT();
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEditorPaste(rootRef, "plan");
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(draft.inPlay.length <= 2 ? draft.inPlay.map((t) => t.key) : draft.inPlay.filter((t) => !t.ticker).map((t) => t.key)),
  );
  const [biasTouched, setBiasTouched] = useState(false);
  const done = blockDone(draft);
  const isDesk = mode === "desk";
  // A mood picked (even «Нейтрально») is a filled market block (UMID-29).
  const marketDone = done.market || biasTouched || draft.bias !== "neutral";

  const patch = useCallback((p: Partial<PlanDraft>) => setDraft((d) => ({ ...d, ...p })), [setDraft]);
  const patchTicker = useCallback(
    (key: string, p: Partial<TickerDraft>) => setDraft((d) => ({ ...d, inPlay: d.inPlay.map((t) => (t.key === key ? { ...t, ...p } : t)) })),
    [setDraft],
  );
  const addTickers = useCallback(
    (list: TickerSuggestion[]) => {
      const fresh: TickerDraft[] = [];
      setDraft((d) => {
        const have = new Set(d.inPlay.map((t) => t.ticker.trim().toUpperCase()));
        for (const s of list) {
          const tk = s.ticker.trim().toUpperCase();
          if (tk && have.has(tk)) continue;
          have.add(tk);
          fresh.push(emptyTicker({ ...s, ticker: tk }));
        }
        return { ...d, inPlay: [...d.inPlay, ...fresh].slice(0, MAX_TICKERS) };
      });
      // setDraft is synchronous for the updater above in React 18 batching; open the new cards.
      queueMicrotask(() => setOpen((o) => new Set([...o, ...fresh.map((f) => f.key)])));
    },
    [setDraft],
  );
  const addBlank = () => {
    const t = emptyTicker();
    setDraft((d) => ({ ...d, inPlay: [...d.inPlay, t].slice(0, MAX_TICKERS) }));
    setOpen((o) => new Set([...o, t.key]));
    requestAnimationFrame(() => document.getElementById(`${uid}-t-${t.key}`)?.focus());
  };
  const removeTicker = (key: string) => setDraft((d) => ({ ...d, inPlay: d.inPlay.filter((t) => t.key !== key) }));

  const goto = (id: string) =>
    document.getElementById(`${uid}-${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

  const blocks: { id: string; label: string; done: boolean; count?: number }[] = [
    { id: "market", label: tr("editor.blocks.market"), done: marketDone },
    { id: "tickers", label: isDesk ? tr("editor.blocks.tickers") : tr("editor.blocks.myTickers"), done: done.tickers, count: draft.inPlay.length },
    { id: "risk", label: tr("editor.blocks.risk"), done: done.risk },
    { id: "focus", label: tr("editor.blocks.focus"), done: done.focus },
  ];

  const takenTickers = draft.inPlay.map((t) => t.ticker.trim().toUpperCase()).filter(Boolean);

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      {/* Block nav */}
      <nav
        aria-label={tr("editor.blocksAria")}
        className={cn("sticky-top z-sticky -mx-1 flex items-center gap-1.5 rounded-full px-1 py-1", stickyClassName)}
      >
        {/* One row on a phone: the pills scroll sideways instead of wrapping over the labels (ILYA-13). */}
        <div className="glass-field flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:none] sm:flex-none">
          {blocks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => goto(b.id)}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", b.done ? "bg-primary" : "bg-muted-foreground/40")} aria-hidden="true" />
              {b.label}
              {b.count ? <span className="tabular-nums text-muted-foreground">{b.count}</span> : null}
              <span className="sr-only">{b.done ? tr("editor.blockFilled") : tr("editor.blockEmpty")}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">{navSlot}</div>
      </nav>

      {/* ── Рынок ── */}
      <Block id={`${uid}-market`} icon={Globe2} title={tr("editor.blocks.market")} hint={tr("editor.marketHint")} pasteKey="plan">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-xs text-muted-foreground">{tr("editor.bias")}</span>
          {/* The mood chips scroll sideways on a phone instead of being clipped (ILYA-13). */}
          <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
          <Segmented<MarketBias>
            ariaLabel={tr("editor.bias")}
            size="sm"
            value={draft.bias}
            onChange={(v) => { setBiasTouched(true); patch({ bias: v }); }}
            options={(Object.keys(MARKET_BIAS) as MarketBias[]).map((k) => ({ value: k, label: MARKET_BIAS[k].label }))}
          />
          </div>
        </div>
        <Field label={tr("editor.context")} htmlFor={`${uid}-mv`}>
          <Textarea
            id={`${uid}-mv`}
            rows={4}
            maxLength={6000}
            value={draft.marketView}
            onChange={(e) => patch({ marketView: e.target.value })}
            placeholder={tr("editor.contextPlaceholder")}
          />
        </Field>

        {isDesk && <MacroEditor uid={uid} draft={draft} setDraft={setDraft} errors={errors} />}

        <IndexLevels uid={uid} draft={draft} errors={errors} patch={patch} />

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{tr("editor.marketMedia")}</span>
          <TvLinkField
            links={draft.tvLinks}
            max={MAX_PLAN_TV}
            onChange={(tvLinks) => patch({ tvLinks })}
            label={tr("editor.planTvLink")}
          />
          <MediaStrip
            refs={draft.media}
            onChange={(fn) => setDraft((d) => ({ ...d, media: fn(d.media) }))}
            context={mode}
            date={date}
            max={MAX_PLAN_MEDIA}
            pasteKey="plan"
            label={tr("editor.blocks.market")}
            onAddTvLinks={(urls) => setDraft((d) => ({ ...d, tvLinks: [...new Set([...d.tvLinks, ...urls])].slice(0, MAX_PLAN_TV) }))}
          />
        </div>
      </Block>

      {/* ── Тикеры ── */}
      <Block
        id={`${uid}-tickers`}
        icon={Target}
        title={isDesk ? tr("editor.tickersDesk") : tr("editor.blocks.myTickers")}
        hint={tr("editor.tickersHint")}
        actions={
          <>
            {tickerActions}
            <WatchlistPicker taken={takenTickers} onPick={(list) => addTickers(list)} />
            <Button type="button" variant="outline" size="sm" onClick={addBlank} disabled={draft.inPlay.length >= MAX_TICKERS}>
              <Plus aria-hidden="true" />
              {tr("editor.addTicker")}
            </Button>
          </>
        }
      >
        {draft.inPlay.length === 0 ? (
          <button
            type="button"
            onClick={addBlank}
            className="rounded-xl border border-dashed border-[var(--field-border)] px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isDesk ? tr("editor.addTickerEmptyDesk") : tr("editor.addTickerEmpty")}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            {draft.inPlay.map((t, idx) => (
              <TickerEditor
                key={t.key}
                uid={uid}
                t={t}
                idx={idx}
                mode={mode}
                date={date}
                errors={errors}
                open={open.has(t.key)}
                onToggle={() =>
                  setOpen((o) => {
                    const n = new Set(o);
                    if (n.has(t.key)) n.delete(t.key);
                    else n.add(t.key);
                    return n;
                  })
                }
                patch={(p) => patchTicker(t.key, p)}
                setMedia={(fn) => setDraft((d) => ({ ...d, inPlay: d.inPlay.map((x) => (x.key === t.key ? { ...x, media: fn(x.media) } : x)) }))}
                onRemove={() => removeTicker(t.key)}
              />
            ))}
          </div>
        )}
      </Block>

      {/* ── Риск ── */}
      <Block id={`${uid}-risk`} icon={ShieldAlert} title={tr("editor.riskTitle")} hint={isDesk ? tr("editor.riskHintDesk") : tr("editor.riskHint")} pasteKey="plan">
        {isDesk && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">{tr("editor.sizeMode")}</span>
            <Segmented<RiskMode>
              ariaLabel={tr("editor.riskModeAria")}
              size="sm"
              value={draft.riskMode}
              onChange={(v) => patch({ riskMode: v })}
              options={(Object.keys(RISK_MODE) as RiskMode[]).map((k) => ({ value: k, label: RISK_MODE[k].label }))}
            />
            <span className="text-xs text-muted-foreground">{RISK_MODE[draft.riskMode].hint}</span>
          </div>
        )}
        <div className={isDesk ? "grid grid-cols-2 gap-3 sm:max-w-md" : "grid grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-3"}>
          <Field label={tr("editor.maxLoss")} htmlFor={`${uid}-ml`} error={errors.maxLoss}>
            <Input id={`${uid}-ml`} inputMode="decimal" placeholder="—" value={draft.maxLoss} onChange={(e) => patch({ maxLoss: e.target.value })} className="tabular-nums" />
          </Field>
          <Field label={tr("editor.maxTrades")} htmlFor={`${uid}-mt`} error={errors.maxTrades}>
            <Input id={`${uid}-mt`} inputMode="numeric" placeholder="—" value={draft.maxTrades} onChange={(e) => patch({ maxTrades: e.target.value })} className="tabular-nums" />
          </Field>
          {!isDesk && <Field label={tr("editor.riskPerTrade")} htmlFor={`${uid}-rp`} error={errors.riskPerTrade}>
            <Input id={`${uid}-rp`} inputMode="decimal" placeholder="—" value={draft.riskPerTrade} onChange={(e) => patch({ riskPerTrade: e.target.value })} className="tabular-nums" />
          </Field>}
        </div>
        {!isDesk && <OwnRuleField id={`${uid}-or`} value={draft.ownRule} onChange={(v) => patch({ ownRule: v })} focusMistake={focusMistake} />}
        <Field label={isDesk ? tr("editor.riskNotesDesk") : tr("editor.riskNotes")} htmlFor={`${uid}-rn`}>
          <Textarea
            id={`${uid}-rn`}
            rows={3}
            maxLength={6000}
            value={draft.riskNotes}
            onChange={(e) => patch({ riskNotes: e.target.value })}
            placeholder={tr("editor.riskNotesPlaceholder")}
          />
        </Field>
      </Block>

      {/* ── Фокус ── */}
      <Block id={`${uid}-focus`} icon={Compass} title={tr("editor.focusTitle")} hint={tr("editor.focusHint")} pasteKey="plan">
        <Field label={tr("editor.focusRule")} htmlFor={`${uid}-fc`}>
          <Input
            id={`${uid}-fc`}
            maxLength={1000}
            value={draft.focus}
            onChange={(e) => patch({ focus: e.target.value })}
            placeholder={tr("editor.focusPlaceholder")}
            className="font-medium"
          />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr("editor.quickRules")}>
          {FOCUS_CHIP_KEYS.map((k) => {
            const c = tr(`editor.focusChips.${k}`);
            // Personal plans keep the preset key (shown in each reader's language, UMID-13); the desk plan stores text.
            const on = isDesk ? draft.focus.includes(c) : draft.focusRules.includes(k);
            return (
              <button
                key={k}
                type="button"
                className="chip min-h-8 px-3 text-xs"
                aria-pressed={on}
                onClick={() =>
                  isDesk
                    ? patch({
                        focus: on
                          ? draft.focus.replace(c, "").replace(/^[\s;·]+|[\s;·]+$/g, "").replace(/\s*;\s*;\s*/g, "; ")
                          : draft.focus.trim()
                            ? `${draft.focus.trim().replace(/[;.]$/, "")}; ${c}`
                            : c,
                      })
                    : patch({ focusRules: on ? draft.focusRules.filter((x) => x !== k) : FOCUS_CHIP_KEYS.filter((x) => x === k || draft.focusRules.includes(x)) })
                }
              >
                {on && <Check className="mr-1 inline h-3 w-3" aria-hidden="true" />}
                {c}
              </button>
            );
          })}
        </div>
      </Block>
    </div>
  );
}

function MacroEditor({ uid, draft, setDraft, errors }: { uid: string; draft: PlanDraft; setDraft: SetDraft; errors: DraftErrors }) {
  const { t: tr } = gpI18n.useT();
  const set = (key: string, p: Partial<PlanDraft["macro"][number]>) =>
    setDraft((d) => ({ ...d, macro: d.macro.map((m) => (m.key === key ? { ...m, ...p } : m)) }));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{tr("editor.macroTitle")}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2.5"
          disabled={draft.macro.length >= 30}
          onClick={() => setDraft((d) => ({ ...d, macro: [...d.macro, { key: newKey(), time: "08:30", title: "", impact: "high" }] }))}
        >
          <Plus aria-hidden="true" />
          {tr("editor.addEvent")}
        </Button>
      </div>
      {draft.macro.map((m) => (
        <div key={m.key} className="grid grid-cols-[84px_minmax(0,1fr)_130px_32px] items-start gap-2">
          <div>
            <Input
              aria-label={tr("editor.eventTime")}
              placeholder="08:30"
              inputMode="numeric"
              value={m.time}
              onChange={(e) => set(m.key, { time: e.target.value })}
              aria-invalid={!!errors[`macro.${m.key}.time`]}
              className="tabular-nums"
            />
            {errors[`macro.${m.key}.time`] && <p className="mt-1 text-xs text-destructive">{errors[`macro.${m.key}.time`]}</p>}
          </div>
          <div>
            <Input
              aria-label={tr("editor.event")}
              placeholder="CPI m/m"
              maxLength={200}
              value={m.title}
              onChange={(e) => set(m.key, { title: e.target.value })}
              aria-invalid={!!errors[`macro.${m.key}.title`]}
            />
            {errors[`macro.${m.key}.title`] && <p className="mt-1 text-xs text-destructive">{errors[`macro.${m.key}.title`]}</p>}
          </div>
          <Select value={m.impact} onValueChange={(v) => set(m.key, { impact: v as Impact })}>
            <SelectTrigger aria-label={tr("editor.impact")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(IMPACT) as Impact[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {IMPACT[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-8"
            aria-label={tr("editor.removeEvent")}
            onClick={() => setDraft((d) => ({ ...d, macro: d.macro.filter((x) => x.key !== m.key) }))}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <span id={`${uid}-macro-end`} className="sr-only" />
    </div>
  );
}

