import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { Star, Plus, Trophy, TrendingUp, Shield, BookOpen, Target, Sparkles, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");




type Rating = {
  id: number; trader: string; curator: string; week: string;
  discipline: number; riskManagement: number; execution: number;
  journaling: number; improvement: number; overall: number;
  comment: string | null; createdAt: string;
};

type Summary = {
  trader: string; avgDiscipline: number; avgRiskManagement: number;
  avgExecution: number; avgJournaling: number; avgImprovement: number;
  avgOverall: number; totalRatings: number;
};

const CATEGORIES = [
  { key: "discipline", label: "Дисциплина", icon: Shield, color: "text-blue-400" },
  { key: "riskManagement", label: "Риск менеджмент", icon: Target, color: "text-red-400" },
  { key: "execution", label: "Исполнение", icon: Sparkles, color: "text-cyan-400" },
  { key: "journaling", label: "Журналирование", icon: BookOpen, color: "text-amber-400" },
  { key: "improvement", label: "Прогресс", icon: TrendingUp, color: "text-emerald-400" },
  { key: "overall", label: "Общая оценка", icon: Star, color: "text-yellow-400" },
] as const;

function getWeekString(d: Date = new Date()) {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay() + 1);
  return start.toISOString().slice(0, 10);
}

function ScoreBar({ value, max = 10 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = value >= 8 ? "bg-emerald-500" : value >= 5 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono font-bold w-6 text-right">{value}</span>
    </div>
  );
}

function ScoreInput({ value, onChange, label, icon: Icon, color }: { value: number; onChange: (v: number) => void; label: string; icon: React.ElementType; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3 w-3 ${color}`} />
        <span className="text-[10px] font-mono uppercase text-muted-foreground">{label}</span>
        <span className="ml-auto font-mono font-bold text-xs">{value}/10</span>
      </div>
      <input type="range" min="1" max="10" value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-primary cursor-pointer" />
    </div>
  );
}

export default function RatingsPage() {
  const { user, isCurator, dbUsers } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedTrader, setSelectedTrader] = useState<string>("all");
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);

  const allTraderNames = dbUsers.filter((u) => u.active).map((u) => u.name);
  const ratingTraders = dbUsers.filter((u) => u.active && u.role !== "curator").map((u) => u.name);

  const [form, setForm] = useState({
    trader: "",
    week: getWeekString(),
    discipline: 5, riskManagement: 5, execution: 5,
    journaling: 5, improvement: 5, overall: 5,
    comment: "",
  });

  const { data: ratings = [] } = useQuery<Rating[]>({
    queryKey: ["ratings", selectedTrader],
    queryFn: () => {
      const params = selectedTrader !== "all" ? `?trader=${encodeURIComponent(selectedTrader)}` : "";
      return fetch(`${BASE}/api/ratings${params}`).then((r) => r.json());
    },
    staleTime: 0, gcTime: 0,
  });

  const { data: summary = [] } = useQuery<Summary[]>({
    queryKey: ["ratings-summary"],
    queryFn: () => fetch(`${BASE}/api/ratings/summary`).then((r) => r.json()),
    staleTime: 0, gcTime: 0,
  });

  const createMut = useMutation({
    mutationFn: (data: typeof form) =>
      fetch(`${BASE}/api/ratings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, curator: user?.traderName }),
      }).then((r) => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      qc.invalidateQueries({ queryKey: ["ratings-summary"] });
      setOpen(false);
      toast({ title: "Оценка сохранена" });
    },
    onError: () => toast({ title: "Ошибка сохранения", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`${BASE}/api/ratings/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      qc.invalidateQueries({ queryKey: ["ratings-summary"] });
    },
  });

  const byWeek = useMemo(() => {
    const map = new Map<string, Rating[]>();
    for (const r of ratings) {
      if (!map.has(r.week)) map.set(r.week, []);
      map.get(r.week)!.push(r);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [ratings]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-400" /> Оценки трейдеров
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            Еженедельная система оценки от кураторов
          </p>
        </div>
        {isCurator && (
          <Button onClick={() => { setForm((f) => ({ ...f, week: getWeekString() })); setOpen(true); }} className="font-mono uppercase tracking-tight text-xs gap-1">
            <Plus className="h-3 w-3" /> Оценить трейдера
          </Button>
        )}
      </div>

      {summary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {summary.map((s) => (
            <div key={s.trader} className="bg-card border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm font-mono text-foreground">{s.trader}</span>
                <div className="flex items-center gap-1">
                  <Star className={`h-3.5 w-3.5 ${s.avgOverall >= 8 ? "text-yellow-400 fill-yellow-400" : s.avgOverall >= 5 ? "text-amber-400" : "text-red-400"}`} />
                  <span className="font-mono font-bold text-sm">{s.avgOverall.toFixed(1)}</span>
                </div>
              </div>
              {CATEGORIES.slice(0, 5).map((cat) => {
                const key = `avg${cat.key[0].toUpperCase()}${cat.key.slice(1)}` as keyof Summary;
                return (
                  <div key={cat.key} className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <cat.icon className={`h-2.5 w-2.5 ${cat.color}`} />
                      <span className="text-[9px] font-mono uppercase text-muted-foreground">{cat.label}</span>
                    </div>
                    <ScoreBar value={Number(s[key]) || 0} />
                  </div>
                );
              })}
              <div className="text-[9px] font-mono text-muted-foreground/60 pt-1 border-t border-border/50">
                {s.totalRatings} оценок
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap items-center">
        <button onClick={() => setSelectedTrader("all")}
          className={`px-2 py-1 text-[10px] font-mono border transition-colors ${selectedTrader === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
          Все
        </button>
        {allTraderNames.map((t) => (
          <button key={t} onClick={() => setSelectedTrader(t)}
            className={`px-2 py-1 text-[10px] font-mono border transition-colors ${selectedTrader === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {byWeek.length === 0 && (
        <div className="border border-border bg-card p-16 text-center text-muted-foreground text-xs font-mono">
          Пока нет оценок.{isCurator ? " Нажмите «Оценить трейдера» чтобы начать." : ""}
        </div>
      )}

      <div className="space-y-2">
        {byWeek.map(([week, items]) => {
          const isExp = expandedWeek === week;
          return (
            <div key={week} className="bg-card border border-border">
              <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedWeek(isExp ? null : week)}>
                <div className="flex items-center gap-3">
                  {isExp ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                  <span className="font-bold text-xs font-mono text-foreground">Неделя {week}</span>
                  <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 text-muted-foreground">{items.length} оценок</span>
                </div>
              </div>
              {isExp && (
                <div className="border-t border-border p-3 space-y-2">
                  {items.map((r) => (
                    <div key={r.id} className="bg-muted/20 border border-border/50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm font-mono text-foreground">{r.trader}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">от {r.curator}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                            <span className="font-mono font-bold text-sm">{r.overall}/10</span>
                          </div>
                          {isCurator && r.curator === user?.traderName && (
                            <button onClick={() => deleteMut.mutate(r.id)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {CATEGORIES.slice(0, 5).map((cat) => (
                          <div key={cat.key} className="space-y-0.5">
                            <div className="flex items-center gap-1">
                              <cat.icon className={`h-2.5 w-2.5 ${cat.color}`} />
                              <span className="text-[9px] font-mono uppercase text-muted-foreground">{cat.label}</span>
                            </div>
                            <ScoreBar value={(r as any)[cat.key]} />
                          </div>
                        ))}
                      </div>
                      {r.comment && (
                        <div className="text-xs font-mono text-foreground/80 bg-background/50 px-3 py-2 border border-border/30 whitespace-pre-wrap">
                          {r.comment}
                        </div>
                      )}
                      <div className="text-[9px] font-mono text-muted-foreground/50">
                        {new Date(r.createdAt).toLocaleString("ru-RU")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-tight flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-400" /> Оценить трейдера
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Трейдер</label>
              <select value={form.trader} onChange={(e) => setForm((f) => ({ ...f, trader: e.target.value }))}
                className="w-full h-8 px-2 text-xs font-mono bg-background border border-input text-foreground rounded-none">
                {ratingTraders.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Неделя</label>
              <Input type="date" value={form.week} onChange={(e) => setForm((f) => ({ ...f, week: e.target.value }))}
                className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-3 pt-1">
              {CATEGORIES.map((cat) => (
                <ScoreInput key={cat.key} value={(form as any)[cat.key]} onChange={(v) => setForm((f) => ({ ...f, [cat.key]: v }))}
                  label={cat.label} icon={cat.icon} color={cat.color} />
              ))}
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Комментарий</label>
              <Textarea value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                rows={3} className="font-mono bg-background text-xs resize-none" placeholder="Что хорошо, что нужно улучшить..." />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-mono uppercase text-xs">Отмена</Button>
            <Button onClick={() => createMut.mutate(form)} disabled={!form.trader || createMut.isPending}
              className="font-mono uppercase text-xs">
              {createMut.isPending ? "Сохраняем..." : "Сохранить оценку"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
