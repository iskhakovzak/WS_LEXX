import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CloudOff, Loader2, Plus, ShieldAlert, Sunrise, X } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { http } from "@/lib/api/http";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { journalI18n } from "@/i18n/ns/journal";
import { tagLabel } from "@/components/shared/trade-labels";
import type { JournalEntry, StorageMode } from "./use-journal-days";
import type { RuleViolation } from "./DayTrades";
import { EMOTION_TAGS, GOOD_TAGS, MISTAKE_TAGS, sameTag } from "./vocab";

// Pieces of «Дневник дня» (DayJournalEditor): steps, fields, chips, save indicator, morning check-in.

export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error"; message: string };

/** «Торговал по правилам?» as shown: the stored answer, else «Нет» when the auto check found violations (prefill). */
export function followedAnswer(stored: boolean | null, violations: number): boolean | null {
  return stored ?? (violations > 0 ? false : null);
}

/** Step 3 body: lesson, «по правилам?» (prefilled from the auto check), broken rules, other tags, auto violations. */
export function LessonStep({
  draft, editable, violations, update, toggleTag,
}: {
  draft: JournalEntry;
  editable: boolean;
  violations: RuleViolation[];
  update: (patch: Partial<JournalEntry>) => void;
  toggleTag: (tag: string) => void;
}) {
  const { t } = journalI18n.useT();
  // Prefill law (DENIS-13): with auto-detected violations an unanswered «по правилам?» starts as «Нет»; a stored «Да»
  // next to violations gets a one-line warning instead of being silently trusted.
  const followed = followedAnswer(draft.followedPlan, violations.length);
  const followedNote = violations.length === 0 ? null
    : draft.followedPlan == null ? t("editor.followedPrefilled", { count: violations.length })
    : draft.followedPlan ? t("editor.followedConflict", { count: violations.length })
    : null;
  const otherTags = draft.tags.filter((tag) => ![...MISTAKE_TAGS, ...EMOTION_TAGS].some((x) => sameTag(x, tag)));
  return (
    <>
      <ReviewField id="journal-lessons" label={t("editor.lesson")} tone="accent" value={draft.lessons} editable={editable} rows="min-h-[72px]"
        placeholder={t("editor.lessonPlaceholder")} onChange={(v) => update({ lessons: v })} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-muted-foreground" id="journal-followed">{t("editor.followedRules")}</span>
        <div role="group" aria-labelledby="journal-followed" className="flex gap-1.5">
          {([[true, commonI18n.t("yes")], [false, commonI18n.t("no")]] as const).map(([v, l]) => (
            <button
              key={l}
              type="button"
              disabled={!editable}
              aria-pressed={followed === v}
              onClick={() => update({ followedPlan: followed === v ? null : v })}
              className={cn(
                "chip min-h-8 px-3.5 text-sm font-medium disabled:cursor-default",
                followed === v && (v ? "!bg-up/15 !text-up" : "!bg-down/15 !text-down"),
              )}
            >
              {l}
            </button>
          ))}
        </div>
        {followedNote && <span className="text-2xs text-warn">{followedNote}</span>}
      </div>
      {(followed === false || MISTAKE_TAGS.some((m) => draft.tags.some((tag) => sameTag(tag, m))) || !editable) && (
        <ChipGroup label={t("editor.broke")} options={MISTAKE_TAGS} selected={draft.tags} editable={editable} toneOf={() => "down"} onToggle={toggleTag} />
      )}
      {otherTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {otherTags.map((tag) =>
            editable ? (
              <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-label={t("editor.removeTag", { tag: tagLabel(tag) })}
                className="chip inline-flex min-h-7 items-center gap-1 px-2.5 text-xs font-medium !text-foreground">
                {tagLabel(tag)}<X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : (
              <Pill key={tag} tone={GOOD_TAGS.includes(tag) ? "up" : "neutral"}>{tagLabel(tag)}</Pill>
            ),
          )}
        </div>
      )}
      {violations.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-warn/10 px-3 py-2" aria-label={t("editor.autoViolations")}>
          {violations.slice(0, 5).map((v) => (
            <li key={v.id} className="flex items-start gap-2 text-xs">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
              <span>
                <span className="font-medium">{v.ruleName ?? t("editor.rule")}</span>
                {v.ticker && <span className="text-muted-foreground"> · {v.ticker}</span>}
                {v.message && <span className="text-muted-foreground"> — {v.message}</span>}
              </span>
            </li>
          ))}
          {violations.length > 5 && <li className="text-2xs text-muted-foreground">{t("editor.andMore", { count: violations.length - 5 })}</li>}
        </ul>
      )}
    </>
  );
}

export function Step({ n, title, aside, children }: { n: number; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/15 text-2xs tabular-nums text-primary" aria-hidden="true">{n}</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function PlanBlock({ value, editable, prominent, onChange }: { value: string; editable: boolean; prominent: boolean; onChange: (v: string) => void }) {
  const { t } = journalI18n.useT();
  const [open, setOpen] = useState(prominent || !!value.trim());
  useEffect(() => { if (prominent || value.trim()) setOpen(true); }, [prominent, value]);
  if (!editable && !value.trim()) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-xs font-medium">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("editor.planChip")}
      </button>
    );
  }
  return (
    <div className="space-y-1.5 rounded-xl bg-[var(--glass-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="journal-plan" className="micro-label">{t("editor.planLabel")}</label>
        {editable && !value.trim() && (
          <Button variant="ghost" size="sm" onClick={() => onChange(t("planTemplate"))}>
            <Plus aria-hidden="true" />{t("editor.template")}
          </Button>
        )}
      </div>
      <Textarea
        id="journal-plan"
        readOnly={!editable}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("editor.planPlaceholder")}
        className={cn("leading-relaxed", prominent ? "min-h-[140px]" : "min-h-[64px]")}
      />
    </div>
  );
}

export function ChipGroup({
  label, options, selected, editable, toneOf, onToggle,
}: {
  label: string; options: string[]; selected: string[]; editable: boolean;
  toneOf: (t: string) => "up" | "down" | "warn"; onToggle: (t: string) => void;
}) {
  const active = (tag: string) => selected.some((x) => sameTag(x, tag));
  const shown = editable ? options : options.filter(active);
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby={id}>
      <span id={id} className="mr-1 text-xs text-muted-foreground">{label}</span>
      {shown.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
      {shown.map((tag) => {
        const on = active(tag);
        const tone = toneOf(tag);
        return (
          <button
            key={tag}
            type="button"
            disabled={!editable}
            aria-pressed={on}
            onClick={() => onToggle(tag)}
            className={cn(
              "chip min-h-7 px-2.5 text-xs font-medium disabled:cursor-default",
              on && (tone === "up" ? "!border-transparent !bg-up/15 !text-up" : tone === "down" ? "!border-transparent !bg-down/15 !text-down" : "!border-transparent !bg-warn/15 !text-warn"),
            )}
          >
            {tagLabel(tag)}
          </button>
        );
      })}
    </div>
  );
}

export function ScaleField({
  label, labels, value, editable, onChange,
}: {
  label: string;
  labels: readonly string[];
  value: number | null;
  editable: boolean;
  onChange: (v: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-medium">{value != null ? labels[value - 1] : "—"}</span>
      </div>
      <div role="group" aria-labelledby={id} className="glass-field flex items-center gap-0.5 p-1">
        {labels.map((l, i) => {
          const v = i + 1;
          const active = value === v;
          return (
            <button
              key={l}
              type="button"
              disabled={!editable}
              aria-pressed={active}
              aria-label={`${v} — ${l}`}
              title={l}
              onClick={() => onChange(active ? null : v)}
              className={cn(
                "min-h-7 flex-1 rounded-full text-xs font-semibold tabular-nums transition-colors disabled:cursor-default",
                active
                  ? v <= 2 ? "bg-down/20 text-down" : v === 3 ? "bg-primary/20 text-primary" : "bg-up/20 text-up"
                  : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
              )}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ReviewField({
  id, label, tone, value, editable, placeholder, onChange, rows = "min-h-[104px]",
}: {
  id: string;
  label: string;
  tone: "up" | "down" | "accent";
  value: string;
  editable: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  rows?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn("h-1.5 w-1.5 rounded-full", tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-primary")} aria-hidden="true" />
        {label}
      </label>
      <Textarea
        id={id}
        readOnly={!editable}
        value={value}
        placeholder={editable ? placeholder : "—"}
        onChange={(e) => onChange(e.target.value)}
        className={cn(rows, "leading-relaxed")}
      />
    </div>
  );
}

export function SaveIndicator({ status, mode, editable, onRetry }: { status: SaveState; mode: StorageMode; editable: boolean; onRetry: () => void }) {
  const { t } = journalI18n.useT();
  if (!editable) return <Pill>{commonI18n.t("states.readOnly")}</Pill>;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      {mode === "local" && (
        <span className="inline-flex items-center gap-1" title={t("editor.localTitle")}>
          <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />{t("editor.local")}
        </span>
      )}
      {status.kind === "saving" && (
        <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("editor.saving")}</span>
      )}
      {status.kind === "saved" && (
        <span className="inline-flex items-center gap-1 text-up">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {t("editor.savedAt", { time: fmtDate(status.at, "time") })}
        </span>
      )}
      {status.kind === "error" && (
        <Button variant="ghost" size="sm" className="text-down" onClick={onRetry}>{t("editor.errorRetry")}</Button>
      )}
      {status.kind === "idle" && <span>{t("editor.autosave")}</span>}
    </div>
  );
}

type CheckinRow = {
  sleepWell: boolean; stressed: boolean; tilted: boolean; focused: boolean; anxious: boolean; revenge: boolean;
  freeText: string | null;
} | null;

type CheckinFlag = "sleepWell" | "focused" | "stressed" | "anxious" | "tilted" | "revenge";
const CHECKIN_FLAGS: Array<{ key: CheckinFlag; good: boolean }> = [
  { key: "sleepWell", good: true },
  { key: "focused", good: true },
  { key: "stressed", good: false },
  { key: "anxious", good: false },
  { key: "tilted", good: false },
  { key: "revenge", good: false },
];

/** Morning check-in (from the dashboard) for this trader/day — one line of context next to the mood. */
export function MorningCheckin({ trader, date }: { trader: string; date: string }) {
  const { t } = journalI18n.useT();
  const { data } = useQuery({
    queryKey: ["journal-checkin", trader, date],
    enabled: !!trader,
    staleTime: 60_000,
    queryFn: ({ signal }): Promise<CheckinRow> =>
      http.get<CheckinRow>("/api/emotional-state/by-date", { query: { userId: trader, date }, signal }).catch(() => null),
  });
  if (!data) return null;
  const flags = CHECKIN_FLAGS.filter((f) => data[f.key] === true);
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground" title={data.freeText ?? undefined}>
      <Sunrise className="h-3.5 w-3.5 text-warn" aria-hidden="true" />{t("editor.morning")}
      {flags.length === 0 ? <span>{t("editor.noMarks")}</span> : flags.map((f) => <Pill key={f.key} tone={f.good ? "up" : "down"}>{t(`editor.checkin.${f.key}`)}</Pill>)}
    </span>
  );
}
