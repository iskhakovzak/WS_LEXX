import React, { useState, useMemo } from "react";
import { useListTrades } from "@workspace/api-client-react";
import { INDICATORS, INDICATOR_CATEGORIES, type IndicatorCategory, type IndicatorDefinition } from "@/data/indicators";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronUp, TrendingUp, Target, AlertCircle, Clock, Zap, BarChart3 } from "lucide-react";

type TradeStats = {
  count: number;
  wins: number;
  winRate: number;
  avgR: number | null;
};

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
      str
        .toLowerCase()
        .split(",")
        .forEach((segment) => {
          const trimmed = segment.trim();
          if (trimmed) phrases.add(trimmed);
        });
      return phrases;
    };

    const parseTokens = (str: string): Set<string> => {
      const tokens = new Set<string>();
      str
        .toLowerCase()
        .split(/[,;|\s]+/)
        .forEach((tok) => {
          const trimmed = tok.trim();
          if (trimmed) tokens.add(trimmed);
        });
      return tokens;
    };

    const preparedTrades = trades.map((t) => {
      const rawTags = t.tags ?? "";
      const rawSetup = t.setup ?? "";
      return {
        trade: t,
        tagPhrases: parsePhrases(rawTags),
        tagTokens: parseTokens(rawTags),
        setupPhrases: parsePhrases(rawSetup),
        setupTokens: parseTokens(rawSetup),
      };
    });

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
      const rValues = matchingTrades
        .filter((pt) => pt.trade.rMultiple != null)
        .map((pt) => Number(pt.trade.rMultiple));

      statsMap[ind.id] = {
        count: matchingTrades.length,
        wins,
        winRate: matchingTrades.length > 0 ? Math.round((wins / matchingTrades.length) * 100) : 0,
        avgR: rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null,
      };
    });

    return statsMap;
  }, [trades]);
}

function SignalStrengthBar({ strength }: { strength: number }) {
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-3 h-1.5 ${
            i <= strength
              ? strength >= 4
                ? "bg-emerald-400"
                : strength >= 3
                  ? "bg-primary"
                  : "bg-yellow-400"
              : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

function StatsBadge({ stats }: { stats: TradeStats }) {
  if (stats.count === 0) {
    return (
      <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 border border-border">
        0 trades
      </span>
    );
  }

  return (
    <div className="flex gap-1.5 items-center flex-wrap">
      <span className="text-[10px] font-mono text-foreground px-2 py-0.5 border border-border bg-muted/30">
        {stats.count} trade{stats.count !== 1 ? "s" : ""}
      </span>
      <span
        className={`text-[10px] font-mono px-2 py-0.5 border ${
          stats.winRate >= 60
            ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
            : stats.winRate >= 40
              ? "text-primary border-primary/30 bg-primary/10"
              : "text-red-400 border-red-500/30 bg-red-500/10"
        }`}
      >
        {stats.winRate}% WR
      </span>
      {stats.avgR != null && (
        <span
          className={`text-[10px] font-mono px-2 py-0.5 border ${
            stats.avgR >= 1
              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
              : stats.avgR >= 0
                ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
                : "text-red-400 border-red-500/30 bg-red-500/10"
          }`}
        >
          {stats.avgR.toFixed(1)}R avg
        </span>
      )}
    </div>
  );
}

function IndicatorCard({
  indicator,
  stats,
  isExpanded,
  onToggle,
}: {
  indicator: IndicatorDefinition;
  stats: TradeStats;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cat = INDICATOR_CATEGORIES[indicator.category];

  return (
    <div className="border border-border bg-card">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-foreground font-mono text-sm">
              {indicator.shortName}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {indicator.name}
            </span>
            <span
              className={`text-[10px] font-mono uppercase px-1.5 py-0 border border-border ${cat.color}`}
            >
              {cat.label}
            </span>
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
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <div>
            <p className="text-xs font-mono text-foreground leading-relaxed">
              {indicator.description}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Target className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs font-mono uppercase text-emerald-400 font-bold">
                  Use Cases
                </span>
              </div>
              <ul className="space-y-1">
                {indicator.useCases.map((uc, i) => (
                  <li key={i} className="text-xs font-mono text-foreground flex gap-2">
                    <span className="text-muted-foreground shrink-0">•</span>
                    <span>{uc}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-mono uppercase text-red-400 font-bold">
                  Common Mistakes
                </span>
              </div>
              <ul className="space-y-1">
                {indicator.commonMistakes.map((cm, i) => (
                  <li key={i} className="text-xs font-mono text-foreground flex gap-2">
                    <span className="text-red-400/60 shrink-0">✕</span>
                    <span>{cm}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2 border-t border-border/50">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase">
                Best Timeframe:
              </span>
              <span className="text-xs font-mono text-foreground">
                {indicator.bestTimeframe}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase">
                Signal:
              </span>
              <SignalStrengthBar strength={indicator.signalStrength} />
              <span className="text-[10px] font-mono text-muted-foreground">
                ({indicator.signalStrength}/5)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ALL_CATEGORIES: (IndicatorCategory | "all")[] = [
  "all",
  "trend",
  "momentum",
  "volume",
  "volatility",
  "pattern",
];

export default function Indicators() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<IndicatorCategory | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const statsMap = useIndicatorStats();

  const filtered = useMemo(() => {
    return INDICATORS.filter((ind) => {
      if (category !== "all" && ind.category !== category) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          ind.name.toLowerCase().includes(q) ||
          ind.shortName.toLowerCase().includes(q) ||
          ind.tags.some((t) => t.includes(q)) ||
          ind.category.includes(q)
        );
      }
      return true;
    });
  }, [search, category]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: INDICATORS.length };
    INDICATORS.forEach((ind) => {
      counts[ind.category] = (counts[ind.category] || 0) + 1;
    });
    return counts;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">
            Indicators
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Technical indicators & chart patterns reference library
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          <span>{INDICATORS.length} indicators</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search indicators..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 font-mono text-xs bg-background h-9"
          />
        </div>
      </div>

      <div className="flex gap-0 border border-border overflow-x-auto">
        {ALL_CATEGORIES.map((cat) => {
          const label = cat === "all" ? "All" : INDICATOR_CATEGORIES[cat].label;
          const count = categoryCounts[cat] || 0;
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-4 py-2 text-xs font-mono uppercase whitespace-nowrap border-r border-border last:border-r-0 transition-colors ${
                category === cat
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {label}{" "}
              <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1">
        {filtered.map((ind) => (
          <IndicatorCard
            key={ind.id}
            indicator={ind}
            stats={statsMap[ind.id] || { count: 0, wins: 0, winRate: 0, avgR: null }}
            isExpanded={expanded === ind.id}
            onToggle={() => setExpanded(expanded === ind.id ? null : ind.id)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="border border-border bg-card px-4 py-10 text-center">
            <p className="text-xs font-mono text-muted-foreground">
              No indicators match your search
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
