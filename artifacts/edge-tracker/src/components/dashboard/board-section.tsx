/**
 * One dashboard section on the board: its label, then its tiles packed onto a 12 / 6 / 1-column grid (./pack). In the
 * edit mode every tile gets its chrome, tiles with nothing to show yet get a placeholder, an empty section stays as a
 * drop zone; outside it an empty section collapses with its label. framer-motion animates the reflow (position only;
 * none with reduced motion).
 */
import { useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion, type MotionValue } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { SectionHead } from "./dash-card";
import { TileChrome } from "./board-chrome";
import { dragType } from "./tile-gallery";
import { variantFor, type BoardSection, type LayoutItem, type TileSize, type TileVariant } from "./layout-model";
import { packTiles, type Placed } from "./pack";
import { SECTION_META, type SectionId } from "./use-dashboard";

export type BoardTileDef = {
  /** Has something to show now (open positions, the risk desk…); otherwise a placeholder in the edit mode only. */
  ready: boolean;
  render: (variant: TileVariant) => ReactNode;
};
export type BoardSectionDef = { title: ReactNode; hint?: ReactNode; action?: ReactNode; after?: ReactNode };

export type SectionViewProps = {
  section: BoardSection;
  def: BoardSectionDef;
  /** The section's tiles this viewer may see, in order. */
  items: LayoutItem[];
  /** Some tiles are kept but hidden on «Команда» (a note in the edit mode). */
  scopeHidden: boolean;
  editing: boolean;
  cols: number;
  tile: (id: SectionId) => BoardTileDef;
  drag: { id: SectionId | null; x: MotionValue<number>; y: MotionValue<number>; onPointerDown: (e: ReactPointerEvent, id: SectionId, handle: boolean) => void };
  reduced: boolean;
  fresh: SectionId | null;
  registerGrid: (s: BoardSection, el: HTMLElement | null) => void;
  registerTile: (id: SectionId, el: HTMLElement | null) => void;
  onKey: (e: KeyboardEvent, id: SectionId) => void;
  onResize: (id: SectionId, size: TileSize, rows: 1 | 2) => void;
  onRemove: (id: SectionId) => void;
  onOpenGallery: () => void;
  onDropTile: (id: SectionId, before: SectionId | null) => void;
  keysHintId: string;
};

const SIZE_KEY = { s: "customize.sizeNames.s", m: "customize.sizeNames.m", l: "customize.sizeNames.l", xl: "customize.sizeNames.xl" } as const;

export function BoardSectionView(p: SectionViewProps) {
  const { t } = dashboardI18n.useT();
  const { section, def, editing, cols } = p;
  const [dropping, setDropping] = useState(false);
  const shown = p.items.filter((it) => editing || p.tile(it.id).ready);
  // A handful of tiles: packing is cheap enough for every render (drag reflows re-pack live).
  const placed = packTiles(shown, cols);
  if (!shown.length && !editing && !def.after) return null;

  const headId = `dash-${section}-head`;
  const accepts = (e: DragEvent) => editing && e.dataTransfer.types.includes(dragType(section));
  const onDrop = (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    setDropping(false);
    const id = e.dataTransfer.getData(dragType(section)) as SectionId;
    const under = (e.target as HTMLElement).closest<HTMLElement>("[data-tile-id]");
    p.onDropTile(id, (under?.dataset.tileId as SectionId | undefined) ?? null);
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropping(true); } },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropping(false); },
    onDrop,
  };

  return (
    <section aria-labelledby={headId} className="dash-section" data-section={section}>
      <SectionHead id={headId} title={def.title} hint={def.hint} action={editing ? undefined : def.action} />
      {editing && p.scopeHidden && <p className="dash-note">{t("customize.teamHidden")}</p>}
      {shown.length > 0 ? (
        <div
          ref={(el) => p.registerGrid(section, el)}
          className="dash-grid"
          data-dropping={dropping || undefined}
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          {...dropProps}
        >
          {placed.map((pl) => {
            const it = shown.find((x) => x.id === pl.id);
            if (!it) return null;
            return <BoardTile key={it.id} {...p} item={it} pl={pl} sizeName={t(SIZE_KEY[it.size])} />;
          })}
          {p.drag.id && placed.some((pl) => pl.id === p.drag.id) && <Slot pl={placed.find((pl) => pl.id === p.drag.id) as Placed} />}
        </div>
      ) : (
        editing && (
          <div ref={(el) => p.registerGrid(section, el)} className="dash-empty" data-dropping={dropping || undefined} {...dropProps}>
            <span>{t("customize.emptySection")}</span>
            <button type="button" className="dash-empty-add" onClick={p.onOpenGallery}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("customize.add")}
            </button>
          </div>
        )
      )}
      {def.after}
    </section>
  );
}

function Slot({ pl }: { pl: Placed }) {
  return <div className="dash-slot" aria-hidden="true" style={{ gridColumn: `${pl.x + 1} / span ${pl.w}`, gridRow: `${pl.y + 1} / span ${pl.h}` }} />;
}

function BoardTile(p: SectionViewProps & { item: LayoutItem; pl: Placed; sizeName: string }) {
  const { t } = dashboardI18n.useT();
  const { item, pl, editing, cols } = p;
  const id = item.id;
  const def = p.tile(id);
  const dragging = p.drag.id === id;
  const variant = variantFor(item, pl.w, pl.h, cols);
  const label = SECTION_META[id].label;
  const body = def.ready ? def.render(variant) : <TilePlaceholder label={label} />;
  return (
    <motion.div
      ref={(el: HTMLDivElement | null) => p.registerTile(id, el)}
      layout={p.reduced || dragging ? false : "position"}
      transition={{ type: "spring", stiffness: 520, damping: 44 }}
      data-tile-id={id}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      data-fresh={p.fresh === id || undefined}
      className={cn("dash-tile")}
      style={{ gridColumn: `${pl.x + 1} / span ${pl.w}`, gridRow: `${pl.y + 1} / span ${pl.h}`, ...(dragging ? { x: p.drag.x, y: p.drag.y } : null) }}
      tabIndex={editing ? 0 : undefined}
      role={editing ? "group" : undefined}
      aria-roledescription={editing ? t("customize.roleTile") : undefined}
      aria-label={editing ? t("customize.tileAria", { label, size: p.sizeName }) : undefined}
      aria-describedby={editing ? p.keysHintId : undefined}
      onPointerDown={editing ? (e: ReactPointerEvent) => p.drag.onPointerDown(e, id, false) : undefined}
      onKeyDown={editing ? (e: KeyboardEvent) => p.onKey(e, id) : undefined}
      onContextMenu={editing ? (e: MouseEvent) => e.preventDefault() : undefined}
    >
      <div className="dash-tile-body" inert={editing || undefined}>{body}</div>
      {editing && (
        <TileChrome
          item={item}
          label={label}
          grown={pl.h > (item.rows ?? 1) || pl.growth >= Math.max(2, cols / 6)}
          shortened={pl.shortened}
          onHandleDown={(e) => p.drag.onPointerDown(e, id, true)}
          onResize={(size, rows) => p.onResize(id, size, rows)}
          onRemove={() => p.onRemove(id)}
        />
      )}
    </motion.div>
  );
}

/** A tile with nothing to show yet (edit mode, gallery preview). */
export function TilePlaceholder({ label }: { label: string }) {
  const { t } = dashboardI18n.useT();
  return (
    <div className="ins-tile glass-panel dash-card dash-placeholder">
      <span className="ins-label">{label}</span>
      <p className="text-sm text-muted-foreground">{t("customize.placeholder")}</p>
    </div>
  );
}
