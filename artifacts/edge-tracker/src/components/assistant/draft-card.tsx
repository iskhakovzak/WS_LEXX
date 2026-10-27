/**
 * A draft from the assistant as an editable card: every field can be changed before saving, and nothing is stored
 * until «Сохранить …» is clicked (draft-save.ts → the site's own endpoints). After saving: «Сохранено · Открыть».
 */
import * as React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { BookMarked, CalendarCheck, Check, ClipboardList, Loader2, MessageSquareText, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { assistantI18n } from "@/i18n/ns/assistant";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { DraftCard as Card } from "@/lib/assistant/model";
import type { DraftKind } from "@/lib/assistant/sse";
import { saveDraft } from "./draft-save";

type Field = { key: string; label: string; kind: "text" | "area" | "lines" | "csv" | "number" | "date" };
type FieldKey = Parameters<typeof assistantI18n.t>[0] & `drafts.fields.${string}`;

const F = (key: string, kind: Field["kind"], labelKey?: string): { key: string; kind: Field["kind"]; labelKey: string } => ({ key, kind, labelKey: labelKey ?? key });

const FIELDS: Record<DraftKind, { key: string; kind: Field["kind"]; labelKey: string }[]> = {
  playbook: [F("name", "text"), F("strategy", "text"), F("context", "area"), F("trigger", "area"), F("entry", "area"), F("stop", "area"), F("targets", "area"), F("management", "area"), F("invalidation", "area"), F("checklist", "lines"), F("tags", "csv"), F("notes", "area")],
  plan: [F("date", "date"), F("focus", "text"), F("marketView", "area"), F("riskNotes", "area"), F("maxLossUsd", "number"), F("maxTrades", "number")],
  eod: [F("date", "date"), F("mood", "number"), F("repeat", "area"), F("stop", "area", "stopDoing"), F("tomorrow", "area")],
  rule: [F("name", "text"), F("kind", "text"), F("note", "area")],
  curatorNote: [F("trader", "text"), F("day", "date", "date"), F("body", "area")],
};

const ICON: Record<DraftKind, React.ElementType> = { playbook: BookMarked, plan: CalendarCheck, eod: ClipboardList, rule: Scale, curatorNote: MessageSquareText };

function show(v: unknown, kind: Field["kind"]): string {
  if (v == null) return "";
  if (kind === "lines") return Array.isArray(v) ? v.join("\n") : String(v);
  if (kind === "csv") return Array.isArray(v) ? v.join(", ") : String(v);
  return String(v);
}

function parse(s: string, kind: Field["kind"]): unknown {
  if (kind === "lines") return s.split("\n").map((x) => x.trim()).filter(Boolean);
  if (kind === "csv") return s.split(",").map((x) => x.trim()).filter(Boolean);
  if (kind === "number") { const n = Number(s.replace(",", ".")); return s.trim() === "" || !Number.isFinite(n) ? undefined : n; }
  return s;
}

export function DraftCardView({ card }: { card: Card }) {
  const { t } = assistantI18n.useT();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState<Record<string, unknown>>(card.draft);
  const [state, setState] = React.useState<{ s: "idle" | "saving" | "saved" | "error"; href?: string; error?: string }>({ s: "idle" });
  const Icon = ICON[card.kind];
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setState({ s: "saving" });
    try {
      const r = await saveDraft({ ...card, draft }, qc);
      setState({ s: "saved", href: r.href });
    } catch (e) {
      setState({ s: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };
  const examples = Array.isArray(draft.exampleTradeIds) ? (draft.exampleTradeIds as number[]) : [];
  const inPlay = Array.isArray(draft.inPlay) ? (draft.inPlay as Record<string, unknown>[]) : [];
  const saved = state.s === "saved";
  return (
    <section aria-label={t(`drafts.kinds.${card.kind}`)} className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
      <header className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{t(`drafts.kinds.${card.kind}`)}</h3>
      </header>
      <p className="mb-2 text-2xs text-muted-foreground">{t("drafts.notSaved")}</p>
      <fieldset disabled={saved || state.s === "saving"} className="space-y-2">
        {FIELDS[card.kind].map((f) => {
          if (draft[f.key] === undefined && !["name", "focus", "body", "date"].includes(f.key)) return null;
          const id = `${card.id}-${f.key}`;
          const label = t(`drafts.fields.${f.labelKey}` as FieldKey);
          const value = show(draft[f.key], f.kind);
          return (
            <div key={f.key} className="space-y-1">
              <label htmlFor={id} className="text-2xs font-medium text-muted-foreground">{label}</label>
              {f.kind === "area" || f.kind === "lines" ? (
                <Textarea id={id} value={value} rows={Math.min(8, Math.max(2, value.split("\n").length + 1))} className="min-h-0 text-sm" onChange={(e) => set(f.key, parse(e.target.value, f.kind))} />
              ) : (
                <Input id={id} value={value} type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"} className="h-8 text-sm" onChange={(e) => set(f.key, parse(e.target.value, f.kind))} />
              )}
            </div>
          );
        })}
        {card.kind === "rule" && draft.threshold && typeof draft.threshold === "object" ? (
          <p className="text-xs text-muted-foreground">{t("drafts.fields.threshold")}: <span className="font-mono text-foreground">{Object.entries(draft.threshold as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(", ")}</span></p>
        ) : null}
        {inPlay.length ? (
          <div className="space-y-1">
            <p className="text-2xs font-medium text-muted-foreground">{t("drafts.fields.inPlay")}</p>
            <ul className="space-y-1 text-xs">{inPlay.map((x, i) => <li key={i}><span className="font-semibold text-foreground">{String(x.ticker ?? "")}</span>{x.trigger ? ` — ${String(x.trigger)}` : ""}</li>)}</ul>
          </div>
        ) : null}
      </fieldset>
      {examples.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("drafts.examples", { count: examples.length })}:{" "}
          {examples.map((id, i) => <React.Fragment key={id}>{i ? ", " : ""}<Link href={links.trade(id)} className="text-primary underline-offset-4 hover:underline">#{id}</Link></React.Fragment>)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {saved ? (
          <>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-up"><Check className="h-3.5 w-3.5" aria-hidden="true" />{t("drafts.saved")}</span>
            {state.href ? <Button asChild size="sm" variant="outline"><Link href={state.href}>{t("drafts.savedOpen")}</Link></Button> : null}
          </>
        ) : (
          <Button size="sm" onClick={() => void save()} disabled={state.s === "saving"} className={cn(state.s === "saving" && "opacity-80")}>
            {state.s === "saving" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {state.s === "saving" ? t("drafts.saving") : t(`drafts.save.${card.kind}`)}
          </Button>
        )}
        {state.s === "error" ? <p role="alert" className="text-xs text-destructive">{t("drafts.saveFailed", { message: state.error ?? "" })}</p> : null}
      </div>
    </section>
  );
}
