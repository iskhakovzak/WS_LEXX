/**
 * Loading state of the options chain: ticker → one request (expirations + nearest chain), expiration chip → that
 * date's chain. Stale answers (a newer ticker / date was asked meanwhile) are dropped. The last ticker / date are
 * remembered and reloaded on mount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { calculatorI18n } from "@/i18n/ns/calculator";
import { fetchErrorMessage, usePersistedState } from "./lib";
import { chainOf, fetchChain, type ChainSourceId } from "./chainApi";
import type { ChainData, Expiration } from "./strategies";

export type ChainMeta = { symbol: string; name: string; price: number; changePct: number | null; source: ChainSourceId | null; delayMinutes: number | null };

export type OptionsChainState = {
  ticker: string;
  setTicker: (v: string) => void;
  expirations: Expiration[];
  selectedExp: string;
  meta: ChainMeta | null;
  chain: ChainData | null;
  loading: boolean;
  chainLoading: boolean;
  error: string | null;
  load: (sym?: string) => void;
  selectExp: (label: string) => void;
};

export function useOptionsChain(initialTicker?: string): OptionsChainState {
  const t = calculatorI18n.t;
  const [ticker, setTicker] = usePersistedState<string>("chain_ticker", "");
  const [selectedExp, setSelectedExp] = usePersistedState<string>("chain_exp", "");
  const [expirations, setExpirations] = useState<Expiration[]>([]);
  const [meta, setMeta] = useState<ChainMeta | null>(null);
  const [chain, setChain] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(false);
  const [chainLoading, setChainLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const loadDate = useCallback(async (sym: string, exp: string) => {
    const id = ++req.current;
    setChainLoading(true); setError(null);
    try {
      const r = await fetchChain(sym, exp);
      if (id !== req.current) return;
      const c = chainOf(r);
      if (r.sourceUnavailable || !c) throw new Error(t("errors.sourceDown"));
      if (!(c.spot > 0)) throw new Error(t("advisor.noSpot"));
      setChain(c);
      setMeta({ symbol: r.symbol, name: r.name, price: r.spot, changePct: r.changePct, source: r.source, delayMinutes: r.delayMinutes ?? null });
    } catch (e: unknown) {
      if (id !== req.current) return;
      setChain(null);
      setError(fetchErrorMessage(e, e instanceof Error && e.message ? e.message : t("advisor.chainLoadError")));
    } finally {
      if (id === req.current) setChainLoading(false);
    }
  }, [t]);

  const loadSymbol = useCallback(async (raw: string, preferredExp: string) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    const id = ++req.current;
    setLoading(true); setChainLoading(false); setError(null); setChain(null); setExpirations([]);
    try {
      const r = await fetchChain(sym, null);
      if (id !== req.current) return;
      if (r.sourceUnavailable) { setMeta(null); setError(t("errors.sourceDown")); return; }
      const exps = Array.isArray(r.expirations) ? r.expirations : [];
      setExpirations(exps);
      setMeta({ symbol: r.symbol, name: r.name, price: r.spot, changePct: r.changePct, source: r.source, delayMinutes: r.delayMinutes ?? null });
      if (exps.length === 0) { setError(t("advisor.noExpirations")); return; }
      const nearest = chainOf(r);
      const want = preferredExp && exps.some((e) => e.label === preferredExp) ? preferredExp : exps[0].label;
      setSelectedExp(want);
      if (nearest && (r.expiration ?? exps[0].label) === want) setChain(nearest);
      else void loadDate(sym, want);
    } catch (e: unknown) {
      if (id !== req.current) return;
      setMeta(null);
      setError(fetchErrorMessage(e, t("advisor.loadError")));
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, [loadDate, setSelectedExp, t]);

  // ?ticker= wins over the remembered one; either loads once on mount (never on every keystroke).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const sym = initialTicker?.trim() ? initialTicker.trim().toUpperCase() : ticker;
    if (sym !== ticker) setTicker(sym);
    if (sym.trim()) void loadSymbol(sym, initialTicker ? "" : selectedExp);
  }, [initialTicker, ticker, selectedExp, setTicker, loadSymbol]);

  const load = useCallback((sym?: string) => {
    const s = (sym ?? ticker).trim().toUpperCase();
    if (sym !== undefined) setTicker(s);
    // A new ticker starts from its nearest date; reloading the same ticker keeps the chosen one.
    void loadSymbol(s, meta?.symbol === s ? selectedExp : "");
  }, [ticker, setTicker, loadSymbol, meta, selectedExp]);

  const selectExp = useCallback((label: string) => {
    setSelectedExp(label);
    if (meta?.symbol) void loadDate(meta.symbol, label);
  }, [meta, loadDate, setSelectedExp]);

  return { ticker, setTicker, expirations, selectedExp, meta, chain, loading, chainLoading, error, load, selectExp };
}
