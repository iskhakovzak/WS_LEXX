import React, { useState, useEffect } from "react";
import { Activity, List, MessageSquare, BookOpen, Clock, Eye, BookMarked, Zap, Pencil, Trash2, ThumbsUp, Star } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type ActivityItem = {
  id: number;
  action: string;
  section: string;
  entityId?: string;
  entityTitle?: string;
  trader?: string;
  details?: string;
  createdAt: string;
};

const sectionIcons: Record<string, React.ElementType> = {
  trades: List,
  discussions: MessageSquare,
  research: BookOpen,
  dailyfeed: Clock,
  events: Zap,
  watchlist: Eye,
  playbook: BookMarked,
};

const sectionLabels: Record<string, string> = {
  trades: "Трейды",
  discussions: "Обсуждения",
  research: "Исследования",
  dailyfeed: "Дневной фид",
  events: "События",
  watchlist: "Вотчлист",
  playbook: "Плейбук",
};

const actionIcons: Record<string, React.ElementType> = {
  created: Activity,
  updated: Pencil,
  deleted: Trash2,
  liked: ThumbsUp,
  reviewed: Star,
};

const actionColors: Record<string, string> = {
  created: "text-emerald-400",
  updated: "text-primary",
  deleted: "text-red-400",
  liked: "text-yellow-400",
  reviewed: "text-violet-400",
};

const actionLabels: Record<string, string> = {
  created: "создал",
  updated: "обновил",
  deleted: "удалил",
  liked: "лайкнул",
  reviewed: "оставил review",
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} дн назад`;
  return d.toLocaleDateString("ru-RU");
}

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch(`${BASE}/api/activity`)
      .then((r) => r.json())
      .then((data) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? items : items.filter((i) => i.section === filter);
  const sections = ["all", ...new Set(items.map((i) => i.section))];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Лента Активности</h1>
      </div>

      <div className="flex gap-0 border border-border overflow-x-auto">
        {sections.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 text-xs font-mono uppercase whitespace-nowrap border-r border-border last:border-r-0 transition-colors ${filter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
            {s === "all" ? "Все" : sectionLabels[s] ?? s}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        {filtered.map((item) => {
          const SectionIcon = sectionIcons[item.section] || Activity;
          const ActionIcon = actionIcons[item.action] || Activity;
          const color = actionColors[item.action] || "text-muted-foreground";
          return (
            <div key={item.id} className={`flex items-start gap-3 px-4 py-3 bg-card border border-border hover:bg-muted/30 transition-colors border-l-[3px] ${
              item.action === "created" ? "border-l-emerald-500/40" :
              item.action === "updated" ? "border-l-amber-500/40" :
              item.action === "deleted" ? "border-l-red-500/40" :
              "border-l-primary/30"
            }`}>
              <div className={`mt-0.5 ${color}`}>
                <ActionIcon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.trader && <span className="text-primary font-bold text-xs font-mono">{item.trader}</span>}
                  <span className="text-muted-foreground text-xs font-mono">{actionLabels[item.action] ?? item.action}</span>
                  <span className="text-xs font-mono flex items-center gap-1 text-muted-foreground">
                    <SectionIcon className="h-3 w-3" />
                    {sectionLabels[item.section] ?? item.section}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {item.entityTitle && <span className="text-foreground font-bold text-sm font-mono">{item.entityTitle}</span>}
                  {item.details && <span className="text-muted-foreground text-xs font-mono">{item.details}</span>}
                </div>
              </div>
              <span className="text-muted-foreground text-xs font-mono whitespace-nowrap shrink-0">{timeAgo(item.createdAt)}</span>
            </div>
          );
        })}
        {filtered.length === 0 && !loading && (
          <div className="py-12 text-center text-muted-foreground text-xs font-mono">Пока нет активности</div>
        )}
      </div>
    </div>
  );
}
