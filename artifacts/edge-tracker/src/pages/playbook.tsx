import React, { useState, useMemo, useEffect, useRef } from "react";
import { WriteOnly, useAuth } from "@/contexts/auth-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, CheckSquare, ChevronDown, ChevronUp, Tag, Folder, FolderOpen, FolderPlus, Link2, Unlink, TrendingUp, GripVertical, ChevronsDown, ChevronsUp, ExternalLink, BookOpen, X, Check, Clock, Activity, Search, Copy, Palette } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls, screenshotNotesToString, stringToScreenshotNotes } from "@/components/screenshot-fields";
import { TRADE_TAGS, type TagSubgroup } from "@/lib/tags";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const SETUP_TYPES = [
  // SMB Capital Core 20
  "Opening Drive", "Second Day Play", "Opening Consolidation",
  "Gap and Go", "Flag / Pennant", "Breakout Trade", "Explosive Move", "Flipping",
  "Fade Trade", "Stuffed Trade", "Bounce Trade", "Biotech Fade",
  "Support Play", "Pullback Trade", "2D VWAP Trade", "Relative Strength Trade",
  "Fundamental / Catalyst Trade", "IPO Trade", "IPO Day Trade", "Secondary Offering Trade", "Special Dividend Trade",
  // SMB Advanced
  "Dr. S Trade", "Market Play", "Scalp Trade", "Opening Volatility Collapse",
  "Big Bid / Catalyst Trade", "ABCD Pattern",
  // Gap plays
  "Gap", "Gap Up", "Gap Down", "Gap and Go Long", "Gap and Go Short", "Gap Fill",
  "Earnings Gap Up", "Earnings Gap Down", "Earnings Gap Down Short",
  // Breakout / Continuation
  "Breakout", "Retest", "Trend Continuation", "Bull Flag", "Bear Flag",
  "ORB", "ORB 5min", "ORB 15min", "ORB 30min",
  "Narrow Range Break (NR7)", "Flat Top Breakout", "Cup and Handle",
  // Momentum
  "Intraday Momentum", "Momentum Ignition", "Volume Pocket Pivot",
  "Parabolic Run", "Runner",
  // Short setups
  "Short", "Parabolic Short", "HOD Failure", "Dead Cat Bounce", "Failed Follow Through",
  "Short Squeeze", "Overextended Short", "Blow-Off Top Short",
  // Reversal
  "Reversal", "Red to Green", "Green to Red", "Reddog Reversal",
  "V-Bottom Reversal", "Double Bottom", "Double Top",
  "Hammer Capitulation Buy", "Key Reversal Day",
  // Support / Resistance
  "Support", "Resistance", "Scalp",
  // Mean Reversion / Stat Arb
  "Mean Reversion", "Pairs Trade", "ETF Arbitrage", "Relative Value",
  // Auction / Order Flow / OPG / IMBX / MOC
  "OPG", "OPG Gap Fade", "OPG Momentum",
  "Imbalance", "Opening Imbalance (OPG)", "IMBX Long", "IMBX Short", "IMBX Fade", "IMBX + VWAP",
  "MOC", "MOC Imbalance", "MOC Fade", "MOC Pin Risk", "Closing Cross Play",
  "Liquidity Sweep", "Dark Pool Print",
  // Prop Desk Specialty
  "Halt & Resume", "Sympathy Play", "Sector Rotation Play",
  "Earnings Drift (PEAD)", "Pre-Earnings Run", "Post-Earnings Continuation",
  "Basket Trade", "Hedged Swing", "Macro Play",
  // Other
  "Другой",
];
const SOURCE_LABELS: Record<string, string> = { trade: "Трейд", research: "Ресёрч", dailyfeed: "Дневная лента", event: "Событие" };

function getSetupColor(type: string | null | undefined): string {
  if (!type) return "bg-muted text-muted-foreground border-border";
  const t = type.toLowerCase();
  if (t.includes("gap") || t.includes("earnings gap")) return "bg-green-500/15 text-green-400 border-green-500/30";
  if (t.includes("short") || t.includes("fade") || t.includes("parabolic") || t.includes("hod fail") || t.includes("dead cat") || t.includes("blow-off") || t.includes("exhaustion")) return "bg-red-500/15 text-red-400 border-red-500/30";
  if (t.includes("breakout") || t.includes("flag") || t.includes("orb") || t.includes("range") || t.includes("flat top") || t.includes("cup") || t.includes("triangle") || t.includes("wedge")) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (t.includes("momentum") || t.includes("explosive") || t.includes("power") || t.includes("run") || t.includes("acceleration")) return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
  if (t.includes("reversal") || t.includes("red to") || t.includes("green to") || t.includes("reddog") || t.includes("bottom") || t.includes("top") || t.includes("hammer") || t.includes("star") || t.includes("bounce") || t.includes("stuffed")) return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  if (t.includes("vwap")) return "bg-teal-500/15 text-teal-400 border-teal-500/30";
  if (t.includes("mean") || t.includes("pairs") || t.includes("arb") || t.includes("relative value") || t.includes("bollinger") || t.includes("rsi")) return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  if (t.includes("imbalance") || t.includes("moc") || t.includes("opg") || t.includes("closing") || t.includes("dark pool") || t.includes("liquidity") || t.includes("block")) return "bg-violet-500/15 text-violet-400 border-violet-500/30";
  if (t.includes("ipo") || t.includes("offering") || t.includes("dividend")) return "bg-purple-500/15 text-purple-400 border-purple-500/30";
  if (t.includes("opening drive") || t.includes("second day") || t.includes("consolidation") || t.includes("flipping") || t.includes("support play") || t.includes("pullback") || t.includes("relative strength") || t.includes("catalyst trade") || t.includes("dr. s") || t.includes("market play") || t.includes("scalp") || t.includes("volatility collapse") || t.includes("big bid") || t.includes("abcd")) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (t.includes("halt") || t.includes("sympathy") || t.includes("sector") || t.includes("earnings drift") || t.includes("basket") || t.includes("hedged") || t.includes("macro") || t.includes("swing")) return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return "bg-muted text-muted-foreground border-border";
}
const SETUP_DEFAULT_COLOR = "bg-muted text-muted-foreground border-border";

const FOLDER_COLORS: Record<string, string> = {
  "Earnings Plays": "border-l-emerald-500",
  "Intraday Momentum": "border-l-cyan-500",
  "Short Setups": "border-l-red-500",
  "Breakout Patterns": "border-l-amber-500",
  "IPO / SPO Plays": "border-l-purple-500",
  "Macro / Event Plays": "border-l-blue-500",
  "Risk Management": "border-l-yellow-500",
};
const FOLDER_ICON_COLORS: Record<string, string> = {
  "Earnings Plays": "text-emerald-400",
  "Intraday Momentum": "text-cyan-400",
  "Short Setups": "text-red-400",
  "Breakout Patterns": "text-amber-400",
  "IPO / SPO Plays": "text-purple-400",
  "Macro / Event Plays": "text-blue-400",
  "Risk Management": "text-yellow-400",
};

const FOLDER_COLOR_PALETTE = [
  { label: "Янтарный",    border: "border-l-amber-500",       icon: "text-amber-400",       dot: "bg-amber-400" },
  { label: "Изумрудный",  border: "border-l-emerald-500",     icon: "text-emerald-400",     dot: "bg-emerald-400" },
  { label: "Голубой",     border: "border-l-cyan-500",        icon: "text-cyan-400",        dot: "bg-cyan-400" },
  { label: "Красный",     border: "border-l-red-500",         icon: "text-red-400",         dot: "bg-red-400" },
  { label: "Фиолетовый",  border: "border-l-purple-500",      icon: "text-purple-400",      dot: "bg-purple-400" },
  { label: "Синий",       border: "border-l-blue-500",        icon: "text-blue-400",        dot: "bg-blue-400" },
  { label: "Розовый",     border: "border-l-pink-500",        icon: "text-pink-400",        dot: "bg-pink-400" },
  { label: "Индиго",      border: "border-l-indigo-500",      icon: "text-indigo-400",      dot: "bg-indigo-400" },
  { label: "Жёлтый",     border: "border-l-yellow-500",      icon: "text-yellow-400",      dot: "bg-yellow-400" },
  { label: "Оранжевый",   border: "border-l-orange-500",      icon: "text-orange-400",      dot: "bg-orange-400" },
  { label: "Чал",         border: "border-l-teal-500",        icon: "text-teal-400",        dot: "bg-teal-400" },
  { label: "Серый",       border: "border-l-muted-foreground",icon: "text-muted-foreground", dot: "bg-muted-foreground" },
];

function loadFolderColors(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem("playbook-folder-colors") || "{}"); }
  catch { return {}; }
}
function saveFolderColors(colors: Record<string, number>) {
  localStorage.setItem("playbook-folder-colors", JSON.stringify(colors));
}

type PlaybookEntry = {
  id: number; name: string; folder: string | null; setupType: string | null; conditions: string | null;
  checklist: string | null; notes: string | null; confidenceLevel: number | null;
  screenshotUrl: string | null; screenshotNotes: string | null; tags: string | null;
  sourceType: string | null; sourceId: number | null; createdAt: string;
  parentId: number | null;
};

type LinkedTrade = {
  id: number; ticker: string; date: string; side: string | null; result: string;
  pnl: number | null; rMultiple: number | null; setup: string | null; trader: string | null; playbookId: number | null;
};
type FormData = {
  name: string; folder: string; setupType: string; conditions: string; checklist: string;
  notes: string; confidenceLevel: string; screenshotUrls: string[]; screenshotNotes: string[]; tags: string;
};

const blank = (): FormData => ({ name: "", folder: "", setupType: "", conditions: "", checklist: "", notes: "", confidenceLevel: "70", screenshotUrls: [""], screenshotNotes: [""], tags: "" });
function entryToForm(e: PlaybookEntry): FormData {
  const urls = stringToScreenshotUrls(e.screenshotUrl);
  return { name: e.name, folder: e.folder ?? "", setupType: e.setupType ?? "", conditions: e.conditions ?? "", checklist: e.checklist ?? "", notes: e.notes ?? "", confidenceLevel: e.confidenceLevel != null ? String(e.confidenceLevel) : "70", screenshotUrls: urls, screenshotNotes: stringToScreenshotNotes(e.screenshotNotes, urls.length), tags: e.tags ?? "" };
}

function TagChips({ tags }: { tags?: string | null }) {
  if (!tags) return null;
  const chips = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {chips.map((tag, i) => (
        <span key={i} className="px-1.5 py-0 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">{tag}</span>
      ))}
    </div>
  );
}

function TagChipEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const chips = value ? value.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const [input, setInput] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const dragIdx = useRef<number | null>(null);

  const tagSearchLower = tagSearch.toLowerCase();

  type FilteredCat = [string, { name: string; groups: TagSubgroup[] }];
  const filteredCategories = useMemo((): FilteredCat[] => {
    const allCategories = Object.entries(TRADE_TAGS) as FilteredCat[];
    if (!tagSearchLower) return allCategories;
    return allCategories
      .map(([key, cat]) => {
        const filteredGroups = cat.groups
          .map((g) => ({ ...g, tags: g.tags.filter((t) => t.toLowerCase().includes(tagSearchLower)) }))
          .filter((g) => g.tags.length > 0);
        return filteredGroups.length > 0 ? [key, { ...cat, groups: filteredGroups }] as FilteredCat : null;
      })
      .filter(Boolean) as FilteredCat[];
  }, [tagSearchLower]);

  function addTag(tag?: string) {
    const t = (tag ?? input).trim();
    if (!t || chips.includes(t)) { if (!tag) setInput(""); return; }
    onChange([...chips, t].join(", "));
    if (!tag) setInput("");
  }
  function removeTag(i: number) {
    onChange(chips.filter((_, j) => j !== i).join(", "));
  }
  function toggleTemplate(tag: string) {
    if (chips.includes(tag)) {
      onChange(chips.filter((t) => t !== tag).join(", "));
    } else {
      onChange([...chips, tag].join(", "));
    }
  }
  function onDragStart(i: number) { dragIdx.current = i; }
  function onDrop(i: number) {
    if (dragIdx.current === null || dragIdx.current === i) return;
    const next = [...chips];
    const [item] = next.splice(dragIdx.current, 1);
    next.splice(i, 0, item);
    onChange(next.join(", "));
    dragIdx.current = null;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 min-h-[24px]">
        {chips.length === 0 && <span className="text-[10px] font-mono text-muted-foreground/50">Нет тегов</span>}
        {chips.map((tag, i) => (
          <span
            key={i}
            draggable
            onDragStart={() => onDragStart(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 cursor-grab select-none"
          >
            {tag}
            <button type="button" onClick={() => removeTag(i)} className="hover:text-red-400 transition-colors"><X className="h-2.5 w-2.5" /></button>
          </span>
        ))}
      </div>

      <div className="flex gap-1">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } if (e.key === ",") { e.preventDefault(); addTag(); } }}
          placeholder="Свой тег → Enter или запятая"
          className="font-mono bg-background h-7 text-xs flex-1"
        />
        <button type="button" onClick={() => addTag()} className="px-2 py-1 text-[10px] font-mono border border-border text-muted-foreground hover:text-foreground transition-colors">
          <Plus className="h-3 w-3" />
        </button>
      </div>

      <div className="border border-border/50">
        <div className="px-2 py-1 text-[9px] font-mono uppercase text-muted-foreground/60 tracking-wider border-b border-border/50 flex items-center gap-1">
          <Tag className="h-2.5 w-2.5" /> Шаблоны тегов
        </div>
        <div className="px-2 py-1.5 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
            <Input
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              placeholder="Поиск тегов..."
              className="font-mono bg-background h-6 text-[10px] pl-7 pr-6"
            />
            {tagSearch && (
              <button type="button" onClick={() => setTagSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </div>
        <div className="overflow-y-auto">
          {filteredCategories.length === 0 && (
            <div className="px-2 py-3 text-center text-[10px] font-mono text-muted-foreground/50">Ничего не найдено</div>
          )}
          {filteredCategories.map(([key, cat]) => {
            const isOpen = tagSearch ? true : openCat === key;
            const allCatTags = cat.groups.flatMap((g) => g.tags);
            const selectedCount = allCatTags.filter((t) => chips.includes(t)).length;
            return (
              <div key={key} className="border-b border-border/30 last:border-0">
                <button
                  type="button"
                  onClick={() => !tagSearch && setOpenCat(openCat === key ? null : key)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 hover:bg-muted/20 transition-colors text-left ${tagSearch ? "cursor-default" : ""}`}
                >
                  <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wide">{cat.name}</span>
                  <div className="flex items-center gap-1.5">
                    {selectedCount > 0 && (
                      <span className="text-[9px] font-mono bg-primary/20 text-primary px-1">{selectedCount}</span>
                    )}
                    {!tagSearch && (isOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />)}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-2 pb-2 grid grid-cols-3 gap-x-3 gap-y-1.5">
                    {cat.groups.map((group) => (
                      <div key={group.label}>
                        <div className="text-[10px] font-mono uppercase text-muted-foreground/50 tracking-wider mb-0.5 border-b border-border/20 pb-0.5">{group.label}</div>
                        <div className="flex flex-wrap gap-0.5">
                          {group.tags.map((tag) => {
                            const selected = chips.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTemplate(tag)}
                                className={`px-1.5 py-0.5 text-xs font-mono border transition-colors ${selected ? "bg-primary/20 text-primary border-primary/40" : "bg-transparent text-muted-foreground border-border hover:border-primary/30 hover:text-primary/80"}`}
                              >
                                {selected && <span className="mr-0.5">✓</span>}{tag}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: number | null }) {
  if (level == null) return null;
  const color = level >= 85 ? "text-emerald-400" : level >= 70 ? "text-primary" : level >= 50 ? "text-amber-400" : "text-red-400";
  const barColor = level >= 85 ? "bg-emerald-500" : level >= 70 ? "bg-primary" : level >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={`flex items-center gap-2 text-xs font-mono ${color}`}>
      <div className="w-12 h-1.5 bg-muted overflow-hidden rounded-sm">
        <div className={`h-full transition-all ${barColor}`} style={{ width: `${level}%` }} />
      </div>
      <span className="font-bold">{level}%</span>
    </div>
  );
}

function SetupTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const colorClass = getSetupColor(type);
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 border ${colorClass}`}>
      {type}
    </span>
  );
}

function ChecklistView({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  return (
    <ul className="space-y-1.5 mt-1">
      {lines.map((line, i) => (
        <li key={i} className="flex items-start gap-2 text-xs font-mono group">
          <CheckSquare className="h-3 w-3 text-emerald-500/70 mt-0.5 shrink-0" />
          <span className="text-foreground/85 leading-relaxed">{line.replace(/^[-•*]\s*/, "")}</span>
        </li>
      ))}
    </ul>
  );
}

function FolderStats({ trades }: { trades: LinkedTrade[] }) {
  if (!trades.length) return null;
  const wins = trades.filter((t) => t.result === "win").length;
  const losses = trades.filter((t) => t.result === "loss").length;
  const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0;
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono">
      <span className="text-muted-foreground">{trades.length} трейдов</span>
      <span className={winRate >= 60 ? "text-emerald-400" : winRate >= 40 ? "text-amber-400" : "text-red-400"}>
        {winRate}% WR
      </span>
      {totalPnl !== 0 && (
        <span className={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
          {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(0)}
        </span>
      )}
    </div>
  );
}

type TradeIdea = {
  id: number;
  playbook_entry_id: number;
  ticker: string;
  side: string | null;
  entry_zone: string | null;
  target: string | null;
  stop: string | null;
  status: string;
  notes: string | null;
  date: string | null;
  createdAt: string;
};

const EXAMPLE_STATUS_COLORS: Record<string, string> = {
  worked: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  partial: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  studying: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};
const EXAMPLE_STATUS_LABELS: Record<string, string> = {
  worked: "✓ отработал",
  failed: "✗ не отработал",
  partial: "~ частично",
  studying: "◉ изучаю",
};

type IdeaForm = { ticker: string; side: string; entryZone: string; target: string; stop: string; status: string; notes: string; date: string; };
const blankIdea = (): IdeaForm => ({ ticker: "", side: "Long", entryZone: "", target: "", stop: "", status: "worked", notes: "", date: new Date().toISOString().substring(0, 10) });

function SetupExamplesSection({ entryId, qc }: { entryId: number; qc: ReturnType<typeof useQueryClient> }) {
  const [ideas, setIdeas] = useState<TradeIdea[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<IdeaForm>(blankIdea());

  const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  async function fetchIdeas() {
    const r = await fetch(`${BASE_URL}/api/playbook/${entryId}/ideas`);
    if (r.ok) setIdeas(await r.json());
  }

  useEffect(() => { fetchIdeas(); }, [entryId]);

  function setF(k: keyof IdeaForm, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function saveIdea() {
    if (!form.ticker) return;
    const body = { ticker: form.ticker.toUpperCase(), side: form.side || null, entryZone: form.entryZone || null, target: form.target || null, stop: form.stop || null, status: form.status, notes: form.notes || null, date: form.date || null };
    if (editingId) {
      await fetch(`${BASE_URL}/api/playbook/${entryId}/ideas/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch(`${BASE_URL}/api/playbook/${entryId}/ideas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    fetchIdeas();
    setAdding(false);
    setEditingId(null);
    setForm(blankIdea());
  }

  async function deleteIdea(id: number) {
    await fetch(`${BASE_URL}/api/playbook/${entryId}/ideas/${id}`, { method: "DELETE" });
    fetchIdeas();
  }

  async function cycleStatus(idea: TradeIdea) {
    const statuses = ["worked", "partial", "failed", "studying"];
    const next = statuses[(statuses.indexOf(idea.status) + 1) % statuses.length];
    await fetch(`${BASE_URL}/api/playbook/${entryId}/ideas/${idea.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    fetchIdeas();
  }

  function startEdit(idea: TradeIdea) {
    setForm({ ticker: idea.ticker, side: idea.side || "Long", entryZone: idea.entry_zone || "", target: idea.target || "", stop: idea.stop || "", status: idea.status, notes: idea.notes || "", date: idea.date || "" });
    setEditingId(idea.id);
    setAdding(true);
  }

  return (
    <div className="border-t border-border/50 pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono uppercase text-emerald-400 flex items-center gap-1.5">
          <BookOpen className="h-3 w-3" />
          Примеры сетапов
          {ideas.length > 0 && <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0">{ideas.length}</span>}
        </div>
        <WriteOnly>
          <button
            onClick={() => { setForm(blankIdea()); setEditingId(null); setAdding(!adding); }}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border border-border text-muted-foreground hover:text-emerald-400 hover:border-emerald-400/40 transition-colors"
          >
            <Plus className="h-3 w-3" /> Добавить пример
          </button>
        </WriteOnly>
      </div>

      {adding && (
        <div className="bg-muted/20 border border-emerald-500/20 p-3 mb-2 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase">Тикер *</div>
              <Input value={form.ticker} onChange={(e) => setF("ticker", e.target.value.toUpperCase())} placeholder="NVDA" className="h-7 text-xs font-mono bg-background rounded-none" />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase">Направление</div>
              <Select value={form.side} onValueChange={(v) => setF("side", v)}>
                <SelectTrigger className="h-7 text-xs font-mono bg-background rounded-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Long" className="text-xs font-mono">▲ Long</SelectItem>
                  <SelectItem value="Short" className="text-xs font-mono">▼ Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase">Дата</div>
              <Input type="date" value={form.date} onChange={(e) => setF("date", e.target.value)} className="h-7 text-xs font-mono bg-background rounded-none" />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase">Результат</div>
              <Select value={form.status} onValueChange={(v) => setF("status", v)}>
                <SelectTrigger className="h-7 text-xs font-mono bg-background rounded-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EXAMPLE_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs font-mono">{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase">Вход</div>
              <Input value={form.entryZone} onChange={(e) => setF("entryZone", e.target.value)} placeholder="$142" className="h-7 text-xs font-mono bg-background rounded-none" />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase">Цель</div>
              <Input value={form.target} onChange={(e) => setF("target", e.target.value)} placeholder="$150" className="h-7 text-xs font-mono bg-background rounded-none" />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase">Стоп</div>
              <Input value={form.stop} onChange={(e) => setF("stop", e.target.value)} placeholder="$138" className="h-7 text-xs font-mono bg-background rounded-none" />
            </div>
            <div className="space-y-1 col-span-2 md:col-span-4">
              <div className="text-[10px] text-muted-foreground uppercase">Заметки — что сработало, контекст</div>
              <textarea value={form.notes} onChange={(e) => setF("notes", e.target.value)} rows={2} placeholder="Что именно отработало в этом примере? Контекст, особенности..." className="w-full bg-background border border-border text-xs font-mono p-2 resize-none focus:outline-none focus:border-emerald-400/50" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveIdea} disabled={!form.ticker} className="flex items-center gap-1 px-3 py-1 text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-40">
              <Check className="h-3 w-3" /> {editingId ? "Сохранить" : "Добавить"}
            </button>
            <button onClick={() => { setAdding(false); setEditingId(null); setForm(blankIdea()); }} className="flex items-center gap-1 px-3 py-1 text-[10px] font-mono border border-border text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" /> Отмена
            </button>
          </div>
        </div>
      )}

      {ideas.length === 0 && !adding && (
        <div className="text-[10px] font-mono text-muted-foreground/60 py-2">Нет примеров. Добавьте конкретные трейды которые отработали по этому сетапу.</div>
      )}

      <div className="space-y-1">
        {ideas.map((idea) => (
          <div key={idea.id} className="flex items-start gap-3 px-3 py-2 border border-border/40 bg-muted/5 group text-xs font-mono">
            <button onClick={() => cycleStatus(idea)} className={`px-1.5 py-0 text-[10px] border flex-shrink-0 mt-0.5 ${EXAMPLE_STATUS_COLORS[idea.status] || EXAMPLE_STATUS_COLORS.studying}`}>
              {EXAMPLE_STATUS_LABELS[idea.status] || idea.status}
            </button>
            <span className="font-bold text-foreground flex-shrink-0">{idea.ticker}</span>
            {idea.side && (
              <span className={`flex-shrink-0 ${idea.side === "Long" ? "text-emerald-400" : "text-red-400"}`}>
                {idea.side === "Long" ? "▲" : "▼"} {idea.side}
              </span>
            )}
            {idea.entry_zone && <span className="text-muted-foreground flex-shrink-0">Вход: {idea.entry_zone}</span>}
            {idea.target && <span className="text-emerald-400/70 flex-shrink-0">↑{idea.target}</span>}
            {idea.stop && <span className="text-red-400/70 flex-shrink-0">↓{idea.stop}</span>}
            {idea.date && <span className="text-muted-foreground/60 flex-shrink-0">{idea.date}</span>}
            {idea.notes && <span className="text-muted-foreground truncate min-w-0">{idea.notes}</span>}
            <div className="flex items-center gap-1 ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <WriteOnly>
                <button onClick={() => startEdit(idea)} className="p-0.5 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3 w-3" /></button>
                <button onClick={() => deleteIdea(idea.id)} className="p-0.5 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
              </WriteOnly>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubSetupsSection({ entry, allEntries, qc, openEdit }: {
  entry: PlaybookEntry; allEntries: PlaybookEntry[];
  qc: ReturnType<typeof useQueryClient>;
  openEdit: (e: PlaybookEntry) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [childForm, setChildForm] = useState<FormData>({ ...blank(), folder: entry.folder ?? "" });
  const [creatingChildFolder, setCreatingChildFolder] = useState(false);
  const [childNewFolder, setChildNewFolder] = useState("");

  const { data: children = [], refetch } = useQuery<PlaybookEntry[]>({
    queryKey: ["playbook-children", entry.id],
    queryFn: () => fetch(`${BASE}/api/playbook/${entry.id}/children`).then((r) => r.json()),
  });

  const childIds = new Set(children.map((c) => c.id));
  const available = allEntries.filter((e) =>
    e.id !== entry.id &&
    !e.parentId &&
    !childIds.has(e.id) &&
    (!search || e.name.toLowerCase().includes(search.toLowerCase()) || (e.folder || "").toLowerCase().includes(search.toLowerCase()))
  );

  async function attach(childId: number) {
    await fetch(`${BASE}/api/playbook/${childId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: entry.id }),
    });
    refetch();
    qc.invalidateQueries({ queryKey: ["playbook"] });
    setPickOpen(false);
    setSearch("");
  }

  async function detach(childId: number) {
    await fetch(`${BASE}/api/playbook/${childId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: null }),
    });
    refetch();
    qc.invalidateQueries({ queryKey: ["playbook"] });
  }

  async function createChild() {
    if (!childForm.name.trim()) return;
    const folder = creatingChildFolder ? childNewFolder.trim() : childForm.folder;
    const { screenshotUrls, screenshotNotes: sNotes, ...rest } = childForm;
    await fetch(`${BASE}/api/playbook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...rest, folder: folder || null,
        confidenceLevel: childForm.confidenceLevel ? Number(childForm.confidenceLevel) : null,
        screenshotUrl: screenshotUrlsToString(screenshotUrls) || null,
        screenshotNotes: screenshotNotesToString(sNotes) || null,
        parentId: entry.id,
      }),
    });
    refetch();
    qc.invalidateQueries({ queryKey: ["playbook"] });
    setCreateOpen(false);
    setChildForm({ ...blank(), folder: entry.folder ?? "" });
    setCreatingChildFolder(false);
    setChildNewFolder("");
  }

  return (
    <div className="border-t border-border/50 pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono uppercase text-violet-400 flex items-center gap-1.5">
          <Folder className="h-3 w-3" />
          Дочерние сетапы
          {children.length > 0 && <span className="bg-violet-500/20 text-violet-400 px-1.5 py-0">{children.length}</span>}
        </div>
        <WriteOnly>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setChildForm({ ...blank(), folder: entry.folder ?? "" }); setCreateOpen(true); }}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border border-border text-muted-foreground hover:text-violet-400 hover:border-violet-400/40 transition-colors"
            >
              <Plus className="h-3 w-3" /> Создать дочерний
            </button>
            <button
              onClick={() => setPickOpen(true)}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border border-border text-muted-foreground hover:text-violet-400 hover:border-violet-400/40 transition-colors"
            >
              <Plus className="h-3 w-3" /> Вложить существующий
            </button>
          </div>
        </WriteOnly>
      </div>

      {children.length === 0 && (
        <div className="text-[10px] font-mono text-muted-foreground/60 py-1">Нет дочерних сетапов.</div>
      )}

      <div className="space-y-1.5">
        {children.map((child) => (
          <div key={child.id} data-child-id={child.id} className="border border-violet-500/20 bg-violet-500/5">
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-violet-500/10 transition-colors"
              onClick={() => setExpanded(expanded === child.id ? null : child.id)}
            >
              {expanded === child.id ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
              <span className="text-xs font-mono font-bold text-foreground flex-1">{child.name}</span>
              {child.setupType && <SetupTypeBadge type={child.setupType} />}
              {child.confidenceLevel != null && <ConfidenceBadge level={child.confidenceLevel} />}
              <WriteOnly>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(child); }}
                  className="p-0.5 text-muted-foreground/40 hover:text-violet-400 transition-colors"
                  title="Редактировать дочерний сетап"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const f = entryToForm(child);
                    setChildForm({ ...f, name: `${f.name} (копия)` });
                    setCreateOpen(true);
                  }}
                  className="p-0.5 text-muted-foreground/40 hover:text-emerald-400 transition-colors"
                  title="Дублировать дочерний сетап"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); detach(child.id); }}
                  className="p-0.5 text-muted-foreground/40 hover:text-red-400 transition-colors"
                  title="Открепить дочерний сетап"
                >
                  <Unlink className="h-3 w-3" />
                </button>
              </WriteOnly>
            </div>
            {expanded === child.id && (
              <div className="border-t border-violet-500/20 px-3 pb-3 pt-2 space-y-2">
                {child.conditions && (
                  <div>
                    <div className="text-[10px] font-mono uppercase text-cyan-400 mb-1">Условия входа</div>
                    <div className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{child.conditions}</div>
                  </div>
                )}
                {child.checklist && (
                  <div>
                    <div className="text-[10px] font-mono uppercase text-emerald-400 mb-1">Чеклист</div>
                    <ChecklistView text={child.checklist} />
                  </div>
                )}
                {child.notes && (
                  <div>
                    <div className="text-[10px] font-mono uppercase text-amber-400 mb-1">Заметки</div>
                    <div className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{child.notes}</div>
                  </div>
                )}
                {child.screenshotUrl && (
                  <ScreenshotDisplay
                    urls={child.screenshotUrl}
                    notes={child.screenshotNotes}
                    onNotesChange={async (newNotes) => {
                      try {
                        const resp = await fetch(`${BASE}/api/playbook/${child.id}`, {
                          method: "PATCH", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ screenshotNotes: newNotes }),
                        });
                        if (!resp.ok) throw new Error("Failed");
                        refetch();
                        qc.invalidateQueries({ queryKey: ["playbook"] });
                      } catch { toast({ title: "Ошибка сохранения заметки", variant: "destructive" }); }
                    }}
                  />
                )}
                {!child.conditions && !child.checklist && !child.notes && !child.screenshotUrl && (
                  <div className="text-[10px] font-mono text-muted-foreground/60">Нет содержимого</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Attach existing setup */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="max-w-md max-h-[65vh] flex flex-col bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-tight flex items-center gap-2">
              <Folder className="h-4 w-4 text-violet-400" /> Вложить существующий сетап
            </DialogTitle>
          </DialogHeader>
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или папке..."
            className="font-mono bg-background h-8 text-xs"
          />
          <div className="overflow-y-auto flex-1 space-y-1 min-h-0">
            {available.length === 0 && (
              <div className="text-xs text-muted-foreground font-mono py-4 text-center">Нет доступных сетапов</div>
            )}
            {available.map((e) => (
              <button
                key={e.id}
                onClick={() => attach(e.id)}
                className="w-full flex items-center gap-2 px-3 py-2 border border-border/40 text-xs font-mono text-left hover:bg-muted/30 hover:border-violet-400/30 transition-colors"
              >
                <span className="font-bold text-foreground flex-1 truncate">{e.name}</span>
                {e.folder && <span className="text-muted-foreground/60 text-[10px] truncate max-w-[120px]">{e.folder}</span>}
                {e.setupType && <SetupTypeBadge type={e.setupType} />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create new child setup */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) { setCreateOpen(false); setChildForm({ ...blank(), folder: entry.folder ?? "" }); setCreatingChildFolder(false); setChildNewFolder(""); } }}>
        <DialogContent className="max-w-[90vw] w-full max-h-[85vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-tight flex items-center gap-2">
              <Plus className="h-4 w-4 text-violet-400" /> Новый дочерний сетап → {entry.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Название *</label>
              <Input value={childForm.name} onChange={(e) => setChildForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Название дочернего сетапа" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Папка</label>
                {creatingChildFolder ? (
                  <Input value={childNewFolder} onChange={(e) => setChildNewFolder(e.target.value)}
                    placeholder="Название новой папки" className="font-mono bg-background h-8 text-xs"
                    autoFocus onBlur={() => { if (!childNewFolder.trim()) setCreatingChildFolder(false); }} />
                ) : (
                  <select value={childForm.folder} onChange={(e) => { if (e.target.value === "__new") setCreatingChildFolder(true); else setChildForm((f) => ({ ...f, folder: e.target.value })); }}
                    className="w-full h-8 px-2 text-xs font-mono bg-background border border-input text-foreground rounded-none">
                    <option value="">Без папки</option>
                    {[...new Set(allEntries.map((e) => e.folder).filter(Boolean) as string[])].sort().map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                    <option value="__new">+ Новая папка</option>
                  </select>
                )}
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Тип сетапа</label>
                <select value={childForm.setupType} onChange={(e) => setChildForm((f) => ({ ...f, setupType: e.target.value }))}
                  className="w-full h-8 px-2 text-xs font-mono bg-background border border-input text-foreground rounded-none">
                  <option value="">Не выбрано</option>
                  {SETUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Уверенность (%)</label>
              <Input value={childForm.confidenceLevel} onChange={(e) => setChildForm((f) => ({ ...f, confidenceLevel: e.target.value }))}
                type="number" min="0" max="100" className="font-mono bg-background h-8 text-xs w-32" />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Условия входа</label>
              <textarea value={childForm.conditions} onChange={(e) => setChildForm((f) => ({ ...f, conditions: e.target.value }))}
                rows={3} className="w-full text-xs font-mono bg-background border border-input text-foreground px-3 py-2 resize-none focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Чеклист</label>
              <textarea value={childForm.checklist} onChange={(e) => setChildForm((f) => ({ ...f, checklist: e.target.value }))}
                rows={3} className="w-full text-xs font-mono bg-background border border-input text-foreground px-3 py-2 resize-none focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Заметки</label>
              <textarea value={childForm.notes} onChange={(e) => setChildForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2} className="w-full text-xs font-mono bg-background border border-input text-foreground px-3 py-2 resize-none focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 flex items-center gap-1.5"><Tag className="h-3 w-3" />Теги <span className="text-muted-foreground/50 font-normal normal-case">(перетащи чипы для сортировки)</span></label>
              <TagChipEditor value={childForm.tags} onChange={(v) => setChildForm((f) => ({ ...f, tags: v }))} />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted-foreground mb-1 block">Скриншоты</label>
              <ScreenshotFields
                urls={childForm.screenshotUrls}
                onChange={(urls) => setChildForm((f) => ({ ...f, screenshotUrls: urls }))}
                notes={childForm.screenshotNotes}
                onNotesChange={(notes) => setChildForm((f) => ({ ...f, screenshotNotes: notes }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setCreateOpen(false)}
                className="px-4 py-1.5 text-xs font-mono border border-border text-muted-foreground hover:text-foreground transition-colors">
                Отмена
              </button>
              <button onClick={createChild} disabled={!childForm.name.trim()}
                className="px-4 py-1.5 text-xs font-mono bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-40">
                Создать дочерний
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinkedTradesSection({ entryId, qc }: { entryId: number; qc: ReturnType<typeof useQueryClient> }) {
  const [, setLocation] = useLocation();
  const [linkOpen, setLinkOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: linkedTrades = [], refetch } = useQuery<LinkedTrade[]>({
    queryKey: ["playbook-trades", entryId],
    queryFn: () => fetch(`${BASE}/api/playbook/${entryId}/trades`).then((r) => r.json()),
  });

  const { data: allTrades = [] } = useQuery<LinkedTrade[]>({
    queryKey: ["all-trades-for-link"],
    queryFn: () => fetch(`${BASE}/api/trades`).then((r) => r.json()),
    enabled: linkOpen,
  });

  const linkedIds = new Set(linkedTrades.map((t) => t.id));
  const available = allTrades.filter((t) => !linkedIds.has(t.id) && (
    !search || t.ticker.toLowerCase().includes(search.toLowerCase()) ||
    (t.setup || "").toLowerCase().includes(search.toLowerCase()) ||
    (t.trader || "").toLowerCase().includes(search.toLowerCase())
  ));

  async function linkTrade(tradeId: number) {
    await fetch(`${BASE}/api/playbook/${entryId}/link-trade`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeId }),
    });
    refetch();
    qc.invalidateQueries({ queryKey: ["all-trades-for-link"] });
  }

  async function unlinkTrade(tradeId: number) {
    await fetch(`${BASE}/api/playbook/${entryId}/link-trade/${tradeId}`, { method: "DELETE" });
    refetch();
    qc.invalidateQueries({ queryKey: ["all-trades-for-link"] });
  }

  function goToTrade(tradeId: number) {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    setLocation(`/trades?highlight=${tradeId}`);
  }

  return (
    <div className="border-t border-border/50 pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono uppercase text-primary flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3" />
          Связанные трейды
          {linkedTrades.length > 0 && <span className="bg-primary/20 text-primary px-1.5 py-0">{linkedTrades.length}</span>}
        </div>
        <WriteOnly>
          <button
            onClick={() => setLinkOpen(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
          >
            <Link2 className="h-3 w-3" /> Привязать трейд
          </button>
        </WriteOnly>
      </div>

      {linkedTrades.length === 0 ? (
        <div className="text-[10px] font-mono text-muted-foreground/60 py-2">Нет связанных трейдов</div>
      ) : (
        <div className="space-y-1">
          {linkedTrades.map((t) => (
            <div key={t.id} className={`flex items-center gap-3 px-3 py-2 border text-xs font-mono group ${
              t.result === "win" ? "border-emerald-500/20 bg-emerald-500/5" :
              t.result === "loss" ? "border-red-500/20 bg-red-500/5" :
              "border-border/40 bg-muted/10"
            }`}>
              <span className="font-bold text-foreground">{t.ticker}</span>
              {t.side && (
                <span className={`px-1.5 py-0 text-[10px] border ${t.side === "Long" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                  {t.side === "Long" ? "▲" : "▼"} {t.side}
                </span>
              )}
              <span className="text-muted-foreground">{t.date?.substring(0, 10)}</span>
              {t.setup && <span className="text-muted-foreground/70">{t.setup}</span>}
              {t.trader && <span className="text-muted-foreground/60">{t.trader}</span>}
              <span className={`ml-auto font-bold ${t.result === "win" ? "text-emerald-400" : t.result === "loss" ? "text-red-400" : "text-muted-foreground"}`}>
                {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(0)}` : (t.result === "win" ? "WIN" : t.result === "loss" ? "LOSS" : "BE")}
              </span>
              {t.rMultiple != null && <span className="text-muted-foreground">{t.rMultiple.toFixed(1)}R</span>}
              <button
                onClick={() => goToTrade(t.id)}
                className="p-0.5 text-muted-foreground/40 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                title="Перейти к трейду"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
              <WriteOnly>
                <button onClick={() => unlinkTrade(t.id)} className="p-0.5 text-muted-foreground/50 hover:text-red-400 transition-colors ml-1" title="Отвязать">
                  <Unlink className="h-3 w-3" />
                </button>
              </WriteOnly>
            </div>
          ))}
        </div>
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-2xl max-h-[70vh] flex flex-col bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-tight flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Привязать трейд к стратегии
            </DialogTitle>
          </DialogHeader>
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по тикеру, сетапу, трейдеру..."
            className="font-mono bg-background h-8 text-xs"
          />
          <div className="overflow-y-auto flex-1 space-y-1 min-h-0">
            {available.length === 0 && (
              <div className="text-xs text-muted-foreground font-mono py-4 text-center">Нет доступных трейдов</div>
            )}
            {available.map((t) => (
              <button
                key={t.id}
                onClick={() => { linkTrade(t.id); setLinkOpen(false); setSearch(""); }}
                className={`w-full flex items-center gap-3 px-3 py-2 border text-xs font-mono text-left hover:bg-muted/30 transition-colors ${
                  t.result === "win" ? "border-emerald-500/20" : t.result === "loss" ? "border-red-500/20" : "border-border/40"
                }`}
              >
                <span className="font-bold text-foreground">{t.ticker}</span>
                {t.side && <span className={t.side === "Long" ? "text-emerald-400" : "text-red-400"}>{t.side === "Long" ? "▲" : "▼"}</span>}
                <span className="text-muted-foreground">{t.date?.substring(0, 10)}</span>
                {t.setup && <span className="text-muted-foreground/70 truncate flex-1">{t.setup}</span>}
                {t.trader && <span className="text-muted-foreground/60">{t.trader}</span>}
                <span className={`ml-auto font-bold ${t.result === "win" ? "text-emerald-400" : t.result === "loss" ? "text-red-400" : "text-muted-foreground"}`}>
                  {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(0)}` : (t.result === "win" ? "WIN" : t.result === "loss" ? "LOSS" : "BE")}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryCard({ entry, expanded, setExpanded, openEdit, setDeleting, qc, allEntries }: {
  entry: PlaybookEntry; expanded: number | null; setExpanded: (id: number | null) => void;
  openEdit: (e: PlaybookEntry) => void; setDeleting: (e: PlaybookEntry) => void; qc: ReturnType<typeof useQueryClient>;
  allEntries: PlaybookEntry[];
}) {
  const isExp = expanded === entry.id;
  const folderBorder = entry.folder ? (FOLDER_COLORS[entry.folder] || "border-l-muted-foreground") : "border-l-transparent";
  return (
    <div data-entry-id={entry.id} className={`bg-card border border-border rounded-none border-l-[3px] ${folderBorder}`}>
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpanded(isExp ? null : entry.id)}>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {isExp ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-sm font-mono text-foreground">{entry.name}</span>
              <SetupTypeBadge type={entry.setupType} />
              {entry.sourceType && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {SOURCE_LABELS[entry.sourceType] || entry.sourceType} #{entry.sourceId}
                </span>
              )}
            </div>
            <TagChips tags={entry.tags} />
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ConfidenceBadge level={entry.confidenceLevel} />
          <WriteOnly>
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => openEdit(entry)} className="p-1 text-muted-foreground hover:text-primary transition-colors" title="Редактировать"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => setDeleting(entry)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors" title="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </WriteOnly>
        </div>
      </div>

      {isExp && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {entry.conditions && (
              <div className="bg-muted/20 border border-border/50 p-3">
                <div className="text-[10px] font-mono uppercase text-cyan-400 mb-2 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                  Условия входа
                </div>
                <div className="text-xs font-mono whitespace-pre-wrap text-foreground/90 leading-relaxed">{entry.conditions}</div>
              </div>
            )}
            {entry.checklist && (
              <div className="bg-muted/20 border border-border/50 p-3">
                <div className="text-[10px] font-mono uppercase text-emerald-400 mb-2 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                  Чеклист
                </div>
                <ChecklistView text={entry.checklist} />
              </div>
            )}
            {entry.notes && (
              <div className="md:col-span-2 bg-muted/20 border border-border/50 p-3">
                <div className="text-[10px] font-mono uppercase text-amber-400 mb-2 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                  Заметки
                </div>
                <div className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{entry.notes}</div>
              </div>
            )}
            {entry.screenshotUrl && (
              <div className="md:col-span-2">
                <ScreenshotDisplay
                  urls={entry.screenshotUrl}
                  notes={entry.screenshotNotes}
                  onNotesChange={async (newNotes) => {
                    try {
                      const resp = await fetch(`${BASE}/api/playbook/${entry.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ screenshotNotes: newNotes }),
                      });
                      if (!resp.ok) throw new Error("Failed");
                      qc.invalidateQueries({ queryKey: ["playbook"] });
                    } catch { toast({ title: "Ошибка сохранения заметки", variant: "destructive" }); }
                  }}
                />
              </div>
            )}
          </div>
          <SubSetupsSection entry={entry} allEntries={allEntries} qc={qc} openEdit={openEdit} />
          <SetupExamplesSection entryId={entry.id} qc={qc} />
          <LinkedTradesSection entryId={entry.id} qc={qc} />
        </div>
      )}
    </div>
  );
}

function loadFolderOrder(): string[] {
  try { return JSON.parse(localStorage.getItem("playbook-folder-order") || "[]"); }
  catch { return []; }
}
function saveFolderOrder(order: string[]) {
  localStorage.setItem("playbook-folder-order", JSON.stringify(order));
}

export default function Playbook() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlaybookEntry | null>(null);
  const [deleting, setDeleting] = useState<PlaybookEntry | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [deleteFolderPwd, setDeleteFolderPwd] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(blank());
  const [creatingNewFolder, setCreatingNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const initialCollapseRef = useRef(false);
  const [folderFilter, setFolderFilter] = useState("all");
  const [folderOrder, setFolderOrder] = useState<string[]>(loadFolderOrder);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [folderPanelOpen, setFolderPanelOpen] = useState(false);
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");
  const [tagPanelSearch, setTagPanelSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [folderColors, setFolderColors] = useState<Record<string, number>>(loadFolderColors);
  const [coloringFolder, setColoringFolder] = useState<string | null>(null);

  function draftKey(editId?: number | null) {
    return editId ? `playbook-draft-${editId}` : "playbook-draft-new";
  }
  function getFolderBorderColor(name: string): string {
    const idx = folderColors[name];
    if (idx !== undefined && FOLDER_COLOR_PALETTE[idx]) return FOLDER_COLOR_PALETTE[idx].border;
    return FOLDER_COLORS[name] || "border-l-amber-500";
  }
  function getFolderIconColor(name: string): string {
    const idx = folderColors[name];
    if (idx !== undefined && FOLDER_COLOR_PALETTE[idx]) return FOLDER_COLOR_PALETTE[idx].icon;
    return FOLDER_ICON_COLORS[name] || "text-amber-400";
  }

  const folderPanelRef = useRef<HTMLDivElement>(null);
  const tagPanelRef = useRef<HTMLDivElement>(null);
  const globalSearchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (folderPanelOpen && folderPanelRef.current && !folderPanelRef.current.contains(e.target as Node)) {
        setFolderPanelOpen(false); setFolderSearch("");
      }
      if (tagPanelOpen && tagPanelRef.current && !tagPanelRef.current.contains(e.target as Node)) {
        setTagPanelOpen(false); setTagPanelSearch("");
      }
      if (globalSearchOpen && globalSearchRef.current && !globalSearchRef.current.contains(e.target as Node)) {
        setGlobalSearchOpen(false);
      }
      if (coloringFolder !== null) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-palette-popup]")) {
          setColoringFolder(null);
        }
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [folderPanelOpen, tagPanelOpen, globalSearchOpen, coloringFolder]);

  const dragSrc = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const { data: entries = [], isLoading } = useQuery<PlaybookEntry[]>({
    queryKey: ["playbook"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/playbook`);
      return r.json();
    },
    staleTime: 15_000,
  });

  type FolderSetting = { folderName: string; colorIndex: number | null; sortOrder: number };
  const { data: folderSettingsData } = useQuery<FolderSetting[]>({
    queryKey: ["playbook-folder-settings"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/playbook/folder-settings`);
      return r.json();
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!folderSettingsData || folderSettingsData.length === 0) return;
    const colors: Record<string, number> = {};
    for (const s of folderSettingsData) {
      if (s.colorIndex !== null && s.colorIndex !== undefined) colors[s.folderName] = s.colorIndex;
    }
    if (Object.keys(colors).length > 0) {
      setFolderColors(colors);
      saveFolderColors(colors);
    }
    const orderedFromServer = [...folderSettingsData]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(s => s.folderName);
    if (orderedFromServer.length > 0) {
      setFolderOrder(prev => {
        const newOnes = prev.filter(n => !orderedFromServer.includes(n));
        const merged = [...orderedFromServer, ...newOnes];
        saveFolderOrder(merged);
        return merged;
      });
    }
  }, [folderSettingsData]);

  async function saveFolderColorToServer(folderName: string, colorIdx: number) {
    try {
      await fetch(`${BASE}/api/playbook/folder-settings`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ folderName, colorIndex: colorIdx }]),
      });
      qc.invalidateQueries({ queryKey: ["playbook-folder-settings"] });
    } catch {}
  }

  async function saveFolderOrderToServer(order: string[]) {
    try {
      const updates = order.map((name, idx) => ({ folderName: name, sortOrder: idx }));
      await fetch(`${BASE}/api/playbook/folder-settings`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch {}
  }

  const topLevel = useMemo(() => entries.filter((e) => !e.parentId), [entries]);

  const allUsedTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const e of topLevel) {
      if (e.tags) e.tags.split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => tagSet.add(t));
    }
    return [...tagSet].sort();
  }, [topLevel]);

  const filteredTopLevel = useMemo(() => {
    if (tagFilter.length === 0) return topLevel;
    return topLevel.filter((e) => {
      if (!e.tags) return false;
      const entryTags = e.tags.split(",").map((t) => t.trim());
      return tagFilter.every((ft) => entryTags.includes(ft));
    });
  }, [topLevel, tagFilter]);

  const globalSearchResults = useMemo(() => {
    if (!globalSearch.trim()) return [];
    const q = globalSearch.toLowerCase();
    const results: (PlaybookEntry & { _isChild?: boolean; _parentName?: string })[] = [];
    for (const e of topLevel) {
      if (
        e.name.toLowerCase().includes(q) ||
        (e.folder || "").toLowerCase().includes(q) ||
        (e.conditions || "").toLowerCase().includes(q) ||
        (e.tags || "").toLowerCase().includes(q)
      ) {
        results.push(e);
      }
      const children = entries.filter((c) => c.parentId === e.id);
      for (const c of children) {
        if (
          c.name.toLowerCase().includes(q) ||
          (c.conditions || "").toLowerCase().includes(q) ||
          (c.tags || "").toLowerCase().includes(q)
        ) {
          results.push({ ...c, _isChild: true, _parentName: e.name });
        }
      }
      if (results.length >= 15) break;
    }
    return results.slice(0, 15);
  }, [globalSearch, topLevel, entries]);

  function navigateToEntry(entry: PlaybookEntry & { _isChild?: boolean }) {
    setTagFilter([]);
    setFolderFilter("all");
    setGlobalSearch("");
    setGlobalSearchOpen(false);

    if (entry.parentId) {
      const parent = entries.find((e) => e.id === entry.parentId);
      if (parent) {
        if (parent.folder) {
          setCollapsedFolders((prev) => {
            const next = new Set(prev);
            next.delete(parent.folder!);
            return next;
          });
        }
        setExpanded(parent.id);
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = document.querySelector(`[data-entry-id="${parent.id}"]`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            setTimeout(() => {
              const childEl = document.querySelector(`[data-child-id="${entry.id}"]`);
              if (childEl) {
                childEl.scrollIntoView({ behavior: "smooth", block: "center" });
                childEl.classList.add("ring-2", "ring-primary/60");
                setTimeout(() => childEl.classList.remove("ring-2", "ring-primary/60"), 2000);
              }
            }, 300);
          }, 100);
        });
      }
    } else {
      if (entry.folder) {
        setCollapsedFolders((prev) => {
          const next = new Set(prev);
          next.delete(entry.folder!);
          return next;
        });
      }
      setExpanded(entry.id);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-entry-id="${entry.id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-primary/60");
          setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 2000);
        }
      });
    }
  }

  const grouped = useMemo(() => {
    const folders = new Map<string, PlaybookEntry[]>();
    const unfiled: PlaybookEntry[] = [];
    for (const e of filteredTopLevel) {
      if (e.folder) {
        if (!folders.has(e.folder)) folders.set(e.folder, []);
        folders.get(e.folder)!.push(e);
      } else {
        unfiled.push(e);
      }
    }
    return { folders, unfiled };
  }, [filteredTopLevel]);

  const allFolderNames = useMemo(() => [...grouped.folders.keys()], [grouped]);

  const orderedFolders = useMemo(() => {
    const inOrder = folderOrder.filter((n) => grouped.folders.has(n));
    const newOnes = allFolderNames.filter((n) => !folderOrder.includes(n));
    return [...inOrder, ...newOnes];
  }, [folderOrder, allFolderNames, grouped.folders]);

  useEffect(() => {
    const merged = [...folderOrder.filter((n) => grouped.folders.has(n)), ...allFolderNames.filter((n) => !folderOrder.includes(n))];
    if (JSON.stringify(merged) !== JSON.stringify(folderOrder)) {
      setFolderOrder(merged);
      saveFolderOrder(merged);
    }
  }, [allFolderNames]);

  useEffect(() => {
    if (!initialCollapseRef.current && orderedFolders.length > 0) {
      initialCollapseRef.current = true;
      setCollapsedFolders(new Set(orderedFolders));
    }
  }, [orderedFolders]);

  const [pendingHighlight, setPendingHighlight] = useState<number | null>(null);

  useEffect(() => {
    function checkHighlight() {
      const params = new URLSearchParams(window.location.search);
      const hid = params.get("highlight");
      if (hid) {
        setPendingHighlight(Number(hid));
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    checkHighlight();
    window.addEventListener("popstate", checkHighlight);
    const origPush = window.history.pushState.bind(window.history);
    window.history.pushState = function (...args: any[]) {
      origPush(...args);
      setTimeout(checkHighlight, 0);
    };
    return () => {
      window.removeEventListener("popstate", checkHighlight);
      window.history.pushState = origPush;
    };
  }, []);

  useEffect(() => {
    if (pendingHighlight === null || entries.length === 0) return;
    const entry = entries.find((e) => e.id === pendingHighlight);
    if (!entry) return;
    setPendingHighlight(null);
    setTimeout(() => navigateToEntry(entry), 200);
  }, [pendingHighlight, entries]);

  useEffect(() => {
    if (!open) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      localStorage.setItem(draftKey(editing?.id), JSON.stringify(form));
      setIsDraft(true);
    }, 800);
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
  }, [form, open, editing?.id]);

  const allTopLevelIds = useMemo(() => filteredTopLevel.map((e) => e.id), [filteredTopLevel]);
  const { data: allLinkedTrades = [] } = useQuery<{ entryId: number; trades: LinkedTrade[] }[]>({
    queryKey: ["all-playbook-trades-stats", allTopLevelIds.join(",")],
    queryFn: async () => {
      if (allTopLevelIds.length === 0) return [];
      const r = await fetch(`${BASE}/api/playbook/trades/bulk?ids=${allTopLevelIds.join(",")}`);
      return r.json();
    },
    enabled: allTopLevelIds.length > 0,
    staleTime: 30_000,
  });

  const folderTradeStats = useMemo(() => {
    const map = new Map<string, LinkedTrade[]>();
    for (const folderName of orderedFolders) {
      const folderEntries = grouped.folders.get(folderName) || [];
      const trades: LinkedTrade[] = [];
      for (const entry of folderEntries) {
        const found = allLinkedTrades.find((r) => r.entryId === entry.id);
        if (found) trades.push(...found.trades);
      }
      map.set(folderName, trades);
    }
    return map;
  }, [allLinkedTrades, orderedFolders, grouped.folders]);

  function reorder(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const next = [...orderedFolders];
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    setFolderOrder(next);
    saveFolderOrder(next);
    saveFolderOrderToServer(next);
  }

  function handleDragStart(idx: number) { dragSrc.current = idx; }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setDragOver(idx); }
  function handleDrop(idx: number) {
    if (dragSrc.current !== null) reorder(dragSrc.current, idx);
    dragSrc.current = null;
    setDragOver(null);
  }
  function handleDragEnd() { dragSrc.current = null; setDragOver(null); }

  const lastAdded = useMemo(() => {
    if (!entries.length) return null;
    return entries.reduce((latest, e) => e.createdAt > latest.createdAt ? e : latest, entries[0]);
  }, [entries]);

  const { data: activityItems = [] } = useQuery<{ id: number; action: string; section: string; entityTitle?: string; trader?: string; details?: string; createdAt: string }[]>({
    queryKey: ["playbook-activity"],
    queryFn: () => fetch(`${BASE}/api/activity`).then((r) => r.json()).then((all: any[]) => all.filter((a) => a.section === "playbook").slice(0, 20)),
    staleTime: 30000,
  });

  const renameFolderMut = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      fetch(`${BASE}/api/playbook/rename-folder`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, trader: user?.name ?? "system" }),
      }).then((r) => r.json()),
    onSuccess: (_, { from, to }) => {
      qc.invalidateQueries({ queryKey: ["playbook"] });
      qc.invalidateQueries({ queryKey: ["playbook-folder-settings"] });
      setFolderOrder((prev) => { const next = prev.map((f) => f === from ? to : f); saveFolderOrder(next); return next; });
      if (folderFilter === from) setFolderFilter(to);
      setFolderColors((prev) => {
        if (prev[from] !== undefined) {
          const next = { ...prev, [to]: prev[from] };
          delete next[from];
          saveFolderColors(next);
          return next;
        }
        return prev;
      });
      setRenamingFolder(null);
      setRenameDraft("");
      toast({ title: `Папка переименована в «${to}»` });
    },
  });

  function startRename(name: string, e: React.MouseEvent) {
    e.stopPropagation();
    setRenamingFolder(name);
    setRenameDraft(name);
  }

  function submitRename(from: string) {
    const to = renameDraft.trim();
    if (!to || to === from) { setRenamingFolder(null); return; }
    renameFolderMut.mutate({ from, to });
  }

  const traderName = user?.name ?? "system";
  const createMut = useMutation({
    mutationFn: (data: FormData) => {
      const { screenshotUrls, screenshotNotes: sNotes, ...rest } = data;
      const folder = creatingNewFolder ? newFolderName.trim() : data.folder;
      return fetch(`${BASE}/api/playbook`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, folder: folder || null, confidenceLevel: data.confidenceLevel ? Number(data.confidenceLevel) : null, screenshotUrl: screenshotUrlsToString(screenshotUrls) || null, screenshotNotes: screenshotNotesToString(sNotes) || null, trader: traderName }),
      }).then((r) => r.json());
    },
    onSuccess: () => {
      localStorage.removeItem(draftKey(null));
      qc.invalidateQueries({ queryKey: ["playbook"] });
      setOpen(false); setCreatingNewFolder(false); setNewFolderName("");
      setIsDraft(false);
      toast({ title: "Добавлено в плейбук" });
    },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FormData }) => {
      const { screenshotUrls, screenshotNotes: sNotes, ...rest } = data;
      const folder = creatingNewFolder ? newFolderName.trim() : data.folder;
      return fetch(`${BASE}/api/playbook/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, folder: folder || null, confidenceLevel: data.confidenceLevel ? Number(data.confidenceLevel) : null, screenshotUrl: screenshotUrlsToString(screenshotUrls) || null, screenshotNotes: screenshotNotesToString(sNotes) || null, trader: traderName }),
      }).then((r) => r.json());
    },
    onSuccess: (_, { id }) => {
      localStorage.removeItem(draftKey(id));
      qc.invalidateQueries({ queryKey: ["playbook"] });
      qc.invalidateQueries({ queryKey: ["playbook-children"] });
      setOpen(false); setEditing(null); setCreatingNewFolder(false); setNewFolderName("");
      setIsDraft(false);
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`${BASE}/api/playbook/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trader: traderName }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["playbook"] }); setDeleting(null); },
  });
  const deleteFolderMut = useMutation({
    mutationFn: (data: { folder: string; password: string }) =>
      fetch(`${BASE}/api/playbook/delete-folder`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, trader: traderName }),
      }).then(async (r) => { if (!r.ok) { const e = await r.json(); throw new Error(e.error); } return r.json(); }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["playbook"] });
      setDeletingFolder(null); setDeleteFolderPwd("");
      toast({ title: `Папка «${v.folder}» удалена` });
    },
    onError: (err: Error) => { toast({ title: "Ошибка", description: err.message, variant: "destructive" }); },
  });

  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function openCreate() {
    setEditing(null); setCreatingNewFolder(false); setNewFolderName("");
    const saved = localStorage.getItem(draftKey(null));
    if (saved) {
      try { setForm(JSON.parse(saved)); setIsDraft(true); }
      catch { setForm(blank()); setIsDraft(false); }
    } else { setForm(blank()); setIsDraft(false); }
    setOpen(true);
  }
  function openEdit(e: PlaybookEntry) {
    setEditing(e); setCreatingNewFolder(false); setNewFolderName("");
    const saved = localStorage.getItem(draftKey(e.id));
    if (saved) {
      try { setForm(JSON.parse(saved)); setIsDraft(true); }
      catch { setForm(entryToForm(e)); setIsDraft(false); }
    } else { setForm(entryToForm(e)); setIsDraft(false); }
    setOpen(true);
  }

  function toggleTagFilter(tag: string) {
    setTagFilter((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  function handleSave() {
    if (!form.name) return;
    if (editing) updateMut.mutate({ id: editing.id, data: form });
    else createMut.mutate(form);
  }

  function toggleFolder(name: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const allCollapsed = orderedFolders.length > 0 && orderedFolders.every((f) => collapsedFolders.has(f));
  function toggleAllFolders() {
    if (allCollapsed) setCollapsedFolders(new Set());
    else setCollapsedFolders(new Set(orderedFolders));
  }

  const showFolder = (name: string) => folderFilter === "all" || folderFilter === name;
  const showUnfiled = folderFilter === "all" || folderFilter === "__unfiled";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Плейбук</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {tagFilter.length > 0 ? `${filteredTopLevel.length} из ${topLevel.length}` : topLevel.length} сетапов · {orderedFolders.length} {orderedFolders.length === 1 ? "папка" : "папок"}
            {tagFilter.length > 0 && <span className="text-primary ml-1">· фильтр: {tagFilter.length} {tagFilter.length === 1 ? "тег" : "тегов"}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={globalSearchRef}>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
              <Input
                value={globalSearch}
                onChange={(e) => { setGlobalSearch(e.target.value); setGlobalSearchOpen(true); }}
                onFocus={() => { if (globalSearch.trim()) setGlobalSearchOpen(true); }}
                placeholder="Поиск сетапов..."
                className="font-mono bg-card h-7 text-[10px] pl-7 pr-6 w-[200px] border-border"
              />
              {globalSearch && (
                <button type="button" onClick={() => { setGlobalSearch(""); setGlobalSearchOpen(false); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            {globalSearchOpen && globalSearch.trim() && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border shadow-lg w-[340px] max-h-[360px] overflow-y-auto">
                {globalSearchResults.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[10px] font-mono text-muted-foreground/50">Ничего не найдено</div>
                ) : (
                  globalSearchResults.map((entry) => (
                    <button
                      key={`${entry.id}-${entry._isChild ? "child" : "top"}`}
                      onClick={() => navigateToEntry(entry)}
                      className="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors border-b border-border/30 last:border-b-0"
                    >
                      <div className="flex items-center gap-2">
                        {entry._isChild && <span className="text-[9px] font-mono text-violet-400 shrink-0">↳</span>}
                        <span className="text-xs font-mono font-bold text-foreground truncate flex-1">{entry.name}</span>
                        {entry.setupType && <SetupTypeBadge type={entry.setupType} />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {entry._isChild && entry._parentName && (
                          <span className="text-[9px] font-mono text-violet-400/70">в «{entry._parentName}»</span>
                        )}
                        {entry.folder && (
                          <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-0.5">
                            <Folder className={`h-2.5 w-2.5 ${FOLDER_ICON_COLORS[entry.folder] || "text-amber-400"}`} />
                            {entry.folder}
                          </span>
                        )}
                        {entry.tags && (
                          <span className="text-[9px] font-mono text-muted-foreground/60 truncate">{entry.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3).join(", ")}</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {lastAdded && (
            <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5 bg-card border border-border px-2.5 py-1.5">
              <Clock className="h-3 w-3 text-primary" />
              <span>Последнее:</span>
              <span className="text-foreground font-bold truncate max-w-[160px]">{lastAdded.name}</span>
              {lastAdded.folder && <span className="text-muted-foreground/60">· {lastAdded.folder}</span>}
            </div>
          )}
          <button onClick={() => setActivityOpen(!activityOpen)}
            className={`flex items-center gap-1 px-2 py-1.5 text-[10px] font-mono border transition-colors ${activityOpen ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
            <Activity className="h-3 w-3" /> Действия
            {activityItems.length > 0 && <span className="bg-primary/20 text-primary px-1 rounded-sm text-[9px]">{activityItems.length}</span>}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {orderedFolders.length > 1 && (
            <button
              onClick={toggleAllFolders}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono border border-border text-muted-foreground hover:text-foreground transition-colors"
              title={allCollapsed ? "Развернуть все" : "Свернуть все"}
            >
              {allCollapsed ? <ChevronsDown className="h-3 w-3" /> : <ChevronsUp className="h-3 w-3" />}
              {allCollapsed ? "Развернуть" : "Свернуть"}
            </button>
          )}
          <WriteOnly>
            <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
              <Plus className="h-3 w-3" /> Новый сетап
            </Button>
          </WriteOnly>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {orderedFolders.length > 0 && (
          <div className="relative" ref={folderPanelRef}>
            <button
              onClick={() => { setFolderPanelOpen(!folderPanelOpen); setTagPanelOpen(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono border transition-colors ${
                folderPanelOpen || folderFilter !== "all" ? "bg-primary/10 text-primary border-primary/40" : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Folder className="h-3 w-3" />
              Папки
              {folderFilter !== "all" && <span className="bg-primary/20 text-primary px-1 text-[9px]">{folderFilter === "__unfiled" ? "∅" : "1"}</span>}
              {folderPanelOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {folderPanelOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border shadow-lg min-w-[240px] max-h-[320px] flex flex-col">
                <div className="px-2 py-1.5 border-b border-border/50">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                    <Input
                      value={folderSearch}
                      onChange={(e) => setFolderSearch(e.target.value)}
                      placeholder="Поиск папок..."
                      className="font-mono bg-background h-6 text-[10px] pl-7 pr-6"
                      autoFocus
                    />
                    {folderSearch && (
                      <button type="button" onClick={() => setFolderSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  <button
                    onClick={() => { setFolderFilter("all"); setFolderPanelOpen(false); setFolderSearch(""); }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-mono flex items-center gap-2 hover:bg-muted/30 transition-colors ${folderFilter === "all" ? "text-primary font-bold" : "text-muted-foreground"}`}
                  >
                    {folderFilter === "all" && <Check className="h-3 w-3" />} Все папки
                  </button>
                  {orderedFolders
                    .filter((n) => !folderSearch || n.toLowerCase().includes(folderSearch.toLowerCase()))
                    .map((name, idx) => {
                      const iconColor = FOLDER_ICON_COLORS[name] || "text-amber-400";
                      const isActive = folderFilter === name;
                      const count = (grouped.folders.get(name) || []).length;
                      return (
                        <button
                          key={name}
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDrop={() => handleDrop(idx)}
                          onDragEnd={handleDragEnd}
                          onClick={() => { setFolderFilter(isActive ? "all" : name); setFolderPanelOpen(false); setFolderSearch(""); }}
                          className={`w-full text-left px-3 py-1.5 text-[10px] font-mono flex items-center gap-2 hover:bg-muted/30 transition-colors ${isActive ? "text-primary font-bold bg-primary/5" : "text-foreground"}`}
                        >
                          <Folder className={`h-3 w-3 shrink-0 ${iconColor}`} />
                          <span className="flex-1 truncate">{name}</span>
                          <span className="text-muted-foreground/50 text-[9px]">{count}</span>
                          {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  {grouped.unfiled.length > 0 && (!folderSearch || "без папки".includes(folderSearch.toLowerCase())) && (
                    <button
                      onClick={() => { setFolderFilter(folderFilter === "__unfiled" ? "all" : "__unfiled"); setFolderPanelOpen(false); setFolderSearch(""); }}
                      className={`w-full text-left px-3 py-1.5 text-[10px] font-mono flex items-center gap-2 hover:bg-muted/30 transition-colors ${folderFilter === "__unfiled" ? "text-primary font-bold bg-primary/5" : "text-muted-foreground"}`}
                    >
                      <span className="flex-1">Без папки</span>
                      <span className="text-muted-foreground/50 text-[9px]">{grouped.unfiled.length}</span>
                      {folderFilter === "__unfiled" && <Check className="h-3 w-3 text-primary shrink-0" />}
                    </button>
                  )}
                  {orderedFolders.filter((n) => !folderSearch || n.toLowerCase().includes(folderSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-3 text-center text-[10px] font-mono text-muted-foreground/50">Ничего не найдено</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {allUsedTags.length > 0 && (
          <div className="relative" ref={tagPanelRef}>
            <button
              onClick={() => { setTagPanelOpen(!tagPanelOpen); setFolderPanelOpen(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono border transition-colors ${
                tagPanelOpen || tagFilter.length > 0 ? "bg-primary/10 text-primary border-primary/40" : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Tag className="h-3 w-3" />
              Теги
              {tagFilter.length > 0 && <span className="bg-primary/20 text-primary px-1 text-[9px]">{tagFilter.length}</span>}
              {tagPanelOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {tagPanelOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border shadow-lg min-w-[300px] max-h-[400px] flex flex-col">
                <div className="px-2 py-1.5 border-b border-border/50">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                    <Input
                      value={tagPanelSearch}
                      onChange={(e) => setTagPanelSearch(e.target.value)}
                      placeholder="Поиск тегов..."
                      className="font-mono bg-background h-6 text-[10px] pl-7 pr-6"
                      autoFocus
                    />
                    {tagPanelSearch && (
                      <button type="button" onClick={() => setTagPanelSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </div>
                {tagFilter.length > 0 && (
                  <div className="px-2 py-1.5 border-b border-border/50 flex items-center gap-1 flex-wrap">
                    <span className="text-[9px] font-mono text-muted-foreground/50">Активные:</span>
                    {tagFilter.map((t) => (
                      <button key={t} onClick={() => toggleTagFilter(t)} className="px-1 py-0 text-[9px] font-mono bg-primary/20 text-primary border border-primary/40 flex items-center gap-0.5 hover:bg-primary/30">
                        {t} <X className="h-2 w-2" />
                      </button>
                    ))}
                    <button onClick={() => setTagFilter([])} className="px-1 py-0 text-[9px] font-mono border border-red-500/30 text-red-400 hover:bg-red-500/10">Сбросить</button>
                  </div>
                )}
                <div className="overflow-y-auto flex-1 p-1">
                  {allUsedTags
                    .filter((t) => !tagPanelSearch || t.toLowerCase().includes(tagPanelSearch.toLowerCase()))
                    .map((tag) => {
                      const isActive = tagFilter.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleTagFilter(tag)}
                          className={`w-full text-left px-2.5 py-1 text-[10px] font-mono flex items-center gap-2 hover:bg-muted/30 transition-colors ${isActive ? "text-primary font-bold bg-primary/5" : "text-foreground"}`}
                        >
                          <span className="flex-1 truncate">{tag}</span>
                          {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  {allUsedTags.filter((t) => !tagPanelSearch || t.toLowerCase().includes(tagPanelSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-3 text-center text-[10px] font-mono text-muted-foreground/50">Ничего не найдено</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {folderFilter !== "all" && (
          <button
            onClick={() => setFolderFilter("all")}
            className="px-2 py-1.5 text-[10px] font-mono border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <X className="h-2.5 w-2.5" /> {folderFilter === "__unfiled" ? "Без папки" : folderFilter}
          </button>
        )}
        {tagFilter.length > 0 && tagFilter.map((t) => (
          <button
            key={t}
            onClick={() => toggleTagFilter(t)}
            className="px-2 py-1.5 text-[10px] font-mono border border-primary/30 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
          >
            <X className="h-2.5 w-2.5" /> {t}
          </button>
        ))}
      </div>

      {activityOpen && activityItems.length > 0 && (
        <div className="bg-card border border-border p-3 space-y-1 max-h-[280px] overflow-y-auto">
          <div className="text-[10px] font-mono uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
            <Activity className="h-3 w-3" /> Последние действия в плейбуке
          </div>
          {activityItems.map((item) => {
            const actionLabel = item.action === "created" ? "создал" : item.action === "updated" ? "обновил" : item.action === "deleted" ? "удалил" : item.action;
            const color = item.action === "created" ? "border-l-emerald-500/40" : item.action === "updated" ? "border-l-amber-500/40" : item.action === "deleted" ? "border-l-red-500/40" : "border-l-primary/30";
            const ago = (() => { const diff = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 1000); if (diff < 60) return "только что"; if (diff < 3600) return `${Math.floor(diff / 60)} мин`; if (diff < 86400) return `${Math.floor(diff / 3600)} ч`; return `${Math.floor(diff / 86400)} дн`; })();
            return (
              <div key={item.id} className={`flex items-center gap-2 px-3 py-1.5 bg-muted/10 border border-border/30 border-l-[3px] ${color} text-[10px] font-mono`}>
                {item.trader && <span className="text-primary font-bold">{item.trader}</span>}
                <span className="text-muted-foreground">{actionLabel}</span>
                {item.entityTitle && <span className="text-foreground font-bold truncate max-w-[200px]">{item.entityTitle}</span>}
                {item.details && <span className="text-muted-foreground/60 truncate max-w-[150px]">{item.details}</span>}
                <span className="ml-auto text-muted-foreground/50 shrink-0">{ago}</span>
              </div>
            );
          })}
        </div>
      )}
      {activityOpen && activityItems.length === 0 && (
        <div className="bg-card border border-border p-4 text-center text-muted-foreground text-[10px] font-mono">
          Нет действий в плейбуке
        </div>
      )}

      {entries.length === 0 && !isLoading && (
        <div className="border border-border bg-card p-16 text-center text-muted-foreground text-xs font-mono">
          Плейбук пуст. Добавьте проверенные сетапы.
        </div>
      )}

      <div className="space-y-4">
        {orderedFolders.map((folderName, idx) => {
          if (!showFolder(folderName)) return null;
          const items = grouped.folders.get(folderName) || [];
          const isCollapsed = collapsedFolders.has(folderName);
          const folderTrades = folderTradeStats.get(folderName) || [];
          const isOver = dragOver === idx;
          return (
            <div
              key={folderName}
              className={`border border-border bg-card/50 border-l-[3px] transition-all relative ${getFolderBorderColor(folderName)} ${isOver ? "opacity-60" : ""}`}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
            >
              <div
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors border-b border-border group/folder"
                onClick={() => renamingFolder !== folderName && toggleFolder(folderName)}
              >
                <div
                  className="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/40 hover:text-muted-foreground"
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); handleDragStart(idx); }}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </div>
                {isCollapsed ? (
                  <Folder className={`h-4 w-4 shrink-0 ${getFolderIconColor(folderName)}`} />
                ) : (
                  <FolderOpen className={`h-4 w-4 shrink-0 ${getFolderIconColor(folderName)}`} />
                )}
                {renamingFolder === folderName ? (
                  <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitRename(folderName); if (e.key === "Escape") setRenamingFolder(null); }}
                      className="h-6 text-xs font-mono bg-background border-primary/50 px-2 w-48"
                      autoFocus
                    />
                    <button onClick={() => submitRename(folderName)} className="text-emerald-400 hover:text-emerald-300 p-0.5"><Check className="h-3 w-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); setRenamingFolder(null); }} className="text-muted-foreground hover:text-foreground p-0.5"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <span className="font-bold text-xs font-mono text-foreground uppercase tracking-tight">{folderName}</span>
                )}
                <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 text-muted-foreground">{items.length}</span>
                {folderTrades.length > 0 && <FolderStats trades={folderTrades} />}
                <div className="flex-1" />
                <WriteOnly>
                  {renamingFolder !== folderName && (
                    <>
                      <div className="relative" data-palette-popup>
                        <button
                          onClick={(e) => { e.stopPropagation(); setColoringFolder(coloringFolder === folderName ? null : folderName); }}
                          className="p-0.5 text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                          title="Цвет папки"
                        >
                          <Palette className="h-3 w-3" />
                        </button>
                        {coloringFolder === folderName && (
                          <div
                            data-palette-popup
                            className="absolute top-full right-0 mt-1 z-50 bg-card border border-border shadow-lg p-2 grid grid-cols-4 gap-1.5 w-[120px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="col-span-4 text-[9px] font-mono text-muted-foreground/50 uppercase mb-0.5">Цвет папки</div>
                            {FOLDER_COLOR_PALETTE.map((c, i) => (
                              <button
                                key={i}
                                onClick={() => {
                                  const next = { ...folderColors, [folderName]: i };
                                  setFolderColors(next);
                                  saveFolderColors(next);
                                  saveFolderColorToServer(folderName, i);
                                  setColoringFolder(null);
                                }}
                                className={`w-5 h-5 rounded-sm ${c.dot} ${folderColors[folderName] === i ? "ring-2 ring-offset-1 ring-offset-card ring-foreground" : ""} hover:opacity-80 transition-opacity`}
                                title={c.label}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => startRename(folderName, e)}
                        className="p-0.5 text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                        title="Переименовать папку"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingFolder(folderName); setDeleteFolderPwd(""); }}
                        className="p-0.5 text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0"
                        title="Удалить папку"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </WriteOnly>
                {isCollapsed ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />}
              </div>
              {!isCollapsed && (
                <div className="p-2 space-y-2">
                  {items.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} expanded={expanded} setExpanded={setExpanded} openEdit={openEdit} setDeleting={setDeleting} qc={qc} allEntries={entries} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {showUnfiled && grouped.unfiled.length > 0 && (
          <div className="space-y-2">
            {orderedFolders.length > 0 && folderFilter === "all" && (
              <div className="text-[10px] font-mono uppercase text-muted-foreground px-1">Без папки</div>
            )}
            {grouped.unfiled.map((entry) => (
              <EntryCard key={entry.id} entry={entry} expanded={expanded} setExpanded={setExpanded} openEdit={openEdit} setDeleting={setDeleting} qc={qc} allEntries={entries} />
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-[90vw] w-full max-h-[90vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-tight flex items-center gap-2">
            {editing ? "Редактировать сетап" : "Новый сетап"}
            {isDraft && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 normal-case tracking-normal">
                <Clock className="h-2.5 w-2.5" /> Черновик
              </span>
            )}
          </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Название *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Earnings Gap Up" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5"><Folder className="h-3 w-3" /> Папка</Label>
              {!creatingNewFolder ? (
                <div className="flex gap-2">
                  <Select value={form.folder || "__none"} onValueChange={(v) => set("folder", v === "__none" ? "" : v)}>
                    <SelectTrigger className="font-mono bg-background h-8 text-xs flex-1"><SelectValue placeholder="Без папки" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none" className="text-xs font-mono">Без папки</SelectItem>
                      {orderedFolders.map((f) => <SelectItem key={f} value={f} className="text-xs font-mono">{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCreatingNewFolder(true)} className="h-8 px-2" title="Новая папка">
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Название новой папки"
                    className="font-mono bg-background h-8 text-xs flex-1"
                    autoFocus
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => { setCreatingNewFolder(false); setNewFolderName(""); }} className="h-8 px-2 text-xs font-mono">
                    Назад
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Тип сетапа</Label>
              <Select value={form.setupType} onValueChange={(v) => set("setupType", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">{SETUP_TYPES.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-32">
              <Label className="text-muted-foreground uppercase text-xs">Уверенность %</Label>
              <Input type="number" min="0" max="100" value={form.confidenceLevel} onChange={(e) => set("confidenceLevel", e.target.value)} className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5"><Tag className="h-3 w-3" />Теги <span className="text-muted-foreground/50 font-normal normal-case">(перетащи чипы для сортировки)</span></Label>
              <TagChipEditor value={form.tags} onChange={(v) => set("tags", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs">Условия входа</Label>
                <Textarea value={form.conditions} onChange={(e) => set("conditions", e.target.value)} rows={3} placeholder="Когда торговать этот сетап..." className="font-mono bg-background text-xs resize-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs">Чеклист (каждый пункт с новой строки)</Label>
                <Textarea value={form.checklist} onChange={(e) => set("checklist", e.target.value)} rows={4} placeholder="- Гэп > 5%&#10;- Объём > 500k pre&#10;- Catalyst чистый&#10;- Вход в первый откат" className="font-mono bg-background text-xs resize-none" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Заметки</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="font-mono bg-background text-xs resize-none" />
            </div>
            <ScreenshotFields
              urls={form.screenshotUrls}
              onChange={(urls) => setForm((f) => ({ ...f, screenshotUrls: urls }))}
              notes={form.screenshotNotes}
              onNotesChange={(notes) => setForm((f) => ({ ...f, screenshotNotes: notes }))}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-mono uppercase text-xs">Отмена</Button>
            <Button onClick={handleSave} disabled={!form.name || createMut.isPending || updateMut.isPending} className="font-mono uppercase text-xs">
              {createMut.isPending || updateMut.isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Удалить «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">Это действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate(deleting.id)} className="font-mono text-xs uppercase bg-red-600 hover:bg-red-700">Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingFolder} onOpenChange={(v) => { if (!v) { setDeletingFolder(null); setDeleteFolderPwd(""); } }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase text-red-400">Удалить папку «{deletingFolder}»?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2">
              <span className="block">Все стратегии внутри этой папки будут удалены. Это действие нельзя отменить.</span>
              <span className="block text-muted-foreground">Введите пароль для подтверждения:</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={deleteFolderPwd}
            onChange={(e) => setDeleteFolderPwd(e.target.value)}
            placeholder="Пароль"
            className="font-mono bg-background h-8 text-xs"
            onKeyDown={(e) => { if (e.key === "Enter" && deletingFolder && deleteFolderPwd) deleteFolderMut.mutate({ folder: deletingFolder, password: deleteFolderPwd }); }}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase" onClick={() => { setDeletingFolder(null); setDeleteFolderPwd(""); }}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingFolder && deleteFolderPwd && deleteFolderMut.mutate({ folder: deletingFolder, password: deleteFolderPwd })}
              disabled={!deleteFolderPwd || deleteFolderMut.isPending}
              className="font-mono text-xs uppercase bg-red-600 hover:bg-red-700"
            >
              {deleteFolderMut.isPending ? "Удаляем..." : "Удалить папку"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
