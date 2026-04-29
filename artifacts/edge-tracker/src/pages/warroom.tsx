import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  useGetActiveWarRoom,
  useCreateWarRoomSession,
  useUpdateWarRoomSession,
  useCreateWarRoomLevel,
  useDeleteWarRoomLevel,
  useListWarRoomSessions,
  useListTrades,
  useListBig7Levels,
  getGetActiveWarRoomQueryKey,
  getListWarRoomSessionsQueryKey,
} from "@workspace/api-client-react";
import type {
  WarRoomSessionWithLevels,
  ChecklistItem,
  WarRoomLevel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Shield, X, Clock, Target, StickyNote, CheckSquare, BarChart3,
  Plus, Trash2, ArrowLeft, AlertTriangle, Zap, Activity,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { text: "Проверить открытые позиции", done: false },
  { text: "Выставить стопы", done: false },
  { text: "Уменьшить размер позиции", done: false },
  { text: "Проверить новостной фон", done: false },
  { text: "Определить ключевые уровни", done: false },
];

function CountdownTimer({ eventTime }: { eventTime: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const target = new Date(eventTime).getTime();
  const diff = target - now;
  const isPast = diff <= 0;
  const absDiff = Math.abs(diff);

  const hours = Math.floor(absDiff / 3600000);
  const minutes = Math.floor((absDiff % 3600000) / 60000);
  const seconds = Math.floor((absDiff % 60000) / 1000);

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`text-xs font-mono uppercase tracking-[0.3em] ${isPast ? "text-red-400" : "text-orange-400"}`}>
        {isPast ? "СОБЫТИЕ НАЧАЛОСЬ" : "ДО СОБЫТИЯ"}
      </div>
      <div className="flex items-center gap-1">
        {isPast && <span className="text-red-400 text-4xl font-mono font-black">-</span>}
        <div className="flex items-center gap-2">
          <TimeBlock value={pad(hours)} label="ч" />
          <span className="text-orange-500/60 text-3xl font-mono animate-pulse">:</span>
          <TimeBlock value={pad(minutes)} label="м" />
          <span className="text-orange-500/60 text-3xl font-mono animate-pulse">:</span>
          <TimeBlock value={pad(seconds)} label="с" />
        </div>
      </div>
    </div>
  );
}

function TimeBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="bg-black/60 border border-orange-500/30 px-3 py-2 rounded font-mono text-4xl font-black text-orange-400 tracking-wider min-w-[72px] text-center tabular-nums">
        {value}
      </div>
      <span className="text-[9px] font-mono text-orange-500/50 uppercase mt-1">{label}</span>
    </div>
  );
}

function LevelsPanel({
  session,
  big7Levels,
}: {
  session: WarRoomSessionWithLevels;
  big7Levels: Array<{ id: number; ticker: string; label: string; price: number; notes?: string | null }>;
}) {
  const qc = useQueryClient();
  const createLevel = useCreateWarRoomLevel();
  const deleteLevel = useDeleteWarRoomLevel();
  const [ticker, setTicker] = useState("");
  const [price, setPrice] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("support");

  const handleAdd = () => {
    if (!ticker || !price || !label) return;
    createLevel.mutate(
      { id: session.id, data: { ticker: ticker.toUpperCase(), price: Number(price), label, type } },
      { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetActiveWarRoomQueryKey() }); setTicker(""); setPrice(""); setLabel(""); } }
    );
  };

  const handleImportBig7 = () => {
    if (!ticker) return;
    const matching = big7Levels.filter(l => l.ticker.toUpperCase() === ticker.toUpperCase());
    matching.forEach(l => {
      createLevel.mutate(
        { id: session.id, data: { ticker: l.ticker, price: l.price, label: l.label, type: l.label.toLowerCase().includes("support") ? "support" : "resistance" } },
        { onSuccess: () => qc.invalidateQueries({ queryKey: getGetActiveWarRoomQueryKey() }) }
      );
    });
  };

  const handleDelete = (levelId: number) => {
    deleteLevel.mutate(
      { id: levelId },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetActiveWarRoomQueryKey() }) }
    );
  };

  const grouped = useMemo(() => {
    const map: Record<string, WarRoomLevel[]> = {};
    (session.levels || []).forEach(l => {
      if (!map[l.ticker]) map[l.ticker] = [];
      map[l.ticker].push(l);
    });
    return map;
  }, [session.levels]);

  return (
    <div className="war-room-panel">
      <div className="flex items-center gap-2 mb-3">
        <Target className="h-4 w-4 text-orange-400" />
        <h3 className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-orange-400">Ключевые уровни</h3>
      </div>
      <div className="flex gap-1.5 mb-3">
        <Input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="AAPL" className="war-room-input w-20" />
        <Input value={price} onChange={e => setPrice(e.target.value)} placeholder="185.50" className="war-room-input w-24" type="number" step="0.01" />
        <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="support" className="war-room-input flex-1" />
        <select value={type} onChange={e => setType(e.target.value)} className="war-room-input w-28 bg-black/40">
          <option value="support">Support</option>
          <option value="resistance">Resistance</option>
          <option value="pivot">Pivot</option>
          <option value="vwap">VWAP</option>
        </select>
        <Button onClick={handleAdd} size="sm" className="bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 h-7 px-2">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {ticker && (
        <button onClick={handleImportBig7} className="text-[10px] font-mono text-orange-400/60 hover:text-orange-400 mb-2 flex items-center gap-1">
          <Zap className="h-2.5 w-2.5" /> Импорт из Big 7 для {ticker.toUpperCase()}
        </button>
      )}
      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
        {Object.entries(grouped).map(([t, levels]) => (
          <div key={t}>
            <div className="text-[10px] font-mono font-bold text-orange-300 mb-1">{t}</div>
            {levels.map(l => (
              <div key={l.id} className="flex items-center justify-between gap-2 py-0.5 group">
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span className={l.type === "support" ? "text-emerald-400" : l.type === "resistance" ? "text-red-400" : "text-blue-400"}>
                    {l.type === "support" ? "▲" : l.type === "resistance" ? "▼" : "●"}
                  </span>
                  <span className="text-foreground/90">${l.price}</span>
                  <span className="text-muted-foreground/60">{l.label}</span>
                </div>
                <button onClick={() => handleDelete(l.id)} className="opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ))}
        {Object.keys(grouped).length === 0 && (
          <div className="text-[10px] font-mono text-muted-foreground/30 text-center py-4">Нет уровней</div>
        )}
      </div>
    </div>
  );
}

function NotesPanel({ session }: { session: WarRoomSessionWithLevels }) {
  const qc = useQueryClient();
  const updateSession = useUpdateWarRoomSession();
  const [notes, setNotes] = useState(session.notes || "");

  useEffect(() => { setNotes(session.notes || ""); }, [session.notes]);

  const save = useCallback(() => {
    updateSession.mutate(
      { id: session.id, data: { notes } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetActiveWarRoomQueryKey() }) }
    );
  }, [notes, session.id]);

  return (
    <div className="war-room-panel">
      <div className="flex items-center gap-2 mb-3">
        <StickyNote className="h-4 w-4 text-orange-400" />
        <h3 className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-orange-400">Быстрые заметки</h3>
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={save}
        placeholder="Наблюдения в реальном времени..."
        className="w-full h-32 bg-black/40 border border-orange-500/20 text-sm font-mono text-foreground/90 p-2 resize-none focus:outline-none focus:border-orange-500/50 placeholder:text-muted-foreground/30"
      />
    </div>
  );
}

function ChecklistPanel({ session }: { session: WarRoomSessionWithLevels }) {
  const qc = useQueryClient();
  const updateSession = useUpdateWarRoomSession();
  const [items, setItems] = useState<ChecklistItem[]>(session.checklist || DEFAULT_CHECKLIST);
  const [newItem, setNewItem] = useState("");

  useEffect(() => { setItems(session.checklist || DEFAULT_CHECKLIST); }, [session.checklist]);

  const saveChecklist = (updated: ChecklistItem[]) => {
    setItems(updated);
    updateSession.mutate(
      { id: session.id, data: { checklist: updated } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetActiveWarRoomQueryKey() }) }
    );
  };

  const toggleItem = (idx: number) => {
    const updated = items.map((item, i) => i === idx ? { ...item, done: !item.done } : item);
    saveChecklist(updated);
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    const updated = [...items, { text: newItem.trim(), done: false }];
    saveChecklist(updated);
    setNewItem("");
  };

  const removeItem = (idx: number) => {
    const updated = items.filter((_, i) => i !== idx);
    saveChecklist(updated);
  };

  const doneCount = items.filter(i => i.done).length;

  return (
    <div className="war-room-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-orange-400" />
          <h3 className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-orange-400">Чеклист</h3>
        </div>
        <span className="text-[10px] font-mono text-orange-400/60">{doneCount}/{items.length}</span>
      </div>
      <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <button onClick={() => toggleItem(i)}
              className={`w-4 h-4 border flex items-center justify-center shrink-0 transition-colors ${
                item.done ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : "border-orange-500/30 text-transparent hover:border-orange-500/50"
              }`}
            >
              {item.done && "✓"}
            </button>
            <span className={`text-xs font-mono flex-1 ${item.done ? "line-through text-muted-foreground/40" : "text-foreground/80"}`}>
              {item.text}
            </span>
            <button onClick={() => removeItem(i)} className="opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        <Input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addItem()}
          placeholder="Добавить пункт..."
          className="war-room-input flex-1"
        />
        <Button onClick={addItem} size="sm" className="bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 h-7 px-2">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function TodayTradesWidget() {
  const { data: trades } = useListTrades();
  const today = new Date().toISOString().substring(0, 10);
  const todayTrades = useMemo(() =>
    (trades || []).filter(t => t.date === today),
    [trades, today]
  );

  const totalPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const wins = todayTrades.filter(t => t.result === "win").length;
  const losses = todayTrades.filter(t => t.result === "loss").length;

  return (
    <div className="war-room-panel">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-orange-400" />
        <h3 className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-orange-400">Сделки сегодня</h3>
      </div>
      {todayTrades.length === 0 ? (
        <div className="text-[10px] font-mono text-muted-foreground/30 text-center py-4">Нет сделок сегодня</div>
      ) : (
        <>
          <div className="flex gap-4 mb-2">
            <div className="text-center">
              <div className="text-lg font-mono font-black text-foreground">{todayTrades.length}</div>
              <div className="text-[9px] font-mono text-muted-foreground/50 uppercase">Сделок</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-mono font-black ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(0)}
              </div>
              <div className="text-[9px] font-mono text-muted-foreground/50 uppercase">P&L</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-mono font-black">
                <span className="text-emerald-400">{wins}</span>
                <span className="text-muted-foreground/40">/</span>
                <span className="text-red-400">{losses}</span>
              </div>
              <div className="text-[9px] font-mono text-muted-foreground/50 uppercase">W/L</div>
            </div>
          </div>
          <div className="space-y-1 max-h-[120px] overflow-y-auto">
            {todayTrades.map(t => (
              <div key={t.id} className="flex items-center justify-between text-[10px] font-mono py-0.5">
                <div className="flex items-center gap-2">
                  <span className={t.result === "win" ? "text-emerald-400" : t.result === "loss" ? "text-red-400" : "text-muted-foreground"}>
                    {t.result === "win" ? "▲" : t.result === "loss" ? "▼" : "●"}
                  </span>
                  <span className="text-foreground/80">{t.ticker}</span>
                  {t.setup && <span className="text-muted-foreground/40">{t.setup}</span>}
                </div>
                <span className={t.pnl && t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}${t.pnl}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CreateSessionForm({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const createSession = useCreateWarRoomSession();
  const [eventName, setEventName] = useState("");
  const [eventTime, setEventTime] = useState("");

  const handleCreate = () => {
    if (!eventName || !eventTime) return;
    createSession.mutate(
      {
        data: {
          eventName,
          eventTime: new Date(eventTime).toISOString(),
          trader: user?.traderName || null,
          checklist: DEFAULT_CHECKLIST,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetActiveWarRoomQueryKey() });
          qc.invalidateQueries({ queryKey: getListWarRoomSessionsQueryKey() });
          onCreated();
        },
      }
    );
  };

  return (
    <div className="flex flex-col items-center justify-center gap-8 max-w-lg mx-auto">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <Shield className="h-16 w-16 text-orange-500" />
          <div className="absolute inset-0 animate-ping opacity-20">
            <Shield className="h-16 w-16 text-orange-500" />
          </div>
        </div>
        <h2 className="text-2xl font-mono font-black text-orange-400 tracking-tight">WAR ROOM</h2>
        <p className="text-xs font-mono text-muted-foreground/60 text-center">
          Режим фокусировки для горячих рыночных моментов
        </p>
      </div>
      <div className="w-full space-y-4">
        <div>
          <label className="text-[10px] font-mono uppercase text-orange-400/60 tracking-widest mb-1 block">Событие</label>
          <Input
            value={eventName}
            onChange={e => setEventName(e.target.value)}
            placeholder="FOMC Decision / AAPL Earnings / NFP Report..."
            className="war-room-input h-10 text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase text-orange-400/60 tracking-widest mb-1 block">Время события</label>
          <Input
            type="datetime-local"
            value={eventTime}
            onChange={e => setEventTime(e.target.value)}
            className="war-room-input h-10 text-sm"
          />
        </div>
        <Button
          onClick={handleCreate}
          disabled={!eventName || !eventTime}
          className="w-full h-12 bg-orange-500/20 text-orange-400 border-2 border-orange-500/40 hover:bg-orange-500/30 hover:border-orange-500/60 font-mono font-bold text-sm uppercase tracking-wider transition-all"
        >
          <Shield className="h-4 w-4 mr-2" />
          Активировать War Room
        </Button>
      </div>
    </div>
  );
}

export default function WarRoom({ onExit }: { onExit: () => void }) {
  const { data: activeSession, isLoading } = useGetActiveWarRoom();
  const { data: big7Levels } = useListBig7Levels();
  const qc = useQueryClient();
  const updateSession = useUpdateWarRoomSession();
  const [showCreate, setShowCreate] = useState(false);

  const session = activeSession as WarRoomSessionWithLevels | null;

  const handleEnd = () => {
    if (!session) return;
    updateSession.mutate(
      { id: session.id, data: { endedAt: new Date().toISOString() } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetActiveWarRoomQueryKey() });
          qc.invalidateQueries({ queryKey: getListWarRoomSessionsQueryKey() });
          onExit();
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="war-room-overlay flex items-center justify-center">
        <div className="animate-pulse text-orange-400 font-mono">Загрузка...</div>
      </div>
    );
  }

  if (!session && !showCreate) {
    return (
      <div className="war-room-overlay">
        <div className="war-room-header">
          <button onClick={onExit} className="flex items-center gap-2 text-xs font-mono text-muted-foreground/60 hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Назад
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <CreateSessionForm onCreated={() => setShowCreate(false)} />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="war-room-overlay flex items-center justify-center">
        <CreateSessionForm onCreated={() => setShowCreate(false)} />
      </div>
    );
  }

  return (
    <div className="war-room-overlay">
      <div className="war-room-header">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Shield className="h-5 w-5 text-orange-500" />
            <div className="absolute inset-0 animate-ping opacity-30">
              <Shield className="h-5 w-5 text-orange-500" />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-mono font-black text-orange-400 tracking-tight uppercase">{session.eventName}</h2>
            <span className="text-[9px] font-mono text-muted-foreground/50">
              {new Date(session.eventTime).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>
          <div className="ml-2 war-room-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleEnd}
            variant="ghost"
            className="h-8 px-3 text-xs font-mono text-red-400 border border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
          >
            <X className="h-3 w-3 mr-1" /> Завершить
          </Button>
          <Button
            onClick={onExit}
            variant="ghost"
            className="h-8 px-3 text-xs font-mono text-muted-foreground border border-border/30 hover:bg-muted/20"
          >
            <ArrowLeft className="h-3 w-3 mr-1" /> Свернуть
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-center mb-6">
            <CountdownTimer eventTime={session.eventTime} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-4">
              <LevelsPanel session={session} big7Levels={(big7Levels as any[]) || []} />
              <TodayTradesWidget />
            </div>
            <div className="space-y-4">
              <NotesPanel session={session} />
            </div>
            <div className="space-y-4">
              <ChecklistPanel session={session} />
            </div>
          </div>
        </div>
      </div>

      <div className="war-room-footer">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3 w-3 text-orange-400/50" />
          <span className="text-[9px] font-mono text-orange-400/40 uppercase tracking-wider">
            High Volatility Mode Active
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="h-3 w-3 text-orange-400/40 animate-pulse" />
          <span className="text-[9px] font-mono text-muted-foreground/30">
            Session started {new Date(session.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </div>
  );
}
