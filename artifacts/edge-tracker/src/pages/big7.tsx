import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useListBig7Levels, useCreateBig7Level, useUpdateBig7Level, useDeleteBig7Level, getListBig7LevelsQueryKey } from "@workspace/api-client-react";
import type { Big7Level } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus, Pencil, Trash2, Check, X, Settings, TrendingUp, TrendingDown,
  ChevronDown, ChevronUp, Flame, Zap, Target, Shield, BarChart3,
  AlertTriangle, Calendar, DollarSign, Activity, Eye, Calculator,
  StickyNote, Star, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { WriteOnly } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");
const TODAY = new Date().toISOString().substring(0, 10);

const DEFAULT_TICKERS = [
  { symbol: "AAPL", exchange: "NASDAQ", name: "Apple" },
  { symbol: "MSFT", exchange: "NASDAQ", name: "Microsoft" },
  { symbol: "NVDA", exchange: "NASDAQ", name: "NVIDIA" },
  { symbol: "AMZN", exchange: "NASDAQ", name: "Amazon" },
  { symbol: "GOOGL", exchange: "NASDAQ", name: "Alphabet" },
  { symbol: "META", exchange: "NASDAQ", name: "Meta" },
  { symbol: "TSLA", exchange: "NASDAQ", name: "Tesla" },
];

const BIAS_OPTIONS = [
  { value: "bullish", label: "▲ Bull", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40", icon: TrendingUp },
  { value: "bearish", label: "▼ Bear", color: "bg-red-500/20 text-red-400 border-red-500/40", icon: TrendingDown },
  { value: "neutral", label: "● Flat", color: "bg-muted text-muted-foreground border-border", icon: Activity },
  { value: "watching", label: "◎ Watch", color: "bg-amber-500/20 text-amber-400 border-amber-500/40", icon: Eye },
];

const CATALYST_TYPES = [
  { value: "earnings", label: "Earnings", icon: "📊", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  { value: "fomc", label: "FOMC/Fed", icon: "🏛️", color: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
  { value: "ex-div", label: "Ex-Dividend", icon: "💰", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  { value: "product", label: "Product Launch", icon: "🚀", color: "text-purple-400 bg-purple-500/10 border-purple-500/30" },
  { value: "sector", label: "Sector Event", icon: "📈", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30" },
  { value: "news", label: "News/Custom", icon: "📰", color: "text-orange-400 bg-orange-500/10 border-orange-500/30" },
];

const RS_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Very Weak", color: "text-red-500" },
  2: { label: "Weak", color: "text-red-400" },
  3: { label: "Neutral", color: "text-muted-foreground" },
  4: { label: "Strong", color: "text-emerald-400" },
  5: { label: "Very Strong", color: "text-emerald-500" },
};

const LABEL_COLORS: Record<string, string> = {
  support: "text-emerald-400",
  resistance: "text-red-400",
  pivot: "text-blue-400",
  vwap: "text-cyan-400",
  "pre-market high": "text-amber-400",
  "pre-market low": "text-orange-400",
  "ath": "text-purple-400",
  "atl": "text-pink-400",
  "gap fill": "text-lime-400",
  "open": "text-sky-400",
  "yesterday close": "text-zinc-400",
  "yesterday high": "text-amber-300",
  "yesterday low": "text-orange-300",
};

function labelColor(label: string) {
  return LABEL_COLORS[label.toLowerCase()] || "text-primary";
}

function ls(key: string, fallback: any = null) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key: string, value: any) {
  localStorage.setItem(key, JSON.stringify(value));
}

const DEFAULT_DAY = {
  bias: "", notes: "", inPlay: false, rs: 0, gapPct: "", atr: "",
  sessionScore: 0, sessionNotes: "", openPrice: "", prevClose: "",
};
function getTickerDay(ticker: string) {
  return ls(`big7_day_${ticker}_${TODAY}`, DEFAULT_DAY);
}
function saveTickerDay(ticker: string, data: any) {
  lsSet(`big7_day_${ticker}_${TODAY}`, data);
}
function updateTickerDayField(ticker: string, key: string, val: any) {
  const current = getTickerDay(ticker);
  const next = { ...current, [key]: val };
  saveTickerDay(ticker, next);
  return next;
}
function getMarketContext() {
  return ls(`big7_market_${TODAY}`, {
    spyBias: "", qqBias: "", vixLevel: "", marketNotes: "", gapDirection: "",
  });
}
function saveMarketContext(ctx: any) {
  lsSet(`big7_market_${TODAY}`, ctx);
}
function getCustomTickers(): typeof DEFAULT_TICKERS {
  return ls("big7_custom_tickers", DEFAULT_TICKERS);
}
function saveCustomTickers(tickers: typeof DEFAULT_TICKERS) {
  lsSet("big7_custom_tickers", tickers);
}
function getTickerStats(ticker: string) {
  return ls(`big7_stats_${ticker}`, { atr: "", avgVol: "", float: "", shortInt: "", sector: "" });
}
function saveTickerStats(ticker: string, stats: any) {
  lsSet(`big7_stats_${ticker}`, stats);
}

type Catalyst = {
  id: number;
  ticker: string;
  date: string;
  type: string;
  description: string | null;
  impact: string;
};

function TradingViewMiniChart({ symbol, exchange, theme: colorTheme }: { symbol: string; exchange: string; theme: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [[`${exchange}:${symbol}|1D`]],
      chartOnly: false, width: "100%", height: "100%", locale: "en",
      colorTheme, autosize: true, showVolume: true, showMA: true,
      hideDateRanges: true, hideMarketStatus: false, hideSymbolLogo: false,
      scalePosition: "right", scaleMode: "Normal", fontFamily: "monospace",
      fontSize: "10", noTimeScale: false, valuesTracking: "1",
      changeMode: "price-and-percent", chartType: "candlesticks",
      lineWidth: 2, lineType: 0,
      dateRanges: ["1d|1", "5d|5", "1m|30", "3m|60", "12m|1D", "60m|1W"],
      isTransparent: true,
    });
    containerRef.current.appendChild(script);
  }, [symbol, exchange, colorTheme]);
  return (
    <div className="tradingview-widget-container" style={{ height: 220 }}>
      <div ref={containerRef} style={{ height: "100%" }} />
    </div>
  );
}

function MarketContextBar() {
  const [ctx, setCtx] = useState(getMarketContext);
  const [expanded, setExpanded] = useState(false);
  const update = (key: string, val: string) => {
    const next = { ...ctx, [key]: val };
    setCtx(next);
    saveMarketContext(next);
  };
  const spyBias = BIAS_OPTIONS.find(b => b.value === ctx.spyBias);
  const qqBias = BIAS_OPTIONS.find(b => b.value === ctx.qqBias);

  return (
    <div className="bg-card border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Market Context</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">SPY:</span>
            <div className="flex gap-0.5">
              {BIAS_OPTIONS.map(opt => (
                <WriteOnly key={opt.value}>
                  <button
                    onClick={() => update("spyBias", ctx.spyBias === opt.value ? "" : opt.value)}
                    className={`px-1.5 py-0 text-[9px] font-mono border transition-colors ${ctx.spyBias === opt.value ? opt.color : "text-muted-foreground/50 border-transparent hover:border-border/50"}`}
                  >
                    {opt.label}
                  </button>
                </WriteOnly>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">QQQ:</span>
            <div className="flex gap-0.5">
              {BIAS_OPTIONS.map(opt => (
                <WriteOnly key={opt.value}>
                  <button
                    onClick={() => update("qqBias", ctx.qqBias === opt.value ? "" : opt.value)}
                    className={`px-1.5 py-0 text-[9px] font-mono border transition-colors ${ctx.qqBias === opt.value ? opt.color : "text-muted-foreground/50 border-transparent hover:border-border/50"}`}
                  >
                    {opt.label}
                  </button>
                </WriteOnly>
              ))}
            </div>
          </div>
          {ctx.vixLevel && (
            <span className={`text-[10px] font-mono ${Number(ctx.vixLevel) > 25 ? "text-red-400" : Number(ctx.vixLevel) > 18 ? "text-amber-400" : "text-emerald-400"}`}>
              VIX: {ctx.vixLevel}
            </span>
          )}
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {expanded && (
        <WriteOnly>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase">VIX Level</label>
              <Input value={ctx.vixLevel} onChange={e => update("vixLevel", e.target.value)} placeholder="18.5" className="h-6 text-[10px] font-mono bg-background rounded-none mt-0.5" />
            </div>
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase">Gap Direction</label>
              <div className="flex gap-1 mt-0.5">
                {["gap up", "flat", "gap down"].map(g => (
                  <button key={g} onClick={() => update("gapDirection", ctx.gapDirection === g ? "" : g)}
                    className={`px-2 py-0.5 text-[9px] font-mono border transition-colors ${ctx.gapDirection === g
                      ? g === "gap up" ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                        : g === "gap down" ? "text-red-400 border-red-500/40 bg-red-500/10"
                        : "text-muted-foreground border-border bg-muted/30"
                      : "text-muted-foreground/50 border-border/30 hover:border-border"}`}
                  >{g}</button>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-[9px] font-mono text-muted-foreground uppercase">Market Notes</label>
              <Input value={ctx.marketNotes} onChange={e => update("marketNotes", e.target.value)} placeholder="FOMC at 2pm, rotation into XLF, ES weak at 5200..." className="h-6 text-[10px] font-mono bg-background rounded-none mt-0.5" />
            </div>
          </div>
        </WriteOnly>
      )}
      {!expanded && ctx.marketNotes && (
        <div className="mt-1.5 text-[10px] font-mono text-muted-foreground/70 truncate">{ctx.marketNotes}</div>
      )}
    </div>
  );
}

function TickerStatsPanel({ ticker }: { ticker: string }) {
  const [stats, setStats] = useState(() => getTickerStats(ticker));
  const [editing, setEditing] = useState(false);
  const update = (key: string, val: string) => {
    const next = { ...stats, [key]: val };
    setStats(next);
    saveTickerStats(ticker, next);
  };

  if (!stats.atr && !stats.avgVol && !editing) {
    return (
      <WriteOnly>
        <button onClick={() => setEditing(true)} className="text-[9px] font-mono text-muted-foreground/40 hover:text-muted-foreground px-3 py-1 flex items-center gap-1">
          <BarChart3 className="h-2.5 w-2.5" /> Добавить ATR, объем...
        </button>
      </WriteOnly>
    );
  }

  return (
    <div className="px-3 py-1.5 border-t border-border/30">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Статистика</span>
        <WriteOnly>
          <button onClick={() => setEditing(!editing)} className="text-muted-foreground/50 hover:text-foreground">
            <Pencil className="h-2.5 w-2.5" />
          </button>
        </WriteOnly>
      </div>
      {editing ? (
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[8px] font-mono text-muted-foreground">ATR (14d)</label>
            <Input value={stats.atr} onChange={e => update("atr", e.target.value)} placeholder="3.50" className="h-5 text-[10px] font-mono bg-background rounded-none" />
          </div>
          <div>
            <label className="text-[8px] font-mono text-muted-foreground">Avg Vol (M)</label>
            <Input value={stats.avgVol} onChange={e => update("avgVol", e.target.value)} placeholder="45M" className="h-5 text-[10px] font-mono bg-background rounded-none" />
          </div>
          <div>
            <label className="text-[8px] font-mono text-muted-foreground">Float (B)</label>
            <Input value={stats.float} onChange={e => update("float", e.target.value)} placeholder="15.2B" className="h-5 text-[10px] font-mono bg-background rounded-none" />
          </div>
          <div>
            <label className="text-[8px] font-mono text-muted-foreground">Short %</label>
            <Input value={stats.shortInt} onChange={e => update("shortInt", e.target.value)} placeholder="1.2%" className="h-5 text-[10px] font-mono bg-background rounded-none" />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono">
          {stats.atr && <span className="text-foreground">ATR <span className="text-primary font-bold">${stats.atr}</span></span>}
          {stats.avgVol && <span className="text-foreground">Vol <span className="text-cyan-400 font-bold">{stats.avgVol}</span></span>}
          {stats.float && <span className="text-foreground">Float <span className="text-muted-foreground">{stats.float}</span></span>}
          {stats.shortInt && <span className="text-foreground">SI <span className="text-amber-400">{stats.shortInt}</span></span>}
        </div>
      )}
    </div>
  );
}

function RelativeStrengthBar({ ticker }: { ticker: string }) {
  const [day, setDay] = useState(() => getTickerDay(ticker));

  const setRS = (rs: number) => {
    const newVal = day.rs === rs ? 0 : rs;
    const next = updateTickerDayField(ticker, "rs", newVal);
    setDay(next);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest shrink-0">RS vs SPY</span>
      <WriteOnly>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => setRS(n)}
              className={`w-5 h-4 text-[8px] font-mono font-bold border transition-colors ${
                n <= day.rs
                  ? n <= 2 ? "bg-red-500/20 text-red-400 border-red-500/40"
                    : n === 3 ? "bg-muted text-foreground border-border"
                    : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  : "text-muted-foreground/30 border-border/30 hover:border-border"
              }`}
            >{n}</button>
          ))}
        </div>
      </WriteOnly>
      {day.rs > 0 && (
        <span className={`text-[9px] font-mono ${RS_LABELS[day.rs]?.color || ""}`}>
          {RS_LABELS[day.rs]?.label}
        </span>
      )}
    </div>
  );
}

function GapAndRangePanel({ ticker }: { ticker: string }) {
  const [day, setDay] = useState(() => getTickerDay(ticker));
  const [editing, setEditing] = useState(false);
  const stats = getTickerStats(ticker);

  const update = (key: string, val: string) => {
    const next = updateTickerDayField(ticker, key, val);
    setDay(next);
  };

  const gapPct = day.gapPct ? parseFloat(day.gapPct) : null;
  const atr = stats.atr ? parseFloat(stats.atr) : null;
  const openPrice = day.openPrice ? parseFloat(day.openPrice) : null;
  const expectedHigh = openPrice && atr ? (openPrice + atr * 0.5).toFixed(2) : null;
  const expectedLow = openPrice && atr ? (openPrice - atr * 0.5).toFixed(2) : null;

  if (!day.gapPct && !day.openPrice && !editing) return null;

  return (
    <div className="px-3 py-1.5 border-t border-border/30">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Gap & Range</span>
        <WriteOnly>
          <button onClick={() => setEditing(!editing)} className="text-muted-foreground/50 hover:text-foreground">
            <Pencil className="h-2.5 w-2.5" />
          </button>
        </WriteOnly>
      </div>
      {editing ? (
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className="text-[8px] font-mono text-muted-foreground">Gap %</label>
            <Input value={day.gapPct} onChange={e => update("gapPct", e.target.value)} placeholder="+1.5" className="h-5 text-[10px] font-mono bg-background rounded-none" />
          </div>
          <div>
            <label className="text-[8px] font-mono text-muted-foreground">Open</label>
            <Input value={day.openPrice} onChange={e => update("openPrice", e.target.value)} placeholder="185.20" className="h-5 text-[10px] font-mono bg-background rounded-none" />
          </div>
          <div>
            <label className="text-[8px] font-mono text-muted-foreground">Prev Close</label>
            <Input value={day.prevClose} onChange={e => update("prevClose", e.target.value)} placeholder="183.50" className="h-5 text-[10px] font-mono bg-background rounded-none" />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono">
          {gapPct !== null && (
            <span className={gapPct > 0 ? "text-emerald-400" : gapPct < 0 ? "text-red-400" : "text-muted-foreground"}>
              Gap {gapPct > 0 ? "+" : ""}{day.gapPct}%
            </span>
          )}
          {day.openPrice && <span>Open <span className="text-foreground font-bold">${day.openPrice}</span></span>}
          {expectedHigh && expectedLow && (
            <span className="text-muted-foreground">
              Expected <span className="text-emerald-400/70">${expectedLow}</span>–<span className="text-red-400/70">${expectedHigh}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CatalystBadges({ ticker, catalysts }: { ticker: string; catalysts: Catalyst[] }) {
  const mine = catalysts.filter(c => c.ticker === ticker);
  if (mine.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-3 py-1">
      {mine.map(c => {
        const catType = CATALYST_TYPES.find(t => t.value === c.type);
        const isUpcoming = c.date >= TODAY;
        return (
          <span key={c.id} title={c.description || ""} className={`inline-flex items-center gap-0.5 px-1.5 py-0 text-[9px] font-mono border ${catType?.color || "text-muted-foreground border-border"} ${!isUpcoming ? "opacity-40" : ""}`}>
            {catType?.icon} {c.date.substring(5)} {c.description ? `· ${c.description.substring(0, 20)}` : ""}
            {c.impact === "high" && <Flame className="h-2.5 w-2.5 text-red-400" />}
          </span>
        );
      })}
    </div>
  );
}

function PositionCalc({ ticker }: { ticker: string }) {
  const [open, setOpen] = useState(false);
  const [accountRisk, setAccountRisk] = useState(() => ls("big7_account_risk", "500"));
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");

  const risk = parseFloat(accountRisk) || 0;
  const entry = parseFloat(entryPrice) || 0;
  const stop = parseFloat(stopPrice) || 0;
  const riskPerShare = Math.abs(entry - stop);
  const shares = riskPerShare > 0 ? Math.floor(risk / riskPerShare) : 0;
  const positionValue = shares * entry;

  const saveRisk = (v: string) => {
    setAccountRisk(v);
    lsSet("big7_account_risk", v);
  };

  if (!open) {
    return (
      <WriteOnly>
        <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40 hover:text-muted-foreground px-3 py-0.5">
          <Calculator className="h-2.5 w-2.5" /> Position Calc
        </button>
      </WriteOnly>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-border/30 bg-muted/20">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Position Calculator</span>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div>
          <label className="text-[8px] font-mono text-muted-foreground">Risk $</label>
          <Input value={accountRisk} onChange={e => saveRisk(e.target.value)} className="h-5 text-[10px] font-mono bg-background rounded-none" />
        </div>
        <div>
          <label className="text-[8px] font-mono text-muted-foreground">Entry</label>
          <Input value={entryPrice} onChange={e => setEntryPrice(e.target.value)} placeholder="185.50" className="h-5 text-[10px] font-mono bg-background rounded-none" />
        </div>
        <div>
          <label className="text-[8px] font-mono text-muted-foreground">Stop</label>
          <Input value={stopPrice} onChange={e => setStopPrice(e.target.value)} placeholder="184.00" className="h-5 text-[10px] font-mono bg-background rounded-none" />
        </div>
      </div>
      {shares > 0 && (
        <div className="flex gap-3 text-[10px] font-mono">
          <span>Shares: <span className="text-primary font-bold">{shares}</span></span>
          <span>Risk/sh: <span className="text-red-400">${riskPerShare.toFixed(2)}</span></span>
          <span>Size: <span className="text-foreground">${positionValue.toLocaleString()}</span></span>
        </div>
      )}
    </div>
  );
}

function SessionScorecard({ ticker }: { ticker: string }) {
  const [day, setDay] = useState(() => getTickerDay(ticker));
  const [open, setOpen] = useState(false);

  const update = (key: string, val: any) => {
    const next = updateTickerDayField(ticker, key, val);
    setDay(next);
  };

  const score = day.sessionScore || 0;

  if (!open && !score) {
    return (
      <WriteOnly>
        <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40 hover:text-muted-foreground px-3 py-0.5">
          <Star className="h-2.5 w-2.5" /> Session Review
        </button>
      </WriteOnly>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-border/30">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Session Score</span>
        {open && <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><ChevronUp className="h-3 w-3" /></button>}
        {!open && score > 0 && (
          <button onClick={() => setOpen(true)} className="flex items-center gap-1">
            <div className="flex gap-0.5">
              {[1,2,3,4,5].map(n => (
                <Star key={n} className={`h-2.5 w-2.5 ${n <= score ? "text-amber-400 fill-amber-400" : "text-muted-foreground/20"}`} />
              ))}
            </div>
          </button>
        )}
      </div>
      {(open || (!open && score > 0 && day.sessionNotes)) && (
        <>
          <WriteOnly>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-mono text-muted-foreground">Rate:</span>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => update("sessionScore", score === n ? 0 : n)}>
                  <Star className={`h-3.5 w-3.5 transition-colors ${n <= score ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30 hover:text-amber-400/50"}`} />
                </button>
              ))}
              {score > 0 && <span className="text-[9px] font-mono text-muted-foreground ml-1">{score}/5</span>}
            </div>
          </WriteOnly>
          {open && (
            <WriteOnly>
              <textarea
                value={day.sessionNotes || ""}
                onChange={e => update("sessionNotes", e.target.value)}
                placeholder="Что сработало? Где ошибся? Как торговался тикер сегодня..."
                rows={2}
                className="w-full bg-background border border-border text-[10px] font-mono p-1.5 resize-none focus:outline-none focus:border-primary/50"
              />
            </WriteOnly>
          )}
          {!open && day.sessionNotes && (
            <div className="text-[10px] font-mono text-muted-foreground/60 line-clamp-1">{day.sessionNotes}</div>
          )}
        </>
      )}
    </div>
  );
}

interface LevelForm { label: string; price: string; notes: string; action: string; }

function KeyLevelsPanel({ ticker }: { ticker: string }) {
  const queryClient = useQueryClient();
  const { data: allLevels = [] } = useListBig7Levels();
  const createMutation = useCreateBig7Level();
  const updateMutation = useUpdateBig7Level();
  const deleteMutation = useDeleteBig7Level();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LevelForm>({ label: "support", price: "", notes: "", action: "" });

  const levels = (allLevels as Big7Level[]).filter(l => l.ticker === ticker).sort((a, b) => Number(b.price) - Number(a.price));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBig7LevelsQueryKey() });

  const handleAdd = async () => {
    if (!form.price) return;
    const combinedNotes = form.action ? `[${form.action}] ${form.notes}` : form.notes;
    await createMutation.mutateAsync({ data: { ticker, label: form.label, price: Number(form.price), notes: combinedNotes || null } });
    invalidate();
    setAdding(false);
    setForm({ label: "support", price: "", notes: "", action: "" });
  };

  const handleUpdate = async (id: number) => {
    const combinedNotes = form.action ? `[${form.action}] ${form.notes}` : form.notes;
    await updateMutation.mutateAsync({ id, data: { label: form.label, price: Number(form.price), notes: combinedNotes || null } });
    invalidate();
    setEditingId(null);
    setForm({ label: "support", price: "", notes: "", action: "" });
  };

  const cancelEdit = () => { setEditingId(null); setAdding(false); setForm({ label: "support", price: "", notes: "", action: "" }); };

  const startEdit = (level: Big7Level) => {
    const notesStr = level.notes || "";
    const actionMatch = notesStr.match(/^\[([^\]]+)\]\s*/);
    const action = actionMatch ? actionMatch[1] : "";
    const cleanNotes = actionMatch ? notesStr.replace(actionMatch[0], "") : notesStr;
    setEditingId(level.id);
    setForm({ label: level.label, price: String(level.price), notes: cleanNotes, action });
    setAdding(false);
  };

  const LEVEL_LABELS = ["support", "resistance", "pivot", "vwap", "pre-market high", "pre-market low", "ath", "gap fill", "open", "yesterday close", "yesterday high", "yesterday low"];
  const ACTION_OPTIONS = ["buy", "sell", "watch", "add size", "trim", "breakout long", "breakdown short", "fade"];

  const rowForm = (onSave: () => void) => (
    <div className="space-y-1 py-1">
      <div className="flex items-center gap-1">
        <select value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          className="h-6 bg-background border border-border text-[10px] font-mono px-1 focus:outline-none focus:border-primary/50 w-28">
          {LEVEL_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
          placeholder="Price" className="h-6 w-20 bg-background border border-border text-[10px] font-mono px-1.5 focus:outline-none focus:border-primary/50" />
        <select value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
          className="h-6 bg-background border border-border text-[10px] font-mono px-1 focus:outline-none focus:border-primary/50 w-24">
          <option value="">Action...</option>
          {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Notes: why this level matters, plan..." className="h-6 flex-1 bg-background border border-border text-[10px] font-mono px-1.5 focus:outline-none focus:border-primary/50" />
        <button onClick={onSave} className="h-6 w-6 flex items-center justify-center text-emerald-500 hover:text-emerald-400"><Check className="h-3 w-3" /></button>
        <button onClick={cancelEdit} className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
      </div>
    </div>
  );

  return (
    <div className="space-y-0.5 px-3 pb-2">
      {levels.length === 0 && !adding && (
        <div className="text-[10px] text-muted-foreground/50 font-mono py-1">Нет уровней</div>
      )}
      {levels.map(level => {
        if (editingId === level.id) return <div key={level.id}>{rowForm(() => handleUpdate(level.id))}</div>;
        const notesStr = level.notes || "";
        const actionMatch = notesStr.match(/^\[([^\]]+)\]\s*/);
        const action = actionMatch ? actionMatch[1] : null;
        const cleanNotes = actionMatch ? notesStr.replace(actionMatch[0], "") : notesStr;
        return (
          <div key={level.id} className="flex items-center gap-2 group py-0.5 text-[11px] font-mono">
            <span className={`uppercase font-bold text-[9px] w-20 truncate ${labelColor(level.label)}`}>{level.label}</span>
            <span className="font-bold text-foreground tabular-nums">${Number(level.price).toFixed(2)}</span>
            {action && (
              <span className={`text-[8px] px-1 py-0 border ${
                action === "buy" || action === "breakout long" || action === "add size" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                : action === "sell" || action === "breakdown short" || action === "trim" ? "text-red-400 border-red-500/30 bg-red-500/10"
                : action === "fade" ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                : "text-blue-400 border-blue-500/30 bg-blue-500/10"
              }`}>{action}</span>
            )}
            {cleanNotes && <span className="text-muted-foreground truncate flex-1 text-[10px]">{cleanNotes}</span>}
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
              <WriteOnly>
                <button onClick={() => startEdit(level)} className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-primary"><Pencil className="h-2.5 w-2.5" /></button>
                <button onClick={() => { deleteMutation.mutateAsync({ id: level.id }).then(invalidate); }} className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-red-400"><Trash2 className="h-2.5 w-2.5" /></button>
              </WriteOnly>
            </div>
          </div>
        );
      })}
      {adding && rowForm(handleAdd)}
      <WriteOnly>
        <button onClick={() => { setAdding(true); setEditingId(null); setForm({ label: "support", price: "", notes: "", action: "" }); }}
          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors mt-1">
          <Plus className="h-3 w-3" /> Добавить уровень
        </button>
      </WriteOnly>
    </div>
  );
}

function PremarketPlanPanel({ ticker }: { ticker: string }) {
  const [day, setDay] = useState(() => getTickerDay(ticker));
  const [notesOpen, setNotesOpen] = useState(false);

  const updateField = (key: string, val: any) => {
    const next = updateTickerDayField(ticker, key, val);
    setDay(next);
  };

  const currentBias = BIAS_OPTIONS.find(b => b.value === day.bias);

  return (
    <div className="border-t border-border/40 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Premarket Plan</span>
          {day.inPlay && (
            <span className="text-[8px] font-mono font-bold px-1.5 py-0 bg-primary/20 text-primary border border-primary/40 animate-pulse">
              IN PLAY
            </span>
          )}
        </div>
        <WriteOnly>
          <button
            onClick={() => updateField("inPlay", !day.inPlay)}
            title={day.inPlay ? "Убрать из In Play" : "Пометить In Play"}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono border transition-colors ${
              day.inPlay ? "text-primary border-primary/40 bg-primary/10" : "text-muted-foreground/40 border-border/30 hover:border-border hover:text-muted-foreground"
            }`}
          >
            <Flame className="h-2.5 w-2.5" />
            {day.inPlay ? "In Play" : "In Play?"}
          </button>
        </WriteOnly>
      </div>
      <div className="flex gap-1 flex-wrap">
        {BIAS_OPTIONS.map(opt => (
          <WriteOnly key={opt.value}>
            <button
              onClick={() => updateField("bias", day.bias === opt.value ? "" : opt.value)}
              className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${day.bias === opt.value ? opt.color : "text-muted-foreground border-border/50 hover:border-border"}`}
            >
              {opt.label}
            </button>
          </WriteOnly>
        ))}
      </div>
      <WriteOnly>
        <div className="mt-2">
          <button onClick={() => setNotesOpen(!notesOpen)}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors">
            {notesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {day.notes ? "Trade Plan" : "Добавить план"}
            {day.notes && !notesOpen && <span className="text-primary/60 truncate max-w-[120px]">· {day.notes.substring(0, 30)}{day.notes.length > 30 ? "…" : ""}</span>}
          </button>
          {notesOpen && (
            <textarea
              value={day.notes}
              onChange={e => updateField("notes", e.target.value)}
              placeholder={`Сценарий на ${ticker}:\n• Если выше $XXX → long, target $XXX\n• Если ниже $XXX → short, stop $XXX\n• Размер позиции, risk/reward...`}
              rows={4}
              className="w-full mt-1 bg-background border border-border text-[10px] font-mono p-2 resize-none focus:outline-none focus:border-primary/50"
            />
          )}
        </div>
      </WriteOnly>
      {day.notes && !notesOpen && (
        <div className="mt-1 text-[10px] font-mono text-muted-foreground/70 line-clamp-2 whitespace-pre-wrap">{day.notes}</div>
      )}
    </div>
  );
}

function CatalystManager({ catalysts, refetch }: { catalysts: Catalyst[]; refetch: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ticker: "", date: TODAY, type: "earnings", description: "", impact: "medium" });

  const addCatalyst = async () => {
    if (!form.ticker || !form.date) return;
    await fetch(`${BASE}/api/big7/catalysts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ ticker: "", date: TODAY, type: "earnings", description: "", impact: "medium" });
    refetch();
  };

  const deleteCatalyst = async (id: number) => {
    await fetch(`${BASE}/api/big7/catalysts/${id}`, { method: "DELETE" });
    refetch();
  };

  if (!open) {
    return (
      <WriteOnly>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="font-mono text-xs h-8 gap-1 rounded-none">
          <Calendar className="h-3 w-3" /> Catalysts
          {catalysts.filter(c => c.date >= TODAY).length > 0 && (
            <span className="bg-amber-500/20 text-amber-400 border border-amber-500/40 px-1 text-[9px]">
              {catalysts.filter(c => c.date >= TODAY).length}
            </span>
          )}
        </Button>
      </WriteOnly>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="bg-card border border-border w-full max-w-lg font-mono" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-bold uppercase tracking-tight">Catalyst Calendar</span>
          <button onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-2 max-h-60 overflow-y-auto">
          {catalysts.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">Нет катализаторов</div>}
          {catalysts.filter(c => c.date >= TODAY).map(c => {
            const catType = CATALYST_TYPES.find(t => t.value === c.type);
            return (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <span className="font-bold w-14">{c.ticker}</span>
                <span className="text-muted-foreground w-20">{c.date}</span>
                <span className={`px-1.5 py-0 border text-[9px] ${catType?.color || ""}`}>{catType?.icon} {catType?.label}</span>
                <span className="flex-1 truncate text-muted-foreground">{c.description}</span>
                {c.impact === "high" && <Flame className="h-3 w-3 text-red-400" />}
                <WriteOnly>
                  <button onClick={() => deleteCatalyst(c.id)} className="text-red-400 hover:text-red-300"><Trash2 className="h-3 w-3" /></button>
                </WriteOnly>
              </div>
            );
          })}
        </div>

        <WriteOnly>
          <div className="p-4 border-t border-border space-y-2">
            <div className="text-[9px] uppercase text-muted-foreground tracking-widest mb-1">Добавить катализатор</div>
            <div className="flex gap-1.5 flex-wrap">
              <Input value={form.ticker} onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                placeholder="AAPL" className="h-7 text-xs font-mono bg-background rounded-none w-16" />
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="h-7 text-xs font-mono bg-background rounded-none w-32" />
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="h-7 text-xs font-mono bg-background border border-border rounded-none px-1">
                {CATALYST_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
              <select value={form.impact} onChange={e => setForm(f => ({ ...f, impact: e.target.value }))}
                className="h-7 text-xs font-mono bg-background border border-border rounded-none px-1">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High 🔥</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Q4 earnings, after hours, est $2.15 EPS..." className="h-7 text-xs font-mono bg-background rounded-none flex-1" />
              <Button onClick={addCatalyst} size="sm" className="h-7 text-xs font-mono rounded-none px-3">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
          </div>
        </WriteOnly>
      </div>
    </div>
  );
}

function TickerSettingsModal({ tickers, onSave, onClose }: {
  tickers: typeof DEFAULT_TICKERS;
  onSave: (t: typeof DEFAULT_TICKERS) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState(tickers.map(t => ({ ...t })));
  const [newSymbol, setNewSymbol] = useState("");
  const [newExchange, setNewExchange] = useState("NASDAQ");
  const [newName, setNewName] = useState("");

  const add = () => {
    if (!newSymbol.trim()) return;
    setList(prev => [...prev, { symbol: newSymbol.trim().toUpperCase(), exchange: newExchange || "NASDAQ", name: newName || newSymbol.trim().toUpperCase() }]);
    setNewSymbol(""); setNewName("");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-card border border-border w-full max-w-md font-mono">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-bold uppercase tracking-tight">Настройки тикеров</span>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {list.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="font-bold w-16">{t.symbol}</span>
              <span className="text-muted-foreground flex-1">{t.name}</span>
              <button onClick={() => setList(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-border space-y-2">
          <div className="flex gap-2">
            <Input value={newSymbol} onChange={e => setNewSymbol(e.target.value.toUpperCase())} placeholder="Тикер" className="h-7 text-xs font-mono bg-background rounded-none w-24" />
            <Input value={newExchange} onChange={e => setNewExchange(e.target.value.toUpperCase())} placeholder="Биржа" className="h-7 text-xs font-mono bg-background rounded-none w-24" />
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Название" className="h-7 text-xs font-mono bg-background rounded-none flex-1" />
            <Button onClick={add} size="sm" className="h-7 text-xs font-mono rounded-none px-2"><Plus className="h-3 w-3" /></Button>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} className="h-7 text-xs font-mono rounded-none uppercase">Отмена</Button>
            <Button onClick={() => { onSave(list); onClose(); }} className="h-7 text-xs font-mono rounded-none uppercase">Сохранить</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

type StockQuote = {
  price: number | null;
  change: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  avgVolume: number | null;
  relativeVolume: number | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  high52w: number | null;
  low52w: number | null;
  marketCap: number | null;
  name: string;
  gapPct: number | null;
  atr: number | null;
};

function LiveDataBadge({ quote }: { quote?: StockQuote }) {
  if (!quote?.price) return null;
  const ch = quote.change ?? 0;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-bold text-sm font-mono">${quote.price.toFixed(2)}</span>
      <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${ch >= 0 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
        {ch >= 0 ? "+" : ""}{ch.toFixed(2)}%
      </span>
      {quote.gapPct != null && Math.abs(quote.gapPct) > 0.1 && (
        <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${quote.gapPct >= 0 ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-orange-400 border-orange-500/30 bg-orange-500/10"}`}>
          GAP {quote.gapPct > 0 ? "+" : ""}{quote.gapPct.toFixed(1)}%
        </span>
      )}
      {quote.relativeVolume != null && (
        <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${quote.relativeVolume >= 1.5 ? "text-primary border-primary/30 bg-primary/10" : "text-muted-foreground border-border"}`}>
          RVOL {quote.relativeVolume.toFixed(1)}x
        </span>
      )}
      {quote.preMarketPrice != null && (
        <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${(quote.preMarketChange ?? 0) >= 0 ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-orange-400 border-orange-500/30 bg-orange-500/10"}`}>
          PM ${quote.preMarketPrice.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function LiveDataPanel({ quote }: { quote?: StockQuote }) {
  if (!quote?.price) return null;
  return (
    <div className="border border-primary/20 bg-primary/5 p-2 space-y-1">
      <div className="flex items-center gap-1.5 mb-1">
        <Activity className="h-3 w-3 text-primary" />
        <span className="text-[10px] font-mono uppercase text-primary font-bold">Live Market Data</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px] font-mono">
        <div><span className="text-muted-foreground">Open:</span> <span className="text-foreground">${quote.open?.toFixed(2) ?? "—"}</span></div>
        <div><span className="text-muted-foreground">High:</span> <span className="text-foreground">${quote.high?.toFixed(2) ?? "—"}</span></div>
        <div><span className="text-muted-foreground">Low:</span> <span className="text-foreground">${quote.low?.toFixed(2) ?? "—"}</span></div>
        <div><span className="text-muted-foreground">Prev Close:</span> <span className="text-foreground">${quote.prevClose?.toFixed(2) ?? "—"}</span></div>
        <div><span className="text-muted-foreground">Volume:</span> <span className="text-foreground">{quote.volume ? (quote.volume / 1e6).toFixed(1) + "M" : "—"}</span></div>
        <div><span className="text-muted-foreground">Avg Vol:</span> <span className="text-foreground">{quote.avgVolume ? (quote.avgVolume / 1e6).toFixed(1) + "M" : "—"}</span></div>
        <div><span className="text-muted-foreground">ATR(14):</span> <span className="text-foreground">{quote.atr ? "$" + quote.atr.toFixed(2) : "—"}</span></div>
        <div><span className="text-muted-foreground">52w High:</span> <span className="text-foreground">${quote.high52w?.toFixed(2) ?? "—"}</span></div>
        <div><span className="text-muted-foreground">52w Low:</span> <span className="text-foreground">${quote.low52w?.toFixed(2) ?? "—"}</span></div>
      </div>
    </div>
  );
}

export default function Big7() {
  const { theme } = useTheme();
  const [tickers, setTickers] = useState(getCustomTickers);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedCharts, setExpandedCharts] = useState<Set<string>>(() => new Set(getCustomTickers().map(t => t.symbol)));
  const [viewMode, setViewMode] = useState<"full" | "compact">("full");
  const [filterInPlay, setFilterInPlay] = useState(false);

  const symbols = useMemo(() => tickers.map(t => t.symbol).join(","), [tickers]);
  const { data: liveQuotes = {} } = useQuery<Record<string, StockQuote>>({
    queryKey: ["stockdata-quote", symbols],
    queryFn: () => fetch(`${BASE}/api/stockdata/quote?symbols=${symbols}`).then(r => r.ok ? r.json() : {}),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const { data: catalysts = [], refetch: refetchCatalysts } = useQuery<Catalyst[]>({
    queryKey: ["big7-catalysts"],
    queryFn: () => fetch(`${BASE}/api/big7/catalysts`).then(r => r.json()),
    staleTime: 30_000,
  });

  const toggleChart = (symbol: string) => setExpandedCharts(prev => {
    const next = new Set(prev);
    if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
    return next;
  });

  const handleSaveTickers = (newTickers: typeof DEFAULT_TICKERS) => {
    setTickers(newTickers);
    saveCustomTickers(newTickers);
  };

  const dayData = useMemo(() => {
    const map: Record<string, any> = {};
    tickers.forEach(t => { map[t.symbol] = getTickerDay(t.symbol); });
    return map;
  }, [tickers]);

  const bullishCount = tickers.filter(t => dayData[t.symbol]?.bias === "bullish").length;
  const bearishCount = tickers.filter(t => dayData[t.symbol]?.bias === "bearish").length;
  const watchingCount = tickers.filter(t => dayData[t.symbol]?.bias === "watching").length;
  const inPlayCount = tickers.filter(t => dayData[t.symbol]?.inPlay).length;
  const upcomingCatalysts = catalysts.filter(c => c.date >= TODAY);

  const displayTickers = filterInPlay
    ? tickers.filter(t => dayData[t.symbol]?.inPlay)
    : tickers;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Радар</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {TODAY} · {tickers.length} тикеров
            {inPlayCount > 0 && <span className="text-primary ml-2">· {inPlayCount} in play</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-2 text-[10px] font-mono">
            {bullishCount > 0 && <span className="text-emerald-400">▲{bullishCount}</span>}
            {bearishCount > 0 && <span className="text-red-400">▼{bearishCount}</span>}
            {watchingCount > 0 && <span className="text-amber-400">◎{watchingCount}</span>}
            {inPlayCount > 0 && <span className="text-primary">🔥{inPlayCount}</span>}
          </div>
          <button
            onClick={() => setFilterInPlay(!filterInPlay)}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono border transition-colors ${
              filterInPlay ? "text-primary border-primary/40 bg-primary/10" : "text-muted-foreground border-border hover:border-foreground/30"
            }`}
          >
            <Flame className="h-3 w-3" /> In Play Only
          </button>
          <button
            onClick={() => setViewMode(viewMode === "full" ? "compact" : "full")}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border hover:border-foreground/30 transition-colors"
          >
            {viewMode === "full" ? "Compact" : "Full"}
          </button>
          <CatalystManager catalysts={catalysts} refetch={refetchCatalysts} />
          <WriteOnly>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="font-mono text-xs h-8 gap-1 rounded-none">
              <Settings className="h-3 w-3" /> Тикеры
            </Button>
          </WriteOnly>
        </div>
      </div>

      <MarketContextBar />

      {filterInPlay && displayTickers.length === 0 && (
        <div className="text-center py-12 text-muted-foreground font-mono text-sm">
          Нет тикеров в In Play. Пометьте тикеры кнопкой 🔥
        </div>
      )}

      <div className={`grid gap-3 ${
        viewMode === "compact"
          ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          : "grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3"
      }`}>
        {displayTickers.map(({ symbol, exchange, name }) => {
          const day = dayData[symbol] || {};
          const bias = BIAS_OPTIONS.find(b => b.value === day.bias);
          const chartOpen = expandedCharts.has(symbol);
          const isInPlay = day.inPlay;
          const tickerCatalysts = catalysts.filter(c => c.ticker === symbol && c.date >= TODAY);
          const quote = liveQuotes[symbol];

          return (
            <Card key={symbol} className={`bg-card rounded-none shadow-none overflow-hidden transition-colors ${
              isInPlay ? "border-primary/40 border-2" : "border-border"
            }`}>
              <CardHeader className="pb-0 pt-2 px-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono text-foreground">{symbol}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{name}</span>
                    {isInPlay && <Flame className="h-3 w-3 text-primary" />}
                    {tickerCatalysts.length > 0 && (
                      <span className="text-[8px] font-mono px-1 py-0 bg-amber-500/10 text-amber-400 border border-amber-500/30" title={tickerCatalysts.map(c => `${c.date}: ${c.type}`).join(", ")}>
                        {tickerCatalysts.length} catalyst{tickerCatalysts.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {day.rs > 0 && (
                      <span className={`text-[9px] font-mono font-bold ${RS_LABELS[day.rs]?.color || ""}`}>
                        RS:{day.rs}
                      </span>
                    )}
                    {bias && (
                      <span className={`px-1.5 py-0 text-[9px] font-mono border ${bias.color}`}>{bias.label}</span>
                    )}
                    <button onClick={() => toggleChart(symbol)}
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors">
                      {chartOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <LiveDataBadge quote={quote} />
              </CardHeader>
              <CardContent className="p-0">
                <CatalystBadges ticker={symbol} catalysts={catalysts} />
                <LiveDataPanel quote={quote} />
                {chartOpen && (
                  <TradingViewMiniChart symbol={symbol} exchange={exchange} theme={theme} />
                )}
                <TickerStatsPanel ticker={symbol} />
                <RelativeStrengthBar ticker={symbol} />
                <PremarketPlanPanel ticker={symbol} />
                {viewMode === "full" && <GapAndRangePanel ticker={symbol} />}
                <div className="border-t border-border/40 pt-1.5">
                  <div className="px-3 pb-1">
                    <span className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest">Ключевые уровни</span>
                  </div>
                  <KeyLevelsPanel ticker={symbol} />
                </div>
                {viewMode === "full" && <PositionCalc ticker={symbol} />}
                {viewMode === "full" && <SessionScorecard ticker={symbol} />}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {settingsOpen && (
        <TickerSettingsModal
          tickers={tickers}
          onSave={handleSaveTickers}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
