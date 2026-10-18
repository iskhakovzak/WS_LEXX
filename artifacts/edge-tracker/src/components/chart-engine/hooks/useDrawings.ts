/**
 * The viewer's drawings on a ticker-day: GET / PUT /api/chart/drawings?ticker=&date= (body { drawings }, replace-all).
 * Changes are shown at once and saved shortly after (debounced); while a drag is in progress nothing is saved until the
 * drop. A server without the route (404), a guest (403) or a signed-out viewer falls back to this browser's storage;
 * drawings left there from before are moved to the server the first time it answers.
 */
import * as React from "react";
import { http } from "@/lib/api/http";
import { apiErrorStatus } from "@/lib/api/errors";
import type { Drawing } from "../types";
import { MAX_DRAWINGS, loadDrawings, parseDrawingsResponse, saveDrawings, toApiDrawing } from "../lib/drawings";

const SAVE_DELAY_MS = 400;

export type DrawingsStore = {
  drawings: Drawing[];
  /** Apply a change; `save: false` = a live preview while dragging (saved on the next saving change). */
  update: (fn: (d: Drawing[]) => Drawing[], opts?: { save?: boolean }) => void;
  /** Where the drawings live: the server, or this browser only (the server has no drawings route / signed out). */
  source: "server" | "local";
  loading: boolean;
  saveFailed: boolean;
};

const url = (ticker: string, day: string) => `/api/chart/drawings?ticker=${encodeURIComponent(ticker.toUpperCase())}&date=${encodeURIComponent(day)}`;
const toLocal = (s: number | null) => s === 404 || s === 401 || s === 403;

export function useDrawings(ticker: string, day: string, enabled = true): DrawingsStore {
  const key = `${ticker.toUpperCase()}|${day}`;
  const [state, setState] = React.useState<{ key: string; list: Drawing[]; source: "server" | "local"; loading: boolean }>(
    () => ({ key, list: [], source: "server", loading: enabled }),
  );
  const [saveFailed, setSaveFailed] = React.useState(false);
  const sourceRef = React.useRef<"server" | "local">("server");
  const pending = React.useRef<{ timer: number | null; list: Drawing[] | null }>({ timer: null, list: null });

  React.useEffect(() => {
    if (!enabled || !ticker || !day) return;
    const ac = new AbortController();
    setState({ key, list: [], source: sourceRef.current, loading: true });
    http.get<unknown>(url(ticker, day), { signal: ac.signal })
      .then((body) => {
        sourceRef.current = "server";
        let list = parseDrawingsResponse(body);
        // Drawings made in this browser before the server kept them: move them up once (the local copy is then cleared).
        if (!list.length) { const local = loadDrawings(ticker, day); if (local.length) { list = local; flushRef.current(local); } }
        setState({ key, list, source: "server", loading: false });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        // No route on this server (or signed out): this browser keeps them. Any other error: show the local copy too.
        sourceRef.current = toLocal(apiErrorStatus(e)) ? "local" : sourceRef.current;
        setState({ key, list: loadDrawings(ticker, day), source: sourceRef.current, loading: false });
      });
    return () => ac.abort();
  }, [key, ticker, day, enabled]);

  const flush = React.useCallback((list: Drawing[]) => {
    if (sourceRef.current !== "server") { saveDrawings(ticker, day, list); return; }
    http.put<unknown>(url(ticker, day), { drawings: list.slice(0, MAX_DRAWINGS).map(toApiDrawing) })
      .then(() => { setSaveFailed(false); saveDrawings(ticker, day, []); })
      .catch((e: unknown) => {
        // No route / read-only viewer: keep them in this browser. Otherwise keep a browser copy until the next save works.
        saveDrawings(ticker, day, list);
        if (toLocal(apiErrorStatus(e))) { sourceRef.current = "local"; setState((s) => ({ ...s, source: "local" })); setSaveFailed(false); }
        else setSaveFailed(true);
      });
  }, [ticker, day]);
  const flushRef = React.useRef(flush);
  flushRef.current = flush;

  // Flush a pending save when the ticker-day changes or the chart unmounts.
  React.useEffect(() => () => {
    const p = pending.current;
    if (p.timer != null) { window.clearTimeout(p.timer); p.timer = null; if (p.list) flush(p.list); }
  }, [flush]);

  const update = React.useCallback((fn: (d: Drawing[]) => Drawing[], opts: { save?: boolean } = {}) => {
    setState((s) => {
      const list = fn(s.list).slice(0, MAX_DRAWINGS);
      if (opts.save !== false) {
        const p = pending.current;
        p.list = list;
        if (p.timer != null) window.clearTimeout(p.timer);
        p.timer = window.setTimeout(() => { p.timer = null; const l = p.list; p.list = null; if (l) flush(l); }, SAVE_DELAY_MS);
      }
      return { ...s, list };
    });
  }, [flush]);

  const current = state.key === key ? state : { key, list: [], source: state.source, loading: enabled };
  return { drawings: current.list, update, source: current.source, loading: current.loading, saveFailed };
}
