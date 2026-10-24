/**
 * The dashboard board (owner, 2026-10-25: customise right on the dashboard — remove, add back, move, resize — and
 * whatever is removed, the page still looks composed).
 *
 * «Сегодня» (the hero) is fixed on top; below it the four sections, each packed by ./pack. «Настроить» opens the edit
 * mode in place: tiles get a quiet outline and their chrome (handle, «×», S / M / L / XL, «2 ряда»), the rest dims a
 * little, «Готово» / Esc / a click outside the tiles leave it. Drag to move (./board-drag, long-press on touch), or
 * focus a tile: ←/→ move, + / − resize, Delete removes (announced to screen readers). «Добавить» opens the gallery
 * (./tile-gallery); a removed tile comes back from the toast («Вернуть»). The layout itself lives in the account
 * (./dashboard-layout).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useReducedMotion } from "@/lib/motion";
import { Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { DashSection } from "./dash-card";
import { CustomizeButton, EditBar } from "./board-chrome";
import { BoardSectionView, type BoardSectionDef, type BoardTileDef } from "./board-section";
import { TileGallery } from "./tile-gallery";
import { useBoardDrag } from "./board-drag";
import type { LayoutUpdate } from "./dashboard-layout";
import {
  addItem, BOARD_SECTIONS, moveOnto, removeItem, resizeItem, sectionItems, sectionOf, stepSize, TILE_ORDER,
  type BoardSection, type DashLayout, type TileSize,
} from "./layout-model";
import { SECTION_META, type SectionId } from "./use-dashboard";
import "./dashboard.css";

export type { BoardSectionDef, BoardTileDef };

/** Columns from the board's own width (the sidebar takes part of the window): 12 / 6 / 1. */
function useGridCols(ref: RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(12);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const of = (w: number) => (w >= 960 ? 12 : w >= 600 ? 6 : 1);
    // A hidden board (width 0: a suspended parent, a background tab) keeps its columns.
    const set = (w: number) => { if (w > 0) setCols(of(w)); };
    set(el.clientWidth);
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

type Props = {
  layout: DashLayout;
  setLayout: (u: LayoutUpdate) => void;
  reset: () => void;
  /** Signed in: the edit mode is offered. */
  editable: boolean;
  /** Role rules: a tile this viewer never sees (staff-only for a trader). */
  allowed: (id: SectionId) => boolean;
  /** Kept in the layout but hidden right now («Мои»-only tiles on «Команда»). */
  inScope: (id: SectionId) => boolean;
  tile: (id: SectionId) => BoardTileDef;
  preview: (id: SectionId) => ReactNode;
  sections: Record<BoardSection, BoardSectionDef>;
  hero: { title: ReactNode; node: ReactNode };
  onEditingChange?: (editing: boolean) => void;
};

export function DashBoard(props: Props) {
  const { layout, setLayout, allowed, inScope } = props;
  const { t } = dashboardI18n.useT();
  const { toast } = useToast();
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const cols = useGridCols(rootRef);
  const [editing, setEditingState] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [draft, setDraft] = useState<DashLayout | null>(null);
  const [message, setMessage] = useState("");
  const [fresh, setFresh] = useState<SectionId | null>(null);
  const shown = draft ?? layout;
  const shownRef = useRef(shown);
  const draftRef = useRef(draft);
  useEffect(() => { shownRef.current = shown; draftRef.current = draft; });
  const grids = useRef(new Map<BoardSection, HTMLElement>());
  const tiles = useRef(new Map<SectionId, HTMLElement>());
  const customizeRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const keysHintId = useId();
  const label = (id: SectionId) => SECTION_META[id].label;
  const visible = useCallback((lay: DashLayout, s: BoardSection) => sectionItems(lay, s).filter((it) => allowed(it.id) && inScope(it.id)), [allowed, inScope]);
  const place = (lay: DashLayout, id: SectionId) => {
    const list = visible(lay, sectionOf(id));
    return { pos: list.findIndex((it) => it.id === id) + 1, total: list.length };
  };

  const setEditing = useCallback((on: boolean) => {
    setEditingState(on);
    if (!on) setGalleryOpen(false);
    props.onEditingChange?.(on);
    setMessage(t(on ? "customize.announce.editOn" : "customize.announce.editOff"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onEditingChange, t]);

  const drag = useBoardDrag({
    current: () => shownRef.current,
    begin: (id) => { setDraft(layout); setMessage(t("customize.announce.picked", { label: label(id) })); },
    move: (next) => setDraft(next),
    end: (commit) => {
      const d = draftRef.current;
      const id = drag.dragId;
      if (commit && d) {
        setLayout(d);
        if (id) setMessage(t("customize.announce.moved", { label: label(id), ...place(d, id) }));
      } else setMessage(t("customize.announce.cancelled"));
      setDraft(null);
    },
    grid: (s) => grids.current.get(s) ?? null,
    tile: (id) => tiles.current.get(id) ?? null,
    reduced,
  });
  useLayoutEffect(() => { drag.reposition(); });

  // Esc / a click outside the tiles leaves the edit mode (the gallery first, then the mode).
  useEffect(() => {
    if (!editing) return;
    const keep = "[data-board-keep], [data-tile-id], [data-radix-popper-content-wrapper], [role='dialog'], [role='alertdialog'], [role='region'], [role='status'], [data-swipe-direction]";
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.isConnected || el.closest(keep) || drag.dragging()) return;
      setEditing(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || drag.dragging()) return;
      if (galleryOpen) { setGalleryOpen(false); addRef.current?.focus(); return; }
      setEditing(false);
      customizeRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [editing, galleryOpen, drag, setEditing]);

  // Entering: focus «Добавить» (Tab then walks the tiles); leaving: back to «Настроить».
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) addRef.current?.focus({ preventScroll: true });
    if (!editing && wasEditing.current) customizeRef.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);

  // A tile just added: into view and a short highlight.
  useEffect(() => {
    if (!fresh) return;
    tiles.current.get(fresh)?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    const timer = window.setTimeout(() => setFresh(null), 1400);
    return () => window.clearTimeout(timer);
  }, [fresh, reduced]);

  const resize = (id: SectionId, size: TileSize, rows: 1 | 2) => {
    setLayout((cur) => resizeItem(cur, id, size, rows));
    setMessage(t("customize.announce.resized", { label: label(id), size: `${t(`customize.sizeNames.${size}`)}${rows === 2 ? `, ${t("customize.rows")}` : ""}` }));
  };

  const remove = (id: SectionId) => {
    const list = visible(layout, sectionOf(id));
    const idx = list.findIndex((it) => it.id === id);
    const next = list[idx + 1]?.id ?? list[idx - 1]?.id ?? null;
    const { layout: after, undo } = removeItem(layout, id);
    setLayout(after);
    setMessage(t("customize.announce.removed", { label: label(id) }));
    if (next) window.requestAnimationFrame(() => tiles.current.get(next)?.focus({ preventScroll: true }));
    toast({
      title: t("customize.undo.title", { label: label(id) }),
      action: (
        <ToastAction altText={t("customize.undo.alt")} onClick={() => { setLayout((cur) => undo(cur)); setFresh(id); setMessage(t("customize.announce.added", { label: label(id) })); }}>
          {t("customize.undo.action")}
        </ToastAction>
      ),
    });
  };

  const add = (id: SectionId, before: SectionId | null = null) => {
    setLayout((cur) => {
      if (!before) return addItem(cur, id);
      return addItem(cur, id, { index: sectionItems(cur, sectionOf(id)).findIndex((it) => it.id === before) });
    });
    setFresh(id);
    setMessage(t("customize.announce.added", { label: label(id) }));
  };

  const onKey = (e: KeyboardEvent, id: SectionId) => {
    if (e.target !== e.currentTarget) return;
    const list = visible(layout, sectionOf(id));
    const idx = list.findIndex((it) => it.id === id);
    const it = list[idx];
    if (!it) return;
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (step) {
      e.preventDefault();
      const target = list[idx + step];
      if (!target) return;
      const next = moveOnto(layout, id, target.id);
      setLayout(next);
      setMessage(t("customize.announce.moved", { label: label(id), ...place(next, id) }));
      return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
      e.preventDefault();
      const s = stepSize(it, e.key === "+" || e.key === "=" ? 1 : -1);
      if (s) resize(id, s.size, s.rows);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(id);
    }
  };

  const hidden = TILE_ORDER.filter((id) => allowed(id) && !layout.items.some((it) => it.id === id));

  return (
    <div ref={rootRef} className="dash-board" data-editing={editing || undefined}>
      {editing && (
        <EditBar
          ref={addRef}
          onAdd={() => setGalleryOpen((v) => !v)}
          onReset={() => { props.reset(); setMessage(t("customize.announce.reset")); }}
          onDone={() => setEditing(false)}
        />
      )}
      <DashSection
        id="dash-today"
        title={props.hero.title}
        className="dash-hero"
        action={
          !props.editable ? null : editing ? (
            <span className="dash-fixed"><Lock className="h-3 w-3" aria-hidden="true" />{t("customize.fixed")}</span>
          ) : (
            <CustomizeButton ref={customizeRef} onClick={() => setEditing(true)} />
          )
        }
      >
        {props.hero.node}
      </DashSection>
      {BOARD_SECTIONS.map((s) => (
        <BoardSectionView
          key={s}
          section={s}
          def={props.sections[s]}
          items={visible(shown, s)}
          scopeHidden={sectionItems(shown, s).some((it) => allowed(it.id) && !inScope(it.id))}
          editing={editing}
          cols={cols}
          tile={props.tile}
          drag={{ id: drag.dragId, x: drag.x, y: drag.y, onPointerDown: drag.onPointerDown }}
          reduced={reduced}
          fresh={fresh}
          registerGrid={(sec, el) => { if (el) grids.current.set(sec, el); else grids.current.delete(sec); }}
          registerTile={(id, el) => { if (el) tiles.current.set(id, el); else tiles.current.delete(id); }}
          onKey={onKey}
          onResize={resize}
          onRemove={remove}
          onOpenGallery={() => setGalleryOpen(true)}
          onDropTile={add}
          keysHintId={keysHintId}
        />
      ))}
      <span id={keysHintId} className="sr-only">{t("customize.tileKeys")}</span>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{message}</div>
      {props.editable && (
        <TileGallery
          open={editing && galleryOpen}
          onClose={() => { setGalleryOpen(false); addRef.current?.focus(); }}
          ids={hidden}
          preview={props.preview}
          sectionTitle={(s) => props.sections[s].title}
          onAdd={(id) => add(id)}
          touch={cols === 1}
          reduced={reduced}
        />
      )}
    </div>
  );
}
