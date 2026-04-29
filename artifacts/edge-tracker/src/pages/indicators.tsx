import React, { useState, useMemo, useCallback } from "react";
import { useListTrades } from "@workspace/api-client-react";
import { INDICATORS, INDICATOR_CATEGORIES, type IndicatorCategory, type IndicatorDefinition } from "@/data/indicators";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Search, ChevronDown, ChevronUp, Target, AlertCircle, Clock, Zap, BarChart3, Star, StickyNote, TrendingUp, TrendingDown, Minus, Award, Lightbulb } from "lucide-react";

type TradeStats = {
  count: number;
  wins: number;
  winRate: number;
  avgR: number | null;
  totalPnl: number;
};

function loadFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("indicator-favorites") || "[]")); }
  catch { return new Set(); }
}
function saveFavorites(favs: Set<string>) {
  localStorage.setItem("indicator-favorites", JSON.stringify([...favs]));
}
function loadNotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("indicator-notes") || "{}"); }
  catch { return {}; }
}
function saveNotes(notes: Record<string, string>) {
  localStorage.setItem("indicator-notes", JSON.stringify(notes));
}

function useIndicatorStats(): Record<string, TradeStats> {
  const { data: trades = [] } = useListTrades();

  return useMemo(() => {
    const statsMap: Record<string, TradeStats> = {};

    const TAG_ALIASES: Record<string, string[]> = {
      "s/r": ["support", "resistance", "s/r"],
      "h&s": ["head and shoulders", "h&s"],
      "dt/db": ["double top", "double bottom", "dt", "db", "dt/db"],
    };

    const parsePhrases = (str: string): Set<string> => {
      const phrases = new Set<string>();
      str.toLowerCase().split(",").forEach((segment) => {
        const trimmed = segment.trim();
        if (trimmed) phrases.add(trimmed);
      });
      return phrases;
    };

    const parseTokens = (str: string): Set<string> => {
      const tokens = new Set<string>();
      str.toLowerCase().split(/[,;|\s]+/).forEach((tok) => {
        const trimmed = tok.trim();
        if (trimmed) tokens.add(trimmed);
      });
      return tokens;
    };

    const preparedTrades = trades.map((t) => ({
      trade: t,
      tagPhrases: parsePhrases(t.tags ?? ""),
      tagTokens: parseTokens(t.tags ?? ""),
      setupPhrases: parsePhrases(t.setup ?? ""),
      setupTokens: parseTokens(t.setup ?? ""),
    }));

    INDICATORS.forEach((ind) => {
      const expandedTags = new Set<string>();
      ind.tags.forEach((tag) => {
        expandedTags.add(tag);
        const aliases = TAG_ALIASES[tag];
        if (aliases) aliases.forEach((a) => expandedTags.add(a));
      });

      const multiWordTags = [...expandedTags].filter((t) => t.includes(" "));
      const singleWordTags = [...expandedTags].filter((t) => !t.includes(" "));

      const matchingTrades = preparedTrades.filter((pt) => {
        for (const tag of singleWordTags) {
          if (pt.tagTokens.has(tag) || pt.setupTokens.has(tag)) return true;
        }
        for (const tag of multiWordTags) {
          if (pt.tagPhrases.has(tag) || pt.setupPhrases.has(tag)) return true;
        }
        return false;
      });

      const wins = matchingTrades.filter((pt) => pt.trade.result === "win").length;
      const rValues = matchingTrades.filter((pt) => pt.trade.rMultiple != null).map((pt) => Number(pt.trade.rMultiple));
      const pnlValues = matchingTrades.filter((pt) => pt.trade.pnl != null).map((pt) => Number(pt.trade.pnl));

      statsMap[ind.id] = {
        count: matchingTrades.length,
        wins,
        winRate: matchingTrades.length > 0 ? Math.round((wins / matchingTrades.length) * 100) : 0,
        avgR: rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null,
        totalPnl: pnlValues.reduce((a, b) => a + b, 0),
      };
    });

    return statsMap;
  }, [trades]);
}

function SignalStrengthBar({ strength }: { strength: number }) {
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`w-3 h-1.5 ${i <= strength ? strength >= 4 ? "bg-emerald-400" : strength >= 3 ? "bg-primary" : "bg-yellow-400" : "bg-muted"}`} />
      ))}
    </div>
  );
}

function StatsBadge({ stats }: { stats: TradeStats }) {
  if (stats.count === 0) {
    return <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 border border-border">0 trades</span>;
  }

  return (
    <div className="flex gap-1.5 items-center flex-wrap">
      <span className="text-[10px] font-mono text-foreground px-2 py-0.5 border border-border bg-muted/30">
        {stats.count} trade{stats.count !== 1 ? "s" : ""}
      </span>
      <span className={`text-[10px] font-mono px-2 py-0.5 border ${stats.winRate >= 60 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : stats.winRate >= 40 ? "text-primary border-primary/30 bg-primary/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
        {stats.winRate}% WR
      </span>
      {stats.avgR != null && (
        <span className={`text-[10px] font-mono px-2 py-0.5 border ${stats.avgR >= 1 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : stats.avgR >= 0 ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
          {stats.avgR.toFixed(1)}R avg
        </span>
      )}
      {stats.totalPnl !== 0 && (
        <span className={`text-[10px] font-mono px-2 py-0.5 border ${stats.totalPnl > 0 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
          {stats.totalPnl > 0 ? "+" : ""}{stats.totalPnl.toFixed(0)}$
        </span>
      )}
    </div>
  );
}

const SIGNAL_CHEATSHEET: Record<string, { bullish: string; bearish: string; neutral: string }> = {
  rsi: { bullish: "RSI < 30 + разворот вверх", bearish: "RSI > 70 + разворот вниз", neutral: "RSI 40-60 — тренд неясен" },
  macd: { bullish: "MACD пересёк сигнальную вверх", bearish: "MACD пересёк сигнальную вниз", neutral: "Линии переплетены — без сигнала" },
  vwap: { bullish: "Цена выше VWAP + отскок", bearish: "Цена ниже VWAP + отскок", neutral: "Цена флиппит VWAP — не торговать" },
  ema: { bullish: "9 EMA > 21 EMA + цена выше", bearish: "9 EMA < 21 EMA + цена ниже", neutral: "EMA переплетены — чоп" },
  ma: { bullish: "Цена выше SMA50 + SMA20 растёт", bearish: "Цена ниже SMA50 + SMA20 падает", neutral: "Флэт — цена вокруг SMA" },
  bb: { bullish: "Касание нижней полосы + RSI < 30", bearish: "Касание верхней полосы + RSI > 70", neutral: "Squeeze — готовься к breakout" },
  volume: { bullish: "Объём растёт на росте цены", bearish: "Объём растёт на падении цены", neutral: "Объём ниже среднего — нет интереса" },
  atr: { bullish: "ATR расширяется — тренд набирает силу", bearish: "ATR расширяется на продажах", neutral: "ATR сужается — консолидация" },
  stochastic: { bullish: "%K < 20 + пересечение вверх", bearish: "%K > 80 + пересечение вниз", neutral: "Зона 40-60 — без сигнала" },
  obv: { bullish: "OBV растёт при росте цены", bearish: "OBV падает при росте цены (дивергенция!)", neutral: "OBV flat — нет давления" },
  volume_profile: { bullish: "Цена выше POC + VAH пробит", bearish: "Цена ниже POC + VAL пробит", neutral: "Внутри Value Area — ротация" },
  adl: { bullish: "ADL растёт — деньги входят", bearish: "ADL падает — деньги выходят", neutral: "ADL flat — нейтрально" },
  pivot: { bullish: "Цена выше Pivot + тест R1", bearish: "Цена ниже Pivot + тест S1", neutral: "На уровне Pivot — решение" },
  fib: { bullish: "Отскок от 61.8% + объём", bearish: "Отказ на 38.2% ретрейсменте", neutral: "Между уровнями — без сигнала" },
  hammer: { bullish: "Hammer на поддержке + объём", bearish: "Shooting Star на сопротивлении", neutral: "Doji — неопределённость" },
  engulfing: { bullish: "Бычье поглощение на LOD/поддержке", bearish: "Медвежье поглощение на HOD/сопроте", neutral: "Inside bar — ожидание" },
  flag: { bullish: "Bull Flag + пробой с объёмом", bearish: "Bear Flag + пробой вниз", neutral: "Флаг формируется — рано" },
  hs: { bullish: "Inverse H&S + пробой шеи", bearish: "H&S + пробой шеи вниз", neutral: "Формирование — ждать пробой" },
  triangle: { bullish: "Asc Triangle + пробой вверх", bearish: "Desc Triangle + пробой вниз", neutral: "Симметричный — ждать выход" },
  dt_db: { bullish: "Double Bottom + пробой шеи", bearish: "Double Top + пробой шеи вниз", neutral: "Формирование 2-й вершины/дна" },
  cup_handle: { bullish: "Cup & Handle + пробой ручки", bearish: "Inv Cup & Handle (редко)", neutral: "Ручка формируется — рано" },
  channel: { bullish: "Отскок от нижней границы канала", bearish: "Отскок от верхней границы канала", neutral: "Середина канала — без сигнала" },
  doji: { bullish: "Doji после нисходящего тренда", bearish: "Doji после восходящего тренда", neutral: "Doji в середине — неопределённость" },
  marubozu: { bullish: "Бычий марубозу — сильный спрос", bearish: "Медвежий марубозу — сильное предложение", neutral: "Маленькое тело — нерешительность" },
  inside_bar: { bullish: "Inside bar break вверх + тренд", bearish: "Inside bar break вниз + тренд", neutral: "Внутри бара — ожидание" },
};

const COMBO_SUGGESTIONS: Record<string, string[]> = {
  vwap: ["volume", "ema", "atr"],
  rsi: ["bb", "volume", "macd"],
  macd: ["rsi", "ema", "volume"],
  ema: ["vwap", "volume", "rsi"],
  bb: ["rsi", "atr", "volume"],
  volume: ["vwap", "obv", "atr"],
  atr: ["bb", "vwap", "volume"],
  pivot: ["vwap", "fib", "volume"],
  fib: ["pivot", "volume", "rsi"],
  flag: ["volume", "ema", "vwap"],
};

function PerformanceDashboard({ statsMap, favorites }: { statsMap: Record<string, TradeStats>; favorites: Set<string> }) {
  const topByUsage = useMemo(() => {
    return INDICATORS.filter(i => statsMap[i.id]?.count > 0).sort((a, b) => (statsMap[b.id]?.count || 0) - (statsMap[a.id]?.count || 0)).slice(0, 5);
  }, [statsMap]);

  const topByWinRate = useMemo(() => {
    return INDICATORS.filter(i => (statsMap[i.id]?.count || 0) >= 3).sort((a, b) => (statsMap[b.id]?.winRate || 0) - (statsMap[a.id]?.winRate || 0)).slice(0, 5);
  }, [statsMap]);

  const topByPnl = useMemo(() => {
    return INDICATORS.filter(i => statsMap[i.id]?.totalPnl !== 0).sort((a, b) => (statsMap[b.id]?.totalPnl || 0) - (statsMap[a.id]?.totalPnl || 0)).slice(0, 5);
  }, [statsMap]);

  const favIndicators = useMemo(() => INDICATORS.filter(i => favorites.has(i.id)), [favorites]);

  if (topByUsage.length === 0 && favIndicators.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {topByUsage.length > 0 && (
        <div className="border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-mono uppercase text-primary font-bold">Часто используемые</span>
          </div>
          <div className="space-y-1">
            {topByUsage.map((ind, i) => (
              <div key={ind.id} className="flex items-center justify-between text-xs font-mono">
                <span className="text-foreground">{i + 1}. {ind.shortName}</span>
                <span className="text-muted-foreground">{statsMap[ind.id]?.count} trades</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topByWinRate.length > 0 && (
        <div className="border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Award className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold">Лучший Win Rate</span>
          </div>
          <div className="space-y-1">
            {topByWinRate.map((ind, i) => (
              <div key={ind.id} className="flex items-center justify-between text-xs font-mono">
                <span className="text-foreground">{i + 1}. {ind.shortName}</span>
                <span className="text-emerald-400">{statsMap[ind.id]?.winRate}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topByPnl.length > 0 && (
        <div className="border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[10px] font-mono uppercase text-amber-400 font-bold">Лучший P&L</span>
          </div>
          <div className="space-y-1">
            {topByPnl.map((ind, i) => (
              <div key={ind.id} className="flex items-center justify-between text-xs font-mono">
                <span className="text-foreground">{i + 1}. {ind.shortName}</span>
                <span className={statsMap[ind.id]?.totalPnl > 0 ? "text-emerald-400" : "text-red-400"}>
                  {statsMap[ind.id]?.totalPnl > 0 ? "+" : ""}{statsMap[ind.id]?.totalPnl.toFixed(0)}$
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {favIndicators.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-500/5 p-3 md:col-span-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
            <span className="text-[10px] font-mono uppercase text-amber-400 font-bold">Избранные</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {favIndicators.map((ind) => (
              <span key={ind.id} className="text-xs font-mono px-2 py-1 border border-amber-500/30 bg-amber-500/10 text-amber-300">
                {ind.shortName} {statsMap[ind.id]?.count > 0 && `(${statsMap[ind.id]?.winRate}% WR)`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IndicatorCard({
  indicator, stats, isExpanded, onToggle, isFavorite, onToggleFavorite, note, onSaveNote,
}: {
  indicator: IndicatorDefinition; stats: TradeStats; isExpanded: boolean; onToggle: () => void;
  isFavorite: boolean; onToggleFavorite: () => void; note: string; onSaveNote: (n: string) => void;
}) {
  const cat = INDICATOR_CATEGORIES[indicator.category];
  const cheat = SIGNAL_CHEATSHEET[indicator.id];
  const combos = COMBO_SUGGESTIONS[indicator.id];
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note);

  return (
    <div className={`border bg-card ${isFavorite ? "border-amber-500/40" : "border-border"}`}>
      <div className="flex items-center">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`px-2 py-3 transition-colors ${isFavorite ? "text-amber-400" : "text-muted-foreground/30 hover:text-amber-400/60"}`}
          title={isFavorite ? "Убрать из избранного" : "В избранное"}
        >
          <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-amber-400" : ""}`} />
        </button>
        <button onClick={onToggle} className="flex-1 flex items-center gap-3 px-2 py-3 text-left hover:bg-muted/40 transition-colors">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-foreground font-mono text-sm">{indicator.shortName}</span>
              <span className="text-xs text-muted-foreground font-mono">{indicator.name}</span>
              <span className={`text-[10px] font-mono uppercase px-1.5 py-0 border border-border ${cat.color}`}>{cat.label}</span>
              {note && <StickyNote className="h-3 w-3 text-amber-400/60" />}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground font-mono uppercase">Signal:</span>
                <SignalStrengthBar strength={indicator.signalStrength} />
              </div>
              <StatsBadge stats={stats} />
            </div>
          </div>
          <div className="text-muted-foreground shrink-0">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <p className="text-xs font-mono text-foreground leading-relaxed">{indicator.description}</p>

          {cheat && (
            <div className="border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[10px] font-mono uppercase text-amber-400 font-bold">Быстрая шпаргалка</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="flex items-start gap-1.5">
                  <TrendingUp className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-[11px] font-mono text-emerald-300">{cheat.bullish}</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <TrendingDown className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                  <span className="text-[11px] font-mono text-red-300">{cheat.bearish}</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Minus className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="text-[11px] font-mono text-muted-foreground">{cheat.neutral}</span>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Target className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs font-mono uppercase text-emerald-400 font-bold">Use Cases</span>
              </div>
              <ul className="space-y-1">
                {indicator.useCases.map((uc, i) => (
                  <li key={i} className="text-xs font-mono text-foreground flex gap-2">
                    <span className="text-muted-foreground shrink-0">•</span><span>{uc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-mono uppercase text-red-400 font-bold">Common Mistakes</span>
              </div>
              <ul className="space-y-1">
                {indicator.commonMistakes.map((cm, i) => (
                  <li key={i} className="text-xs font-mono text-foreground flex gap-2">
                    <span className="text-red-400/60 shrink-0">✕</span><span>{cm}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {combos && (
            <div className="flex items-center gap-2 pt-2 border-t border-border/50">
              <span className="text-[10px] font-mono text-muted-foreground uppercase">Комбинируй с:</span>
              {combos.map((c) => {
                const combo = INDICATORS.find(i => i.id === c);
                return combo ? (
                  <span key={c} className="text-[10px] font-mono px-1.5 py-0.5 border border-primary/30 bg-primary/10 text-primary">{combo.shortName}</span>
                ) : null;
              })}
            </div>
          )}

          <div className="flex items-center gap-4 pt-2 border-t border-border/50">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase">Best Timeframe:</span>
              <span className="text-xs font-mono text-foreground">{indicator.bestTimeframe}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase">Signal:</span>
              <SignalStrengthBar strength={indicator.signalStrength} />
              <span className="text-[10px] font-mono text-muted-foreground">({indicator.signalStrength}/5)</span>
            </div>
          </div>

          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <StickyNote className="h-3.5 w-3.5 text-amber-400/60" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase">Мои заметки</span>
              </div>
              {!editingNote && (
                <button onClick={() => { setNoteDraft(note); setEditingNote(true); }} className="text-[10px] font-mono text-primary hover:underline">
                  {note ? "Редактировать" : "Добавить"}
                </button>
              )}
            </div>
            {editingNote ? (
              <div className="space-y-1">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Мои наблюдения по этому индикатору..."
                  className="font-mono text-xs bg-background min-h-[60px]"
                  autoFocus
                />
                <div className="flex gap-1 justify-end">
                  <button onClick={() => setEditingNote(false)} className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-2 py-1">Отмена</button>
                  <button onClick={() => { onSaveNote(noteDraft); setEditingNote(false); }} className="text-[10px] font-mono text-primary hover:underline px-2 py-1">Сохранить</button>
                </div>
              </div>
            ) : note ? (
              <p className="text-xs font-mono text-foreground/80 whitespace-pre-wrap">{note}</p>
            ) : (
              <p className="text-[10px] font-mono text-muted-foreground/50 italic">Нет заметок</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ALL_CATEGORIES: (IndicatorCategory | "all" | "favorites")[] = ["all", "favorites", "trend", "momentum", "volume", "volatility", "pattern"];

export default function Indicators() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<IndicatorCategory | "all" | "favorites">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [notes, setNotes] = useState<Record<string, string>>(loadNotes);
  const statsMap = useIndicatorStats();

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const saveNote = useCallback((id: string, text: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (text.trim()) next[id] = text.trim(); else delete next[id];
      saveNotes(next);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    return INDICATORS.filter((ind) => {
      if (category === "favorites") {
        if (!favorites.has(ind.id)) return false;
      } else if (category !== "all" && ind.category !== category) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return ind.name.toLowerCase().includes(q) || ind.shortName.toLowerCase().includes(q) || ind.tags.some((t) => t.includes(q)) || ind.category.includes(q);
      }
      return true;
    });
  }, [search, category, favorites]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: INDICATORS.length, favorites: favorites.size };
    INDICATORS.forEach((ind) => { counts[ind.category] = (counts[ind.category] || 0) + 1; });
    return counts;
  }, [favorites]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Indicators</h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">Справочник индикаторов с персональной статистикой и заметками</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          <span>{INDICATORS.length} indicators</span>
        </div>
      </div>

      <PerformanceDashboard statsMap={statsMap} favorites={favorites} />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search indicators..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 font-mono text-xs bg-background h-9" />
        </div>
      </div>

      <div className="flex gap-0 border border-border overflow-x-auto">
        {ALL_CATEGORIES.map((cat) => {
          const label = cat === "all" ? "All" : cat === "favorites" ? "★ Избранные" : INDICATOR_CATEGORIES[cat].label;
          const count = categoryCounts[cat] || 0;
          return (
            <button key={cat} onClick={() => setCategory(cat)} className={`px-4 py-2 text-xs font-mono uppercase whitespace-nowrap border-r border-border last:border-r-0 transition-colors ${category === cat ? cat === "favorites" ? "bg-amber-500/20 text-amber-300" : "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              {label} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1">
        {filtered.map((ind) => (
          <IndicatorCard
            key={ind.id}
            indicator={ind}
            stats={statsMap[ind.id] || { count: 0, wins: 0, winRate: 0, avgR: null, totalPnl: 0 }}
            isExpanded={expanded === ind.id}
            onToggle={() => setExpanded(expanded === ind.id ? null : ind.id)}
            isFavorite={favorites.has(ind.id)}
            onToggleFavorite={() => toggleFavorite(ind.id)}
            note={notes[ind.id] || ""}
            onSaveNote={(text) => saveNote(ind.id, text)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="border border-border bg-card px-4 py-10 text-center">
            <p className="text-xs font-mono text-muted-foreground">No indicators match your search</p>
          </div>
        )}
      </div>
    </div>
  );
}
