/**
 * Header search button + the app-wide keys of the command palette (Ctrl/⌘K toggles it; "G then letter" jumps to a
 * section outside text fields). The palette itself (cmdk, search corpora, trade search) is a lazy chunk: it loads when
 * the browser is idle after the first screen, or on the first open — whichever comes first — so it is not part of the
 * entry bundle every page downloads.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { Kbd } from "@/components/ds";
import { shellI18n } from "@/i18n/ns/shell";
import { GO_KEYS, GO_KEYS_RU_LAYOUT, GO_MODE_EVENT } from "./nav";

const loadPalette = () => import("@/components/global-search");
const GlobalSearch = lazy(loadPalette);

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl";
const HOTKEY_LABEL = IS_MAC ? "⌘K" : "Ctrl+K";
const OPEN_EVENT = "ws-open-palette";

/** Open the command palette from anywhere (e.g. a mobile button or an empty state). */
export function openCommandPalette(query?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { query } }));
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** A request to open with a prefilled query (`n` changes on every request, so the same text can be sent twice). */
export type PaletteRequest = { query?: string; n: number };

export function PaletteLauncher() {
  const [open, setOpen] = useState(false);
  // Mounted from the first open on (keeps the palette's own state — recents, cached corpora — like before).
  const [mounted, setMounted] = useState(false);
  const [request, setRequest] = useState<PaletteRequest>({ n: 0 });
  const [, navigate] = useLocation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { t: ts } = shellI18n.useT();

  useEffect(() => { if (open) setMounted(true); }, [open]);

  // Warm the chunk once the first screen is idle, so the first Ctrl/⌘K opens instantly.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => { void loadPalette().catch(() => {}); };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 5000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(run, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let gAt = 0;
    function onKey(e: KeyboardEvent) {
      // «л» = K on the Russian keyboard layout (key codes, not text). i18n-ignore
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K" || e.key === "л" || e.key === "Л")) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog']")) return;
      const k = e.key.toLowerCase();
      if (k === "g" || k === "п") { // i18n-ignore (RU layout key)
        gAt = Date.now();
        // The sidebar shows every letter while it waits for the second key.
        window.dispatchEvent(new CustomEvent(GO_MODE_EVENT, { detail: true }));
        return;
      }
      if (gAt && Date.now() - gAt < 1200) {
        gAt = 0;
        window.dispatchEvent(new CustomEvent(GO_MODE_EVENT, { detail: false }));
        const href = GO_KEYS[k] ?? GO_KEYS[GO_KEYS_RU_LAYOUT[k] ?? ""];
        if (href) { e.preventDefault(); navigate(href); }
      }
    }
    function onOpen(e: Event) {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      setRequest((r) => ({ query: typeof q === "string" ? q : undefined, n: r.n + 1 }));
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [navigate]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        data-tour="palette"
        onClick={() => setOpen(true)}
        onPointerEnter={() => { void loadPalette().catch(() => {}); }}
        // Fixed width + short label: never clipped to «Поиск или к…» next to the logo and the market clock.
        // Sized by the header (`@container` in layout.tsx): icon-only until the header has room for the label.
        className="glass-field flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring @[720px]:w-44 @[720px]:min-w-0 @[720px]:shrink @[720px]:justify-start @[720px]:pl-3.5 @[720px]:pr-1.5 @[1180px]:w-56"
        title={ts("palette.triggerTitle", { hotkey: HOTKEY_LABEL })}
        aria-label={ts("palette.triggerTitle", { hotkey: HOTKEY_LABEL })}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden min-w-0 flex-1 truncate text-left @[720px]:inline">{ts("palette.triggerLabel")}</span>
        <Kbd keys={[MOD, "K"]} className="hidden @[1180px]:inline-flex" />
      </button>
      {(mounted || open) && (
        <Suspense fallback={null}>
          <GlobalSearch open={open} onOpenChange={setOpen} request={request} triggerRef={triggerRef} />
        </Suspense>
      )}
    </>
  );
}
