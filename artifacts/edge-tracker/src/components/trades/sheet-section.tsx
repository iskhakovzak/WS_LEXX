/**
 * Collapsible sections of the trade sheet («Исполнения», «Разбор», «Заметки», «Контекст», «Связанное») and their
 * open / closed state, remembered per user in localStorage (sheet-model sectionOpen decides the default).
 * A section's body mounts on first open and then stays mounted while hidden: drafts survive a collapse and heavy
 * panels (fills, quality, AI, news) request nothing until the viewer opens them.
 */
import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseSectionPrefs, sectionOpen, type SectionContext, type SectionPrefs, type SheetSection } from "./sheet-model";

const STORAGE_PREFIX = "ws.trades.sheet.sections";

function readPrefs(key: string): SectionPrefs {
  try {
    return parseSectionPrefs(window.localStorage.getItem(key));
  } catch {
    return {};
  }
}

function writePrefs(key: string, prefs: SectionPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch { /* storage unavailable: the state still holds for this session */ }
}

export type SectionsApi = { isOpen: (s: SheetSection) => boolean; setOpen: (s: SheetSection, open: boolean) => void };

/** `user` scopes the remembered state; a click also pins the section for the open trade (`tradeId`). */
export function useSheetSections(user: string | null, tradeId: number | null, ctx: SectionContext): SectionsApi {
  const key = `${STORAGE_PREFIX}:${user ?? "-"}`;
  const [prefs, setPrefs] = React.useState<SectionPrefs>(() => readPrefs(key));
  React.useEffect(() => { setPrefs(readPrefs(key)); }, [key]);
  const [pinned, setPinned] = React.useState<{ tradeId: number | null; map: SectionPrefs }>({ tradeId, map: {} });
  const overrides = pinned.tradeId === tradeId ? pinned.map : {};
  const isOpen = (s: SheetSection) => sectionOpen(s, prefs, overrides[s], ctx);
  const setOpen = React.useCallback((s: SheetSection, open: boolean) => {
    setPrefs((p) => {
      const next = { ...p, [s]: open };
      writePrefs(key, next);
      return next;
    });
    setPinned((cur) => ({ tradeId, map: { ...(cur.tradeId === tradeId ? cur.map : {}), [s]: open } }));
  }, [key, tradeId]);
  return { isOpen, setOpen };
}

type SectionProps = {
  id: SheetSection;
  title: string;
  api: SectionsApi;
  /** Small status after the title (count, «ждёт разбора»). */
  badge?: React.ReactNode;
  /** Mount the body even while closed (it reports data the header needs). */
  keepMounted?: boolean;
  /** A section nested in another one: lighter heading, no divider. */
  nested?: boolean;
  children: React.ReactNode;
};

export function SheetSection({ id, title, api, badge, keepMounted, nested, children }: SectionProps) {
  const open = api.isOpen(id);
  const uid = React.useId();
  const [seen, setSeen] = React.useState(open);
  React.useEffect(() => { if (open) setSeen(true); }, [open]);
  const Heading = nested ? "h4" : "h3";
  return (
    <section aria-labelledby={`${uid}-h`} data-sheet-section={id} className={nested ? "rounded-xl bg-[var(--glass-bg)] px-3" : undefined}>
      <Heading className="m-0">
        <button
          id={`${uid}-h`}
          type="button"
          aria-expanded={open}
          aria-controls={`${uid}-b`}
          onClick={() => api.setOpen(id, !open)}
          className={cn(
            "group flex w-full items-center gap-2 rounded-lg text-left font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            nested ? "min-h-10 py-2 text-sm" : "min-h-12 py-3 text-base",
          )}
        >
          <ChevronRight
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-2)] group-hover:text-primary motion-reduce:transition-none", open && "rotate-90")}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{title}</span>
          {badge}
        </button>
      </Heading>
      <div id={`${uid}-b`} hidden={!open} className={nested ? "pb-3" : "pb-5"}>
        {(seen || open || keepMounted) && children}
      </div>
    </section>
  );
}
