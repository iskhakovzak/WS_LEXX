import React, { useMemo, useEffect, useRef } from "react";
import { useGetDashboardSummary, useGetRecentTrades, useListTrades } from "@workspace/api-client-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Activity, Target, BarChart2, Clock, TrendingUp, TrendingDown, Flame, Snowflake } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";

function MarketTicker() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [
        { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
        { proName: "FOREXCOM:NSXUSD", title: "US 100" },
        { proName: "BITSTAMP:BTCUSD", title: "Bitcoin" },
        { proName: "NASDAQ:NVDA", title: "NVDA" },
        { proName: "NASDAQ:TSLA", title: "TSLA" },
        { proName: "NASDAQ:AAPL", title: "AAPL" },
        { proName: "NASDAQ:AMD", title: "AMD" },
        { proName: "NASDAQ:META", title: "META" },
        { proName: "NASDAQ:MSFT", title: "MSFT" },
      ],
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: "adaptive",
      colorTheme: theme,
      locale: "en",
    });
    containerRef.current.appendChild(script);
  }, [theme]);

  return (
    <div className="tradingview-widget-container overflow-hidden" style={{ height: 46 }}>
      <div ref={containerRef} />
    </div>
  );
}

function StatCard({ title, icon: Icon, value, valueClass, subtitle, accentColor }: {
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
  valueClass?: string;
  subtitle?: React.ReactNode;
  accentColor: string;
}) {
  return (
    <div className={`group relative bg-card border border-border/50 rounded-lg overflow-hidden transition-all duration-300 hover:border-border hover:shadow-lg`}>
      <div className={`absolute top-0 left-0 w-full h-0.5 ${accentColor.replace("border-l-", "bg-")}`} />
      <div className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
        <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider font-semibold">{title}</div>
        <div className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center group-hover:bg-muted/50 transition-colors">
          <Icon className="h-4 w-4 text-muted-foreground/60" />
        </div>
      </div>
      <div className="px-4 pb-4">
        <div className={`text-2xl font-bold font-mono ${valueClass || "text-foreground"}`}>{value}</div>
        {subtitle && <div className="text-xs font-mono text-muted-foreground mt-1.5">{subtitle}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: recentTrades } = useGetRecentTrades();
  const { data: allTrades = [] } = useListTrades();

  const streak = useMemo(() => {
    if (!allTrades.length) return { count: 0, type: "none" as "win" | "loss" | "none" };
    const sorted = [...allTrades].sort((a, b) => b.date.localeCompare(a.date));
    const first = sorted[0].result;
    if (first !== "win" && first !== "loss") return { count: 0, type: "none" as "win" | "loss" | "none" };
    let count = 0;
    for (const t of sorted) {
      if (t.result === first) count++;
      else break;
    }
    return { count, type: first as "win" | "loss" };
  }, [allTrades]);

  const weekStats = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);
    const weekTrades = allTrades.filter((t) => new Date(t.date) >= startOfWeek);
    const pnl = weekTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
    const wins = weekTrades.filter((t) => t.result === "win").length;
    return { count: weekTrades.length, pnl, wins };
  }, [allTrades]);

  const isWinStreak = streak.type === "win";
  const streakColor = isWinStreak ? "text-emerald-400" : streak.type === "loss" ? "text-red-400" : "text-muted-foreground";
  const StreakIcon = isWinStreak ? Flame : Snowflake;

  return (
    <div className="space-y-6">
      <MarketTicker />
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight flex items-center gap-2.5">
            <div className="w-2 h-2 bg-primary rounded-full" />
            Дашборд
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">{allTrades.length} трейдов · {new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        {streak.count > 0 && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border backdrop-blur-sm ${isWinStreak ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
            <StreakIcon className={`h-4 w-4 ${streakColor}`} />
            <span className={`font-mono text-sm font-bold ${streakColor}`}>{streak.count}</span>
            <span className={`font-mono text-xs ${streakColor}`}>{isWinStreak ? "win streak" : "loss streak"}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total PnL"
          icon={Activity}
          value={formatCurrency(summary?.totalPnl)}
          valueClass={(summary?.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}
          subtitle={`${allTrades.length} всего трейдов`}
          accentColor={(summary?.totalPnl ?? 0) >= 0 ? "border-l-emerald-500" : "border-l-red-500"}
        />
        <StatCard
          title="Win Rate"
          icon={Target}
          value={formatPercent(summary?.winRate)}
          valueClass="text-foreground"
          subtitle={streak.count > 0 ? <span className={streakColor}>{streak.count} {streak.type === "win" ? "🔥" : "❄️"} streak</span> : undefined}
          accentColor="border-l-primary"
        />
        <StatCard
          title="Avg R-Multiple"
          icon={BarChart2}
          value={`${summary?.avgRMultiple?.toFixed(2) ?? "0.00"}R`}
          valueClass="text-primary"
          accentColor="border-l-amber-500"
        />
        <StatCard
          title="Неделя"
          icon={Clock}
          value={formatCurrency(weekStats.pnl)}
          valueClass={weekStats.pnl >= 0 ? "text-emerald-400" : "text-red-400"}
          subtitle={`${weekStats.count} трейдов · ${weekStats.wins} win`}
          accentColor={weekStats.pnl >= 0 ? "border-l-emerald-500" : "border-l-red-500"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <h2 className="text-xs font-bold text-muted-foreground font-mono uppercase tracking-[0.15em] flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-primary rounded-full" />
            Недавние Трейды
          </h2>
          <div className="bg-card border border-border/50 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono text-left">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-normal uppercase text-[10px] tracking-wider">Тикер</th>
                    <th className="px-4 py-3 font-normal uppercase text-[10px] tracking-wider">Дата</th>
                    <th className="px-4 py-3 font-normal uppercase text-[10px] tracking-wider">Setup</th>
                    <th className="px-4 py-3 font-normal uppercase text-[10px] tracking-wider">Результат</th>
                    <th className="px-4 py-3 font-normal uppercase text-[10px] tracking-wider text-right">PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentTrades?.map((trade) => (
                    <tr key={trade.id} className={`transition-colors border-l-[3px] ${
                      trade.result === "WIN" || trade.result === "win" ? "border-l-emerald-500/60 hover:bg-emerald-500/5" :
                      trade.result === "LOSS" || trade.result === "loss" ? "border-l-red-500/60 hover:bg-red-500/5" :
                      "border-l-muted hover:bg-muted/40"
                    }`}>
                      <td className="px-4 py-3 font-bold text-foreground">{trade.ticker}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{trade.date.substring(0, 10)}</td>
                      <td className="px-4 py-3 text-xs truncate max-w-[100px] text-foreground/70">{trade.setup}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold ${trade.result === "WIN" || trade.result === "win" ? "bg-emerald-500/15 text-emerald-400" : trade.result === "LOSS" || trade.result === "loss" ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground"}`}>
                          {trade.result?.toUpperCase()}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${(trade.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {formatCurrency(trade.pnl)}
                      </td>
                    </tr>
                  ))}
                  {(!recentTrades || recentTrades.length === 0) && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">Нет недавних трейдов</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xs font-bold text-muted-foreground font-mono uppercase tracking-[0.15em] flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
            Market Context
          </h2>
          <div className="bg-card border border-border/50 rounded-lg">
            <div className="p-4 space-y-3">
              <div className="bg-muted/20 border border-border/30 rounded-md p-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1 tracking-wider">Режим рынка</div>
                <div className="text-sm font-mono font-bold text-foreground">{summary?.marketRegime || "Не определен"}</div>
              </div>
              <div className="bg-muted/20 border border-border/30 rounded-md p-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1 tracking-wider">Топ Setup</div>
                <div className="text-sm font-mono font-bold text-primary">{summary?.topSetup || "-"}</div>
              </div>
              <div className="bg-muted/20 border border-border/30 rounded-md p-3">
                <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1 tracking-wider">Лучшие тикеры</div>
                <div className="text-sm font-mono text-foreground">{summary?.bestTickers || "-"}</div>
              </div>
              <div className="pt-3 border-t border-border/30">
                <div className="text-[10px] font-mono text-muted-foreground uppercase mb-3 tracking-wider">Быстрые ссылки</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { href: "/trades", label: "Трейды" },
                    { href: "/analytics", label: "Аналитика" },
                    { href: "/watchlist", label: "Вотчлист" },
                    { href: "/playbook", label: "Плейбук" },
                    { href: "/calculator", label: "Калькулятор" },
                    { href: "/events", label: "События" },
                  ].map(({ href, label }) => (
                    <a key={href} href={href} className="text-xs font-mono text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all duration-200 px-2.5 py-2 rounded-md border border-transparent hover:border-primary/15">
                      → {label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
