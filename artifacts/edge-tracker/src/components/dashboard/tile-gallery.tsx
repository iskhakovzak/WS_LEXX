/**
 * «Добавить плитку» — the tiles not on the dashboard, grouped by section, each with a live mini preview (the real tile,
 * scaled down, inert) and what it is for. Click (or «+») adds it at the end of its section; on a mouse it can also be
 * dragged onto its section. A non-modal panel (right side; a bottom sheet on phones), so the dashboard stays a drop
 * target and visible beside it.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { BOARD_SECTIONS, TILE_SPECS, type BoardSection } from "./layout-model";
import { SECTION_META, type SectionId } from "./use-dashboard";

/** dataTransfer type of a tile dragged from the gallery: the section is in the type (readable during dragover). */
export const dragType = (s: BoardSection) => `application/x-ws-tile-${s}`;

export function TileGallery({
  open,
  onClose,
  ids,
  preview,
  sectionTitle,
  onAdd,
  touch,
  reduced,
}: {
  open: boolean;
  onClose: () => void;
  ids: SectionId[];
  preview: (id: SectionId) => ReactNode;
  sectionTitle: (s: BoardSection) => ReactNode;
  onAdd: (id: SectionId) => void;
  /** Phone: a bottom sheet, tap to add. */
  touch: boolean;
  reduced: boolean;
}) {
  const { t } = dashboardI18n.useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);
  const from = touch ? { y: "100%" } : { x: "calc(100% + 2rem)" };
  const motionProps = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { ...from, opacity: 0.6 }, animate: { x: 0, y: 0, opacity: 1 }, exit: { ...from, opacity: 0 }, transition: { type: "spring" as const, stiffness: 420, damping: 40 } };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="gallery"
          {...motionProps}
          className="dash-gallery glass-panel"
          data-touch={touch || undefined}
          data-board-keep
          aria-labelledby="dash-gallery-title"
          role="complementary"
        >
          <div className="dash-gallery-head">
            <div className="min-w-0">
              <h2 id="dash-gallery-title" className="text-base font-semibold">{t("customize.gallery.title")}</h2>
              <p className="text-xs text-muted-foreground">{touch ? t("customize.gallery.hintTouch") : t("customize.gallery.hint")}</p>
            </div>
            <Button ref={closeRef} variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClose} aria-label={t("customize.gallery.close")}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="dash-gallery-body">
            {ids.length === 0 && <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t("customize.gallery.empty")}</p>}
            {BOARD_SECTIONS.map((s) => {
              const list = ids.filter((id) => TILE_SPECS[id].section === s);
              if (!list.length) return null;
              return (
                <section key={s} aria-labelledby={`dash-gallery-${s}`} className="flex flex-col gap-2">
                  <h3 id={`dash-gallery-${s}`} className="ins-label px-1">{sectionTitle(s)}</h3>
                  <ul className="flex flex-col gap-2.5">
                    {list.map((id) => (
                      <li key={id}>
                        <GalleryCard id={id} section={s} preview={preview(id)} onAdd={() => onAdd(id)} draggable={!touch} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function GalleryCard({ id, section, preview, onAdd, draggable }: { id: SectionId; section: BoardSection; preview: ReactNode; onAdd: () => void; draggable: boolean }) {
  const { t } = dashboardI18n.useT();
  const meta = SECTION_META[id];
  // The whole card is a large pointer target; keyboard users press its «+» button.
  return (
    <div
      className="dash-gallery-card"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(dragType(section), id);
        e.dataTransfer.setData("text/plain", meta.label);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onAdd}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onAdd(); }}
    >
      <div className="dash-gallery-preview" aria-hidden="true" inert>
        <div className="dash-gallery-scale">{preview}</div>
      </div>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{meta.label}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{meta.hint}</p>
          {TILE_SPECS[id].meOnly && <p className="mt-1 text-2xs text-muted-foreground/80">{t("customize.gallery.meOnly")}</p>}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label={t("customize.gallery.add", { label: meta.label })}
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
