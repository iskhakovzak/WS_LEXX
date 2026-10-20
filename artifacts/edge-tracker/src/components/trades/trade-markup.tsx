/**
 * «Обзор» → разметка of the trade card (Волна 2, item 2.12): setup, mistakes and grade in one block, one tap each.
 *   setup     one of the office playbook setups (components/shared/setup-picker; the server links playbook_id) — or the
 *             classifier's suggestion as a one-tap chip;
 *   mistakes  the shared ErrorPicker (one vocabulary; the server writes the one errors store, item 2.8);
 *   grade     A+ / A / B / C (trades.confidence_grade — the review layer, editable on broker trades too).
 * Notes live in the review editor right below. Read-only viewers see the values only.
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { tradesI18n } from "@/i18n/ns/trades";
import { SetupPicker, SuggestionChip } from "@/components/shared/setup-picker";
import { ErrorPicker } from "@/components/shared/error-picker";
import { canonicalOf, codesOfWords } from "@/components/shared/error-vocab";
import { classifyTags, type TagKind } from "./review-presets";
import { linkedPlaybookId } from "./sheet-model";

const GRADES = ["A+", "A", "B", "C"] as const;
type Grade = (typeof GRADES)[number];

export type MarkupPatch = { setup?: string | null; confidenceGrade?: Grade };

export function TradeMarkup({ trade: t, canEdit, onTag, onPatch }: {
  trade: Trade;
  canEdit: boolean;
  /** Mistake toggles go through the page's tag handler (same path as key M). */
  onTag?: (t: Trade, kind: TagKind, value: string | null) => void;
  onPatch: (t: Trade, patch: MarkupPatch, opts?: { silent?: boolean }) => Promise<boolean>;
}) {
  const { t: tt } = tradesI18n.useT();
  const ids = React.useId();
  const mistakes = React.useMemo(() => codesOfWords(classifyTags(t.tags).mistakes), [t.tags]);
  const grade = (t.confidenceGrade ?? "").trim();
  const setupId = linkedPlaybookId(t);
  const row = "grid gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-center";
  const label = "text-xs text-muted-foreground";
  return (
    <section className="space-y-3" aria-label={tt("sheet.markup")}>
      <p className="micro-label">{tt("sheet.markup")}</p>
      <div className={row}>
        <span className={label}>{tt("sheet.markupParts.setup")}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {canEdit ? (
            <SetupPicker value={setupId} onChange={(c) => { void onPatch(t, { setup: c?.name ?? null }, { silent: true }); }} />
          ) : (
            <span className="text-sm">{t.setup || "—"}</span>
          )}
          {canEdit && !setupId && <SuggestionChip trade={t as Trade & { playbookId?: number | null }} />}
        </div>
      </div>
      <div className={row}>
        <span id={`${ids}-m`} className={label}>{tt("sheet.markupParts.mistakes")}</span>
        <ErrorPicker
          aria-labelledby={`${ids}-m`}
          value={mistakes}
          onChange={canEdit && onTag ? (code) => onTag(t, "mistake", canonicalOf(code)) : undefined}
          visible={6}
        />
      </div>
      <div className={row}>
        <span id={`${ids}-g`} className={label}>{tt("sheet.markupParts.grade")}</span>
        <div role="radiogroup" aria-labelledby={`${ids}-g`} className="flex gap-1">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={grade === g}
              disabled={!canEdit}
              onClick={() => { if (grade !== g) void onPatch(t, { confidenceGrade: g }, { silent: true }); }}
              className={cn(
                "chip min-h-8 min-w-10 justify-center px-2.5 text-xs font-semibold tabular-nums disabled:cursor-default",
                grade === g && (g === "A+" ? "!bg-up/15 !text-up" : g === "A" ? "!bg-primary/15 !text-primary" : g === "B" ? "!bg-warn/15 !text-warn" : "!bg-down/15 !text-down"),
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
