import React, { useState, useRef } from "react";
import { useListTrades, useListEvents, useListResearch, useListDailyFeed, useListDiscussions } from "@workspace/api-client-react";
import { parseCSV, downloadBlob } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Download, Upload, Database, AlertTriangle, CheckCircle, Info, FileJson, UserPlus, Trash2, Shield, Users, Eye, EyeOff } from "lucide-react";
import { useAuth, type DbUser } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border font-mono">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold uppercase tracking-tight text-foreground">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ExportRow({ label, endpoint, filename }: { label: string; endpoint: string; filename: string }) {
  const [loading, setLoading] = useState(false);
  async function handleExport() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api${endpoint}`);
      const text = await res.text();
      const blob = new Blob([text], { type: res.headers.get("content-type") || "text/plain" });
      const url = URL.createObjectURL(blob);
      downloadBlob(url, filename);
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-foreground">{label}</span>
      <Button size="sm" variant="outline" onClick={handleExport} disabled={loading} className="font-mono text-xs gap-1 h-7">
        <Download className="h-3 w-3" />
        {loading ? "Экспорт..." : "Скачать"}
      </Button>
    </div>
  );
}

type ImportStatus = { success: boolean; message: string } | null;

function ImportSection() {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [type, setType] = useState("trades");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [status, setStatus] = useState<ImportStatus>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const IMPORT_TYPES = [
    { key: "trades", label: "Трейды", fields: ["ticker", "date", "setup", "result", "pnl", "rMultiple", "eventType", "entry", "exit", "stop", "trader", "notes"] },
    { key: "events", label: "События", fields: ["ticker", "date", "eventType", "headline", "percentMove", "volume", "reaction", "summary"] },
  ];

  const currentType = IMPORT_TYPES.find((t) => t.key === type)!;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setRows(parsed.slice(0, 100));
      setStep("preview");
      setStatus(null);
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${BASE}/api/import/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows),
      });
      const data = await res.json() as { success?: boolean; count?: number; error?: string };
      if (res.ok && data.success) {
        setStatus({ success: true, message: `Успешно импортировано ${data.count} записей` });
        setStep("done");
      } else {
        setStatus({ success: false, message: data.error ?? "Ошибка импорта" });
      }
    } catch {
      setStatus({ success: false, message: "Сетевая ошибка" });
    } finally {
      setLoading(false);
    }
  }

  function reset() { setStep("upload"); setRows([]); setStatus(null); if (fileRef.current) fileRef.current.value = ""; }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <Label className="text-xs uppercase text-muted-foreground">Тип данных:</Label>
        {IMPORT_TYPES.map((t) => (
          <button key={t.key} onClick={() => { setType(t.key); reset(); }}
            className={`px-3 py-1.5 text-xs font-mono uppercase border transition-colors ${type === t.key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        Ожидаемые колонки CSV: <span className="text-foreground">{currentType.fields.join(", ")}</span>
      </div>

      {step === "upload" && (
        <div className="border-2 border-dashed border-border p-8 text-center space-y-3">
          <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
          <div className="text-xs text-muted-foreground">Загрузите CSV файл с данными</div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" id="csv-input" />
          <Button variant="outline" size="sm" onClick={() => document.getElementById("csv-input")?.click()} className="font-mono text-xs uppercase">
            Выбрать файл
          </Button>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            <span>Показано {rows.length} строк для предпросмотра. Проверьте данные перед импортом.</span>
          </div>
          <div className="overflow-x-auto border border-border max-h-60">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {Object.keys(rows[0] ?? {}).slice(0, 8).map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-muted-foreground uppercase font-normal whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    {Object.values(row).slice(0, 8).map((v, j) => (
                      <td key={j} className="px-3 py-1.5 max-w-[120px] truncate">{v || <span className="text-muted-foreground">-</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status && (
            <div className={`flex items-center gap-2 text-xs p-3 border ${status.success ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
              {status.success ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
              {status.message}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset} className="font-mono text-xs uppercase">Отмена</Button>
            <Button size="sm" onClick={handleImport} disabled={loading} className="font-mono text-xs uppercase gap-1">
              <Upload className="h-3 w-3" />
              {loading ? "Импортируем..." : `Импортировать ${rows.length} строк`}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          {status && (
            <div className="flex items-center gap-2 text-xs p-3 border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              {status.message}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={reset} className="font-mono text-xs uppercase">Импортировать ещё</Button>
        </div>
      )}
    </div>
  );
}

function BackupImportSection() {
  const [step, setStep] = useState<"upload" | "preview" | "importing" | "done">("upload");
  const [backup, setBackup] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<ImportStatus>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const TABLE_LABELS: Record<string, string> = {
    trades: "Трейды", events: "События", research: "Исследования",
    dailyFeed: "Дневная лента", discussions: "Обсуждения", comments: "Комментарии",
    watchlist: "Вотчлист", playbook: "Плейбук", activityLog: "Активность",
    tradeReactions: "Реакции", tradeReviews: "Ревью", tradingErrors: "Ошибки",
    big7Levels: "Big7 уровни",
  };

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data || typeof data !== "object") {
          setStatus({ success: false, message: "Неверный формат JSON" });
          return;
        }
        setBackup(data);
        setStep("preview");
        setStatus(null);
      } catch {
        setStatus({ success: false, message: "Не удалось разобрать JSON файл" });
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    if (!backup) return;
    setLoading(true);
    setStep("importing");
    setStatus(null);
    try {
      const res = await fetch(`${BASE}/api/import/all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      });
      const data = await res.json() as { success?: boolean; total?: number; counts?: Record<string, number>; error?: string };
      if (res.ok && data.success) {
        const details = data.counts
          ? Object.entries(data.counts).map(([k, v]) => `${TABLE_LABELS[k] || k}: ${v}`).join(", ")
          : "";
        setStatus({ success: true, message: `Импортировано ${data.total} записей. ${details}` });
        setStep("done");
      } else {
        setStatus({ success: false, message: data.error ?? "Ошибка импорта" });
        setStep("preview");
      }
    } catch {
      setStatus({ success: false, message: "Сетевая ошибка" });
      setStep("preview");
    } finally {
      setLoading(false);
    }
  }

  function reset() { setStep("upload"); setBackup(null); setStatus(null); if (fileRef.current) fileRef.current.value = ""; }

  const tableCounts = backup
    ? Object.entries(TABLE_LABELS)
        .filter(([k]) => Array.isArray((backup as Record<string, unknown>)[k]))
        .map(([k, label]) => ({ key: k, label, count: ((backup as Record<string, unknown>)[k] as unknown[]).length }))
        .filter((t) => t.count > 0)
    : [];

  return (
    <div className="space-y-4">
      {step === "upload" && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Загрузите ранее созданный JSON-бэкап для восстановления данных. Данные будут <strong>добавлены</strong> к существующим (не заменят).
          </div>
          <div className="border-2 border-dashed border-border p-8 text-center space-y-3">
            <FileJson className="h-8 w-8 text-muted-foreground mx-auto" />
            <div className="text-xs text-muted-foreground">Загрузите файл deskjournal-backup.json</div>
            <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" id="json-input" />
            <Button variant="outline" size="sm" onClick={() => document.getElementById("json-input")?.click()} className="font-mono text-xs uppercase">
              Выбрать файл
            </Button>
          </div>
          {status && !status.success && (
            <div className="flex items-center gap-2 text-xs p-3 border border-red-500/30 bg-red-500/10 text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {status.message}
            </div>
          )}
        </div>
      )}

      {step === "preview" && backup && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            <span>Бэкап от {(backup as Record<string, unknown>).exportedAt ? String((backup as Record<string, unknown>).exportedAt) : "неизвестно"}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {tableCounts.map((t) => (
              <div key={t.key} className="bg-background border border-border p-2 text-center">
                <div className="text-lg font-bold text-primary font-mono">{t.count}</div>
                <div className="text-xs text-muted-foreground uppercase">{t.label}</div>
              </div>
            ))}
          </div>
          {tableCounts.length === 0 && (
            <div className="text-xs text-muted-foreground">В бэкапе нет данных для импорта.</div>
          )}
          {status && (
            <div className={`flex items-center gap-2 text-xs p-3 border ${status.success ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
              {status.success ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
              {status.message}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset} className="font-mono text-xs uppercase">Отмена</Button>
            <Button size="sm" onClick={handleImport} disabled={loading || tableCounts.length === 0} className="font-mono text-xs uppercase gap-1">
              <Upload className="h-3 w-3" />
              {loading ? "Импортируем..." : `Импортировать ${tableCounts.reduce((a, t) => a + t.count, 0)} записей`}
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
          <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          Импортируем данные...
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          {status && (
            <div className="flex items-center gap-2 text-xs p-3 border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              {status.message}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={reset} className="font-mono text-xs uppercase">Импортировать ещё</Button>
        </div>
      )}
    </div>
  );
}

function UserManagement() {
  const { refreshUsers } = useAuth();
  const { toast } = useToast();
  const [adminPw, setAdminPw] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [allUsers, setAllUsers] = useState<DbUser[]>([]);
  const [showPasswords, setShowPasswords] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("trader");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState("");
  const [saving, setSaving] = useState(false);

  function fetchAll() {
    fetch(`${BASE}/api/users/all`).then((r) => r.json()).then((d) => { if (Array.isArray(d)) setAllUsers(d); });
    refreshUsers();
  }

  if (!unlocked) {
    return (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground font-mono">
          Для управления пользователями введите пароль администратора.
        </div>
        <div className="flex gap-2 items-center">
          <Input type="password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && adminPw === "0987") setUnlocked(true); }}
            placeholder="Пароль админа" className="font-mono bg-background h-8 text-xs w-48" />
          <Button size="sm" onClick={() => { if (adminPw === "0987") { setUnlocked(true); fetchAll(); } else toast({ title: "Неверный пароль", variant: "destructive" }); }}
            className="font-mono text-xs uppercase h-8">Войти</Button>
        </div>
      </div>
    );
  }

  async function addUser() {
    if (!newName.trim() || !newPassword.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/users`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), password: newPassword, role: newRole, adminPassword: "0987" }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Ошибка", variant: "destructive" }); return; }
      fetchAll();
      setAddOpen(false); setNewName(""); setNewPassword(""); setNewRole("trader");
      toast({ title: `Пользователь ${data.name} добавлен` });
    } catch { toast({ title: "Сетевая ошибка", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function updateUser(id: number) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { adminPassword: "0987" };
      if (editName.trim()) body.name = editName.trim();
      if (editPassword.trim()) body.password = editPassword;
      if (editRole) body.role = editRole;
      const res = await fetch(`${BASE}/api/users/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Ошибка", variant: "destructive" }); return; }
      fetchAll();
      setEditingId(null);
      toast({ title: "Пользователь обновлён" });
    } catch { toast({ title: "Сетевая ошибка", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function deleteUser(id: number, name: string) {
    if (!confirm(`Деактивировать пользователя ${name}?`)) return;
    try {
      await fetch(`${BASE}/api/users/${id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: "0987" }),
      });
      fetchAll();
      toast({ title: `${name} деактивирован` });
    } catch { toast({ title: "Ошибка", variant: "destructive" }); }
  }

  function startEdit(u: DbUser) {
    setEditingId(u.id); setEditName(u.name); setEditPassword(u.password); setEditRole(u.role);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPasswords(!showPasswords)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono border border-border text-muted-foreground hover:text-foreground transition-colors">
            {showPasswords ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showPasswords ? "Скрыть пароли" : "Показать пароли"}
          </button>
        </div>
        <Button size="sm" onClick={() => setAddOpen(!addOpen)} className="font-mono text-xs uppercase gap-1 h-7">
          <UserPlus className="h-3 w-3" /> Добавить
        </Button>
      </div>

      {addOpen && (
        <div className="bg-muted/20 border border-border p-3 space-y-2">
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Новый пользователь</div>
          <div className="grid grid-cols-3 gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Имя"
              className="font-mono bg-background h-8 text-xs" />
            <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Пароль"
              className="font-mono bg-background h-8 text-xs" />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
              className="h-8 px-2 text-xs font-mono bg-background border border-input text-foreground rounded-none">
              <option value="trader">Трейдер</option>
              <option value="curator">Куратор</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={addUser} disabled={saving || !newName.trim() || !newPassword.trim()}
              className="font-mono text-xs uppercase h-7">{saving ? "..." : "Создать"}</Button>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(false)} className="font-mono text-xs uppercase h-7">Отмена</Button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {allUsers.map((u) => (
          <div key={u.id} className={`flex items-center gap-3 px-3 py-2 bg-card border border-border text-xs font-mono group ${!u.active ? "opacity-40" : ""}`}>
            {editingId === u.id ? (
              <>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="font-mono bg-background h-7 text-xs w-32" />
                <Input value={editPassword} onChange={(e) => setEditPassword(e.target.value)}
                  className="font-mono bg-background h-7 text-xs w-24" />
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                  className="h-7 px-2 text-xs font-mono bg-background border border-input text-foreground rounded-none">
                  <option value="trader">Трейдер</option>
                  <option value="curator">Куратор</option>
                </select>
                <Button size="sm" onClick={() => updateUser(u.id)} disabled={saving}
                  className="font-mono text-xs h-7 px-2">{saving ? "..." : "OK"}</Button>
                <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="font-mono text-xs h-7 px-2">✕</Button>
              </>
            ) : (
              <>
                <span className="font-bold text-foreground w-28">{u.name}</span>
                <span className={`px-1.5 py-0.5 text-[9px] border ${u.role === "curator" ? "bg-violet-500/10 text-violet-400 border-violet-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"}`}>
                  {u.role === "curator" ? "Куратор" : "Трейдер"}
                </span>
                {showPasswords && <span className="text-muted-foreground/60 tracking-widest">{u.password}</span>}
                <div className="flex-1" />
                <button onClick={() => startEdit(u)}
                  className="p-1 text-muted-foreground/40 hover:text-primary transition-colors opacity-0 group-hover:opacity-100">
                  <Shield className="h-3 w-3" />
                </button>
                <button onClick={() => deleteUser(u.id, u.name)}
                  className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const { data: trades = [] } = useListTrades();
  const { data: events = [] } = useListEvents();
  const { data: research = [] } = useListResearch();
  const { data: feed = [] } = useListDailyFeed();
  const { data: discussions = [] } = useListDiscussions();

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Настройки</h1>

      <Section title="Управление пользователями">
        <UserManagement />
      </Section>

      {/* Status */}
      <Section title="Состояние базы данных">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: "Трейды", count: trades.length },
            { label: "События", count: events.length },
            { label: "Исследования", count: research.length },
            { label: "Дневная лента", count: feed.length },
            { label: "Обсуждения", count: discussions.length },
            { label: "Всего записей", count: trades.length + events.length + research.length + feed.length + discussions.length },
          ].map((item) => (
            <div key={item.label} className="bg-background border border-border p-3 text-center">
              <div className="text-2xl font-bold text-primary font-mono">{item.count}</div>
              <div className="text-xs text-muted-foreground uppercase mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Export */}
      <Section title="Экспорт данных">
        <div className="space-y-0">
          <ExportRow label="Трейды (CSV)" endpoint="/export/trades" filename="trades.csv" />
          <ExportRow label="События (CSV)" endpoint="/export/events" filename="events.csv" />
          <ExportRow label="Исследования (CSV)" endpoint="/export/research" filename="research.csv" />
          <ExportRow label="Дневная лента (CSV)" endpoint="/export/dailyfeed" filename="dailyfeed.csv" />
          <ExportRow label="Обсуждения (CSV)" endpoint="/export/discussions" filename="discussions.csv" />
          <ExportRow label="Вотчлист (CSV)" endpoint="/export/watchlist" filename="watchlist.csv" />
          <ExportRow label="Плейбук (CSV)" endpoint="/export/playbook" filename="playbook.csv" />
          <ExportRow label="Ошибки (CSV)" endpoint="/export/errors" filename="trading-errors.csv" />
          <ExportRow label="Big7 уровни (CSV)" endpoint="/export/big7" filename="big7-levels.csv" />
          <div className="pt-3 mt-3 border-t border-border">
            <ExportRow label="Полный бэкап (JSON)" endpoint="/export/all" filename="deskjournal-backup.json" />
          </div>
        </div>
      </Section>

      {/* Backup Import */}
      <Section title="Импорт полного бэкапа (JSON)">
        <BackupImportSection />
      </Section>

      {/* Import CSV */}
      <Section title="Импорт данных (CSV)">
        <ImportSection />
      </Section>
    </div>
  );
}
