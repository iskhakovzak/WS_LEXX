import { StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPrice } from "@/lib/format";
import type { Drawing, DrawingRole } from "../types";
import { DRAWING_LABEL, notesOf } from "../lib/drawings";
import { chartI18n } from "@/i18n/ns/chart";

const DOT: Record<DrawingRole, string> = { accent: "bg-primary", up: "bg-up", down: "bg-down", warn: "bg-[hsl(var(--chart-3))]" };

/**
 * «Заметки на графике» in the side column: every drawing with a note, this trade's first (drawings made on the trade
 * carry its id), then the ticker's other levels. A click selects the drawing on the chart (its note can be edited there).
 */
export function DrawingNotes({ drawings, tradeId, selected, onSelect }: { drawings: readonly Drawing[]; tradeId: number | null; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = chartI18n.useT();
  const notes = notesOf(drawings, tradeId);
  if (!notes.length) return null;
  return (
    <section className="flex flex-col gap-1.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3" aria-label={t("notes.title")}>
      <p className="flex items-center gap-1.5 text-xs font-semibold"><StickyNote className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {t("notes.title")}</p>
      <ul className="flex flex-col gap-1">
        {notes.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onSelect(d.id)}
              aria-pressed={selected === d.id}
              className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-[var(--glass-hover-bg)]", selected === d.id && "bg-[var(--glass-hover-bg)]")}
            >
              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", DOT[d.role ?? "accent"])} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-foreground">{d.label}</span>
                <span className="block text-2xs text-muted-foreground tabular-nums">
                  {DRAWING_LABEL[d.type]} · {fmtPrice(d.points[0]?.price ?? null)}{tradeId != null && d.tradeId === tradeId ? ` · ${t("notes.thisTrade")}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
