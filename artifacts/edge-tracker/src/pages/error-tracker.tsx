import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Plus, CheckCircle2, XCircle, Lightbulb, Trash2, ChevronDown, ChevronUp, Filter } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const ERROR_TYPES = [
  "Ранний вход", "Поздний вход", "Не поставил стоп", "Двигал стоп",
  "Переторговка", "FOMO", "Revenge trading", "Слишком большой размер",
  "Не дождался подтверждения", "Игнорировал план", "Паника при просадке",
  "Удержание убыточной", "Другое"
];

const SEVERITIES = [
  { value: "low", label: "Низкая", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  { value: "medium", label: "Средняя", color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
  { value: "high", label: "Высокая", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
  { value: "critical", label: "Критичная", color: "text-red-400 bg-red-500/10 border-red-500/20" },
];

type TradingError = {
  id: number;
  trader: string;
  errorType: string;
  description: string;
  ticker?: string;
  tradeId?: number;
  severity: string;
  lesson?: string;
  resolved: string;
  createdAt: string;
};

type Stats = {
  total: number;
  resolved: number;
  unresolved: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  topErrors: [string, number][];
};

export default function ErrorTracker() {
  const { user } = useAuth();
  const traderName = user?.role === "trader" ? user.traderName : "Guest";

  const [errors, setErrors] = useState<TradingError[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterResolved, setFilterResolved] = useState("all");
  const [lessonEditing, setLessonEditing] = useState<number | null>(null);
  const [lessonText, setLessonText] = useState("");

  const [form, setForm] = useState({
    errorType: ERROR_TYPES[0],
    description: "",
    ticker: "",
    severity: "medium",
    lesson: "",
  });

  async function load() {
    try {
      const [errRes, statsRes] = await Promise.all([
        fetch(`${BASE}/api/errors?trader=${encodeURIComponent(traderName)}`),
        fetch(`${BASE}/api/errors/stats?trader=${encodeURIComponent(traderName)}`),
      ]);
      if (errRes.ok) setErrors(await errRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {}
  }

  useEffect(() => { load(); }, [traderName]);

  async function submit() {
    if (!form.description.trim()) return;
    await fetch(`${BASE}/api/errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trader: traderName, ...form }),
    });
    setForm({ errorType: ERROR_TYPES[0], description: "", ticker: "", severity: "medium", lesson: "" });
    setShowForm(false);
    load();
  }

  async function toggleResolved(id: number, current: string) {
    await fetch(`${BASE}/api/errors/${id}?trader=${encodeURIComponent(traderName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: current === "yes" ? "no" : "yes" }),
    });
    load();
  }

  async function saveLesson(id: number) {
    await fetch(`${BASE}/api/errors/${id}?trader=${encodeURIComponent(traderName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson: lessonText }),
    });
    setLessonEditing(null);
    load();
  }

  async function deleteError(id: number) {
    if (!confirm("Удалить ошибку?")) return;
    await fetch(`${BASE}/api/errors/${id}?trader=${encodeURIComponent(traderName)}`, { method: "DELETE" });
    load();
  }

  const filtered = errors.filter((e) => {
    if (filterType !== "all" && e.errorType !== filterType) return false;
    if (filterResolved === "yes" && e.resolved !== "yes") return false;
    if (filterResolved === "no" && e.resolved !== "no") return false;
    return true;
  });

  const sevInfo = (s: string) => SEVERITIES.find((v) => v.value === s) || SEVERITIES[1];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-yellow-400" />
          Трекер Ошибок
        </h1>
        <Button onClick={() => setShowForm(!showForm)} className="bg-primary text-primary-foreground font-mono text-xs">
          <Plus className="h-4 w-4 mr-1" /> Записать ошибку
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground font-mono uppercase">Всего</div>
              <div className="text-2xl font-bold font-mono text-foreground">{stats.total}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground font-mono uppercase">Нерешённые</div>
              <div className="text-2xl font-bold font-mono text-red-400">{stats.unresolved}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground font-mono uppercase">Решённые</div>
              <div className="text-2xl font-bold font-mono text-emerald-400">{stats.resolved}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground font-mono uppercase">Топ ошибка</div>
              <div className="text-sm font-bold font-mono text-yellow-400 truncate">
                {stats.topErrors.length > 0 ? `${stats.topErrors[0][0]} (${stats.topErrors[0][1]})` : "—"}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {stats && stats.topErrors.length > 1 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase">Частые ошибки</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-2">
              {stats.topErrors.map(([type, count]) => (
                <div key={type} className="flex items-center gap-3">
                  <div className="flex-1 font-mono text-xs text-foreground">{type}</div>
                  <div className="w-32 bg-muted h-2 overflow-hidden">
                    <div className="bg-yellow-500 h-full" style={{ width: `${(count / stats.total) * 100}%` }} />
                  </div>
                  <div className="text-xs font-mono text-muted-foreground w-8 text-right">{count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card className="bg-card border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-mono text-muted-foreground uppercase block mb-1">Тип ошибки</label>
                <select value={form.errorType} onChange={(e) => setForm({ ...form, errorType: e.target.value })}
                  className="w-full bg-background border border-border text-xs font-mono px-2 py-1.5 text-foreground">
                  {ERROR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground uppercase block mb-1">Тикер</label>
                <input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                  placeholder="AAPL" className="w-full bg-background border border-border text-xs font-mono px-2 py-1.5 text-foreground" />
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground uppercase block mb-1">Серьёзность</label>
                <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}
                  className="w-full bg-background border border-border text-xs font-mono px-2 py-1.5 text-foreground">
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground uppercase block mb-1">Описание</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                placeholder="Что произошло..." className="w-full bg-background border border-border text-xs font-mono px-2 py-1.5 resize-none text-foreground" />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground uppercase block mb-1">Урок / вывод</label>
              <textarea value={form.lesson} onChange={(e) => setForm({ ...form, lesson: e.target.value })} rows={2}
                placeholder="Что я из этого вынес..." className="w-full bg-background border border-border text-xs font-mono px-2 py-1.5 resize-none text-foreground" />
            </div>
            <div className="flex gap-2">
              <Button onClick={submit} className="bg-primary text-primary-foreground font-mono text-xs">Сохранить</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)} className="font-mono text-xs">Отмена</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="bg-background border border-border text-xs font-mono px-2 py-1 text-foreground">
          <option value="all">Все типы</option>
          {ERROR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterResolved} onChange={(e) => setFilterResolved(e.target.value)}
          className="bg-background border border-border text-xs font-mono px-2 py-1 text-foreground">
          <option value="all">Все</option>
          <option value="no">Нерешённые</option>
          <option value="yes">Решённые</option>
        </select>
        <span className="text-xs text-muted-foreground font-mono ml-auto">{filtered.length} записей</span>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground font-mono text-sm">
            {errors.length === 0 ? "Ошибок пока нет. Отлично! Или запишите первую." : "Нет результатов по фильтру."}
          </div>
        )}
        {filtered.map((e) => {
          const sev = sevInfo(e.severity);
          const isExpanded = expanded === e.id;
          return (
            <div key={e.id} className={`border ${e.resolved === "yes" ? "border-emerald-500/20 bg-emerald-500/5" : "border-border bg-card"} transition-colors`}>
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : e.id)}>
                <button onClick={(ev) => { ev.stopPropagation(); toggleResolved(e.id, e.resolved); }}
                  className={`shrink-0 ${e.resolved === "yes" ? "text-emerald-400" : "text-muted-foreground hover:text-emerald-400"}`}
                  title={e.resolved === "yes" ? "Пометить нерешённой" : "Пометить решённой"}>
                  {e.resolved === "yes" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                </button>
                <span className={`text-xs font-mono px-1.5 py-0.5 border ${sev.color}`}>{sev.label}</span>
                <span className="text-xs font-mono font-bold text-foreground">{e.errorType}</span>
                {e.ticker && <span className="text-xs font-mono text-primary">${e.ticker}</span>}
                <span className="text-xs text-muted-foreground font-mono ml-auto hidden md:inline">{e.createdAt.substring(0, 10)}</span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/50">
                  <div className="pt-3 text-xs font-mono text-foreground whitespace-pre-wrap">{e.description}</div>

                  {e.lesson && lessonEditing !== e.id && (
                    <div className="flex gap-2 items-start p-2 bg-emerald-500/5 border border-emerald-500/20">
                      <Lightbulb className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="text-xs font-mono text-emerald-300 flex-1">{e.lesson}</div>
                      <button onClick={() => { setLessonEditing(e.id); setLessonText(e.lesson || ""); }}
                        className="text-muted-foreground hover:text-foreground text-xs font-mono">ред.</button>
                    </div>
                  )}

                  {lessonEditing === e.id && (
                    <div className="space-y-2">
                      <textarea value={lessonText} onChange={(ev) => setLessonText(ev.target.value)} rows={2}
                        className="w-full bg-background border border-border text-xs font-mono px-2 py-1.5 resize-none text-foreground"
                        placeholder="Какой урок вынес..." />
                      <div className="flex gap-2">
                        <button onClick={() => saveLesson(e.id)} className="text-xs font-mono text-primary hover:underline">Сохранить</button>
                        <button onClick={() => setLessonEditing(null)} className="text-xs font-mono text-muted-foreground hover:underline">Отмена</button>
                      </div>
                    </div>
                  )}

                  {!e.lesson && lessonEditing !== e.id && (
                    <button onClick={() => { setLessonEditing(e.id); setLessonText(""); }}
                      className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-emerald-400">
                      <Lightbulb className="h-3 w-3" /> Добавить урок
                    </button>
                  )}

                  <div className="flex gap-3 items-center">
                    <span className="text-xs text-muted-foreground font-mono">{e.createdAt.substring(0, 10)}</span>
                    <button onClick={() => deleteError(e.id)} className="ml-auto text-muted-foreground hover:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
