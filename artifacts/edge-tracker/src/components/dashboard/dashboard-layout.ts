/**
 * Where the dashboard layout lives: the account (users.settings.dashboardLayout via PUT /api/users/me/settings), so it
 * follows the person across devices, plus a per-viewer localStorage copy for an instant first paint.
 *
 * - First paint: the local copy; with none yet, the v6 prefs of this browser are migrated once (./layout-model
 *   layoutFromV6), else the default.
 * - Then the server answers: its layout wins, unless the local copy holds an edit that was not saved yet (offline, a
 *   failed write) — that one is written up. No layout on the server + a migrated v6 layout here → written up once.
 * - Edits: memory + local copy at once, the server after a short pause (one write per burst of moves).
 * - «Сбросить»: the default layout and the stored block removed (PUT null), so a later default reaches this person too;
 *   the local copy keeps the default (the v6 prefs are never migrated again).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { http } from "@/lib/api/http";
import { defaultLayout, layoutFromV6, sameLayout, sanitizeLayout, type DashLayout } from "./layout-model";

const SETTINGS_API = "/api/users/me/settings";
const LOCAL_KEY = "ws_lexx_dashboard_layout_v1";
const V6_KEY = "ws_lexx_dashboard_prefs_v6";
const SAVE_DELAY_MS = 700;

type Local = { layout: DashLayout; pending: boolean };

function readLocal(viewer: string): Local | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY}:${viewer}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as { layout?: unknown; pending?: unknown };
    const layout = sanitizeLayout(p.layout);
    return layout ? { layout, pending: p.pending === true } : null;
  } catch {
    return null;
  }
}

function writeLocal(viewer: string, value: Local | null) {
  try {
    if (value) localStorage.setItem(`${LOCAL_KEY}:${viewer}`, JSON.stringify(value));
    else localStorage.removeItem(`${LOCAL_KEY}:${viewer}`);
  } catch {
    /* storage unavailable: the layout lives in memory and on the server */
  }
}

/** The first paint for a viewer: the local copy → the v6 prefs (migrated, to be written up) → the default. */
export function initialLayout(viewer: string): Local {
  const local = readLocal(viewer);
  if (local) return local;
  try {
    const v6 = localStorage.getItem(`${V6_KEY}:${viewer}`);
    const migrated = v6 ? layoutFromV6(JSON.parse(v6)) : null;
    if (migrated) return { layout: migrated, pending: !sameLayout(migrated, defaultLayout()) };
  } catch {
    /* unreadable → default */
  }
  return { layout: defaultLayout(), pending: false };
}

/** Server value vs the local state → what to show and whether to write the local one up. */
export function reconcile(server: DashLayout | null, local: Local): { layout: DashLayout; push: boolean } {
  if (local.pending) return { layout: local.layout, push: true };
  return { layout: server ?? defaultLayout(), push: false };
}

async function put(layout: DashLayout | null) {
  await http.put(SETTINGS_API, { dashboardLayout: layout ? { ...layout, updatedAt: new Date().toISOString() } : null });
}

export type LayoutUpdate = DashLayout | ((cur: DashLayout) => DashLayout);

/** `member` = a signed-in non-guest (guests keep a local layout only). */
export function useDashboardLayout(viewerKey: string | null, member: boolean) {
  const viewer = viewerKey ?? "guest";
  const [state, setState] = useState<Local>(() => initialLayout(viewer));
  const stateRef = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);

  const flush = useCallback(
    (g: number) => {
      if (!member) return;
      const snapshot = stateRef.current;
      void put(snapshot.layout)
        .then(() => {
          if (g !== gen.current || stateRef.current !== snapshot) return; // newer edits will write themselves
          const saved = { layout: snapshot.layout, pending: false };
          stateRef.current = saved;
          setState(saved);
          writeLocal(viewer, saved);
        })
        .catch(() => undefined); // stays pending: the next edit or visit retries
    },
    [member, viewer],
  );

  // Viewer changed (login / logout) or first mount → local first, then the server.
  useEffect(() => {
    const g = ++gen.current;
    const local = initialLayout(viewer);
    setState(local);
    stateRef.current = local;
    if (!member) return;
    void http
      .get<{ settings?: { dashboardLayout?: unknown } } | null>(SETTINGS_API)
      .then((r) => {
        if (g !== gen.current) return;
        const server = sanitizeLayout(r?.settings?.dashboardLayout);
        const cur = stateRef.current;
        const next = reconcile(server, cur);
        const value = { layout: next.layout, pending: next.push };
        if (!sameLayout(value.layout, cur.layout) || value.pending !== cur.pending) {
          stateRef.current = value;
          setState(value);
        }
        writeLocal(viewer, value);
        if (next.push) flush(g);
      })
      .catch(() => undefined);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [viewer, member, flush]);

  const setLayout = useCallback(
    (update: LayoutUpdate) => {
      const cur = stateRef.current;
      const layout = typeof update === "function" ? update(cur.layout) : update;
      if (sameLayout(layout, cur.layout)) return;
      const value = { layout, pending: member };
      stateRef.current = value;
      setState(value);
      writeLocal(viewer, value);
      if (timer.current) clearTimeout(timer.current);
      const g = gen.current;
      timer.current = setTimeout(() => flush(g), SAVE_DELAY_MS);
    },
    [member, viewer, flush],
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const value = { layout: defaultLayout(), pending: false };
    stateRef.current = value;
    setState(value);
    writeLocal(viewer, value);
    if (member) void put(null).catch(() => undefined);
  }, [member, viewer]);

  return { layout: state.layout, setLayout, reset };
}
