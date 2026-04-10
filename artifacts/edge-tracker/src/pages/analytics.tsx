import React, { useMemo, useState } from "react";
import { useGetPerformanceStats, useGetTopPatterns, useListTrades } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, ReferenceLine
} from "recharts";

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const TOOLTIP_STYLE = { backgroundColor: "#0f1117", borderColor: "#1e293b", borderRadius: 0, fontFamily: "monospace", fontSize: 12 };
const CURSOR = { fill: "#1e293b" };

export default function Analytics() {
  const { data: stats } = useGetPerformanceStats();
  const { data: topPatterns } = useGetTopPatterns();
  const { data: trades = [] } = useListTrades();

  const equityCurve = useMemo(() => {
    const sorted = [...trades]
      .filter((t) => t.pnl != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0;
    return sorted.map((t, i) => {
      cum += Number(t.pnl) || 0;
      return { label: `${t.ticker} ${t.date?.substring(5, 10)}`, value: cum, trade: i + 1 };
    });
  }, [trades]);

  const heatmap = useMemo(() => {
    const dayData: Record<number, { wins: number; losses: number; pnl: number; count: number }> = {};
    for (let d = 1; d <= 5; d++) dayData[d] = { wins: 0, losses: 0, pnl: 0, count: 0 };
    trades.forEach((t) => {
      const day = new Date(t.date).getDay();
      if (day >= 1 && day <= 5) {
        dayData[day].count++;
        dayData[day].pnl += Number(t.pnl) || 0;
        if (t.result === "win") dayData[day].wins++;
        else if (t.result === "loss") dayData[day].losses++;
      }
    });
    return [1, 2, 3, 4, 5].map((d) => ({
      day: DAYS[d - 1],
      winRate: dayData[d].count > 0 ? Math.round((dayData[d].wins / dayData[d].count) * 100) : 0,
      pnl: dayData[d].pnl,
      count: dayData[d].count,
    }));
  }, [trades]);

  const sessionPnl = useMemo(() => {
    const map: Record<string, number> = {};
    trades.forEach((t) => {
      const s = t.session || "unknown";
      map[s] = (map[s] || 0) + (Number(t.pnl) || 0);
    });
    return Object.entries(map).map(([session, pnl]) => ({ session, pnl })).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  const traderPnl = useMemo(() => {
    const map: Record<string, number> = {};
    trades.forEach((t) => {
      const tr = t.trader || "Неизвестно";
      map[tr] = (map[tr] || 0) + (Number(t.pnl) || 0);
    });
    return Object.entries(map).map(([trader, pnl]) => ({ trader, pnl })).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  const eventTypePnl = useMemo(() => {
    const map: Record<string, { pnl: number; wins: number; count: number }> = {};
    trades.forEach((t) => {
      const et = t.eventType || "other";
      if (!map[et]) map[et] = { pnl: 0, wins: 0, count: 0 };
      map[et].pnl += Number(t.pnl) || 0;
      map[et].count++;
      if (t.result === "win") map[et].wins++;
    });
    return Object.entries(map).map(([eventType, d]) => ({
      eventType,
      pnl: d.pnl,
      winRate: d.count > 0 ? Math.round((d.wins / d.count) * 100) : 0,
    })).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  const noData = <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono text-sm">Недостаточно данных</div>;

  const pnlColor = (v: number) => v >= 0 ? "#10b981" : "#ef4444";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Аналитика</h1>

      {/* Equity Curve */}
      <Card className="bg-card border-border rounded-none shadow-none">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Кривая капитала (кумулятивный PnL)</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 h-[280px]">
          {equityCurve.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityCurve} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="trade" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} label={{ value: "Трейд #", position: "insideBottomRight", offset: -10, fontSize: 10, fill: "#64748b" }} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Кум. PnL"]} labelFormatter={(l) => `Трейд #${l}`} />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} fill="url(#pnlGrad)" dot={false} activeDot={{ r: 4, fill: "#0ea5e9" }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : noData}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Heatmap by day */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Win Rate по дням недели</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 h-[240px]">
            {heatmap.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={heatmap} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CURSOR} formatter={(v: any, _n: any, props: any) => [`${v}% (${props.payload.count} трейдов)`, "Win Rate"]} />
                  <Bar dataKey="winRate" radius={[2, 2, 0, 0]} name="Win Rate (%)">
                    {heatmap.map((entry, i) => (
                      <rect key={i} fill={entry.winRate >= 60 ? "#10b981" : entry.winRate >= 40 ? "#0ea5e9" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : noData}
          </CardContent>
          {/* Heatmap cells */}
          <div className="px-4 pb-4 grid grid-cols-5 gap-2">
            {heatmap.map((d) => {
              const bg = d.count === 0 ? "bg-muted/20" : d.winRate >= 60 ? "bg-emerald-500/20 border-emerald-500/30" : d.winRate >= 40 ? "bg-primary/20 border-primary/30" : "bg-red-500/20 border-red-500/30";
              const text = d.count === 0 ? "text-muted-foreground" : d.winRate >= 60 ? "text-emerald-400" : d.winRate >= 40 ? "text-primary" : "text-red-400";
              return (
                <div key={d.day} className={`${bg} border p-2 text-center`}>
                  <div className="text-[10px] font-mono text-muted-foreground">{d.day}</div>
                  <div className={`text-sm font-bold font-mono ${text}`}>{d.count > 0 ? `${d.winRate}%` : "-"}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{d.count} трейд{d.count === 1 ? "" : "ов"}</div>
                  <div className={`text-[10px] font-mono ${d.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{d.count > 0 ? `$${d.pnl.toFixed(0)}` : ""}</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* PnL by session */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">PnL по сессии</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 h-[300px]">
            {sessionPnl.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sessionPnl} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="session" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CURSOR} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "PnL"]} />
                  <Bar dataKey="pnl" radius={[2, 2, 0, 0]} name="PnL" fill="#0ea5e9"
                    label={undefined} />
                </BarChart>
              </ResponsiveContainer>
            ) : noData}
          </CardContent>
        </Card>

        {/* Win Rate by Setup */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Win Rate по Setup</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 h-[300px]">
            {stats?.bySetup && stats.bySetup.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.bySetup} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="setup" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="winRate" fill="#0ea5e9" radius={[2, 2, 0, 0]} name="Win Rate (%)" />
                </BarChart>
              </ResponsiveContainer>
            ) : noData}
          </CardContent>
        </Card>

        {/* PnL by Event Type */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">PnL по типу события</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 h-[300px]">
            {eventTypePnl.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventTypePnl} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="eventType" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "PnL"]} />
                  <Bar dataKey="pnl" fill="#f59e0b" radius={[2, 2, 0, 0]} name="PnL" />
                </BarChart>
              </ResponsiveContainer>
            ) : noData}
          </CardContent>
        </Card>

        {/* PnL by Trader */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">PnL по трейдеру</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 h-[280px]">
            {traderPnl.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={traderPnl} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="trader" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "PnL"]} />
                  <Bar dataKey="pnl" fill="#8b5cf6" radius={[2, 2, 0, 0]} name="PnL" />
                </BarChart>
              </ResponsiveContainer>
            ) : noData}
          </CardContent>
        </Card>

        {/* Top Patterns */}
        <Card className="bg-card border-border rounded-none shadow-none">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Топ паттернов (уверенность)</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 h-[280px]">
            {topPatterns && topPatterns.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topPatterns} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <YAxis type="category" dataKey="patternName" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="confidenceLevel" fill="#10b981" radius={[0, 2, 2, 0]} name="Уверенность (%)" barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : noData}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
