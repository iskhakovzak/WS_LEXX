/**
 * «Вид» state: the current look, saved looks («образы», ≤ 5), undo / redo, server sync and the open flag of the
 * dialog (the header theme button, the user menu and Settings → Внешний вид open it; components/layout hosts it).
 * Every change is applied at once as CSS variables on <html> (lib/appearance) and saved to the own profile after a
 * short pause. Personal: stored on the signed-in user's own row (GET / PUT /api/users/me/settings), never per desk.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { DEFAULT_APPEARANCE, MAX_LOOKS, type Appearance, type Look, type StoredAppearance } from "@/lib/appearance/model";
import { computeAppearanceVars, type ComputedAppearance } from "@/lib/appearance/vars";
import { applyComputedAppearance } from "@/lib/appearance/apply";
import { setBeRange } from "@/lib/appearance/be-range";
import { initHistory, pushHistory, redoHistory, undoHistory, type History } from "@/lib/appearance/history";
import { fetchStoredAppearance, readLocalStored, saveStoredAppearance, writeLocalStored } from "@/lib/appearance/api";

export type AppearanceTab = "themes" | "colors" | "money" | "chips" | "background" | "density";
export type SyncStatus = "idle" | "saving" | "saved" | "local" | "error";

interface AppearanceContextType {
  appearance: Appearance;
  computed: ComputedAppearance;
  looks: Look[];
  /** Apply a change (one undo step). */
  update: (fn: (a: Appearance) => Appearance) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: () => void;
  /** Saves the current look (theme included) under `name`; null when 5 looks already exist. */
  saveLook: (name: string) => Look | null;
  applyLook: (id: string) => void;
  deleteLook: (id: string) => void;
  open: boolean;
  tab: AppearanceTab;
  openAppearance: (tab?: AppearanceTab) => void;
  setOpen: (v: boolean) => void;
  setTab: (t: AppearanceTab) => void;
  status: SyncStatus;
}

const noop = () => {};
const AppearanceContext = createContext<AppearanceContextType>({
  appearance: DEFAULT_APPEARANCE,
  computed: { vars: {}, attrs: {}, report: {} },
  looks: [],
  update: noop, undo: noop, redo: noop, canUndo: false, canRedo: false, reset: noop,
  saveLook: () => null, applyLook: noop, deleteLook: noop,
  open: false, tab: "themes", openAppearance: noop, setOpen: noop, setTab: noop,
  status: "idle",
});

const SAVE_DELAY_MS = 700;

function newId(): string {
  return `look_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const member = user && user.role !== "guest" && user.traderName ? user.traderName : null;
  const [history, setHistory] = useState<History<Appearance>>(() => initHistory(member ? readLocalStored(member)?.current ?? DEFAULT_APPEARANCE : DEFAULT_APPEARANCE));
  const [looks, setLooks] = useState<Look[]>(() => (member ? readLocalStored(member)?.looks ?? [] : []));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AppearanceTab>("themes");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const appearance = history.present;
  // Edits since the last server load: the server answer must not overwrite them, and they trigger a save.
  const dirty = useRef(false);
  const loadedFor = useRef<string | null>(null);

  // Sign-in / account switch: local copy first, then the server (the source of truth). Sign-out: the default look.
  useEffect(() => {
    if (loadedFor.current === member) return;
    loadedFor.current = member;
    dirty.current = false;
    const local = member ? readLocalStored(member) : null;
    setHistory(initHistory(local?.current ?? DEFAULT_APPEARANCE));
    setLooks(local?.looks ?? []);
    if (!member) { setStatus(user?.role === "guest" ? "local" : "idle"); return; }
    let cancelled = false;
    fetchStoredAppearance()
      .then((stored) => {
        if (cancelled || dirty.current || loadedFor.current !== member) return;
        if (stored) {
          setHistory(initHistory(stored.current));
          setLooks(stored.looks);
          writeLocalStored(member, stored);
        }
        setStatus("saved");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [member, user?.role]);

  const computed = useMemo(() => computeAppearanceVars(appearance, theme), [appearance, theme]);
  useEffect(() => {
    applyComputedAppearance(computed, theme);
    setBeRange(appearance.money.beRange);
  }, [computed, theme, appearance.money.beRange]);

  // Save after a pause (members only; a guest's look lives in this browser through the CSS cache).
  useEffect(() => {
    if (!member || !dirty.current) return;
    const stored: StoredAppearance = { v: 1, current: appearance, looks };
    writeLocalStored(member, stored);
    setStatus("saving");
    const id = window.setTimeout(() => {
      saveStoredAppearance(stored)
        .then(() => { if (loadedFor.current === member) setStatus("saved"); })
        .catch(() => setStatus("error"));
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [appearance, looks, member]);

  const update = useCallback((fn: (a: Appearance) => Appearance) => {
    dirty.current = true;
    setHistory((h) => pushHistory(h, fn(h.present)));
  }, []);
  const undo = useCallback(() => { dirty.current = true; setHistory(undoHistory); }, []);
  const redo = useCallback(() => { dirty.current = true; setHistory(redoHistory); }, []);
  const reset = useCallback(() => update(() => ({ ...DEFAULT_APPEARANCE })), [update]);

  const saveLook = useCallback((name: string): Look | null => {
    if (looks.length >= MAX_LOOKS) return null;
    const look: Look = { id: newId(), name: name.trim().slice(0, 32), theme, settings: appearance };
    dirty.current = true;
    setLooks((l) => [...l, look].slice(0, MAX_LOOKS));
    return look;
  }, [looks.length, theme, appearance]);

  const applyLook = useCallback((id: string) => {
    const look = looks.find((l) => l.id === id);
    if (!look) return;
    if (look.theme !== theme) setTheme(look.theme);
    update(() => look.settings);
  }, [looks, theme, setTheme, update]);

  const deleteLook = useCallback((id: string) => {
    dirty.current = true;
    setLooks((l) => l.filter((x) => x.id !== id));
  }, []);

  const openAppearance = useCallback((t?: AppearanceTab) => {
    if (t) setTab(t);
    setOpen(true);
  }, []);

  const value = useMemo<AppearanceContextType>(() => ({
    appearance, computed, looks, update, undo, redo,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0, reset,
    saveLook, applyLook, deleteLook, open, tab, openAppearance, setOpen, setTab,
    status: member ? status : user?.role === "guest" ? "local" : status,
  }), [appearance, computed, looks, update, undo, redo, history.past.length, history.future.length, reset, saveLook, applyLook, deleteLook, open, tab, openAppearance, status, member, user?.role]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
