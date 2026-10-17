/**
 * Settings → Права доступа. Matrix capabilities × roles from GET /api/permissions/matrix.
 * Curators: read-only view. Admins (permissions.manage): toggle cells for trader/curator, pick the scope of
 * team capabilities (весь деск / только подопечные), review the diff and confirm → PUT /api/permissions/matrix.
 * The admin column and admin-only capabilities are locked server-side, so an admin can never lock themselves out.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Minus, RotateCcw, Save, ShieldCheck, Users } from "lucide-react";
import { Panel, Pill, TableScroll } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { cn } from "@/lib/utils";
import { groupedCapabilities, type Capability, type CapabilityDef, type Role, type Scope } from "@/lib/permissions";
import { Callout, InlineError, ROLE_LABEL } from "./shared";
import { fmtDate } from "@/lib/format";

type Grant = { allowed: boolean; scope: Scope };
type Matrix = Record<Role, Record<Capability, Grant>>;

type MatrixPayload = {
  roles: Role[];
  capabilities: CapabilityDef[];
  defaults: Record<Role, Capability[]>;
  defaultScope: Scope;
  overrides: { role: Role; capability: Capability; allowed: boolean; scope?: Scope | null }[];
  matrix: Matrix;
  locked: { roles: Role[]; capabilities: Capability[] };
  updatedAt: string | null;
  updatedBy: string | null;
};

type Cell = { role: Role; capability: Capability; allowed: boolean; scope?: Scope };

const QUERY_KEY = ["permissions", "matrix"] as const;
const COLUMNS: Role[] = ["trader", "curator", "admin"];
const SCOPE_LABEL: Record<Scope, string> = { desk: "Весь деск", assigned: "Подопечные" };

function cloneMatrix(m: Matrix): Matrix {
  const out = {} as Matrix;
  for (const role of Object.keys(m) as Role[]) {
    out[role] = {} as Record<Capability, Grant>;
    for (const cap of Object.keys(m[role]) as Capability[]) out[role][cap] = { ...m[role][cap] };
  }
  return out;
}

/** Cells of `draft` that differ from `base` (what PUT sends and what the confirm dialog lists). */
function diffCells(base: Matrix, draft: Matrix, defs: CapabilityDef[], roles: Role[]): Cell[] {
  const out: Cell[] = [];
  for (const role of roles) {
    for (const d of defs) {
      const a = base[role]?.[d.key];
      const b = draft[role]?.[d.key];
      if (!a || !b) continue;
      if (a.allowed !== b.allowed || (d.team && a.scope !== b.scope)) {
        out.push({ role, capability: d.key, allowed: b.allowed, ...(d.team ? { scope: b.scope } : {}) });
      }
    }
  }
  return out;
}

export function PermissionsSection() {
  const { can, user, refreshPermissions } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const editable = can("permissions.manage");

  const { data, isLoading, isError, error, refetch } = useQuery<MatrixPayload>({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => http.get<MatrixPayload>("/api/permissions/matrix", { signal }),
    staleTime: STALE.live,
  });

  const [draft, setDraft] = useState<Matrix | null>(null);
  const [confirm, setConfirm] = useState<"save" | "reset" | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh server state → drop the local draft (also after our own save).
  useEffect(() => { setDraft(data ? cloneMatrix(data.matrix) : null); }, [data]);

  const defs = useMemo(() => data?.capabilities ?? [], [data]);
  const groups = useMemo(() => groupedCapabilities(defs), [defs]);
  const editableRoles = useMemo(() => COLUMNS.filter((r) => !(data?.locked.roles ?? ["admin", "guest"]).includes(r)), [data]);
  const lockedCaps = useMemo(() => new Set<Capability>(data?.locked.capabilities ?? []), [data]);
  const changes = useMemo(() => (data && draft ? diffCells(data.matrix, draft, defs, editableRoles) : []), [data, draft, defs, editableRoles]);
  const capLabel = (cap: Capability) => defs.find((d) => d.key === cap)?.label ?? cap;

  function setCell(role: Role, cap: Capability, patch: Partial<Grant>) {
    setDraft((d) => {
      if (!d) return d;
      const next = cloneMatrix(d);
      next[role][cap] = { ...next[role][cap], ...patch };
      return next;
    });
  }

  async function submit(body: { cells: Cell[] } | { reset: true }) {
    setBusy(true);
    try {
      const payload = await http.put<MatrixPayload & { changed: number }>("/api/permissions/matrix", body);
      qc.setQueryData(QUERY_KEY, payload);
      refreshPermissions();
      toast({ title: "reset" in body ? "Права сброшены к умолчаниям" : "Права сохранены", description: `Изменено ячеек: ${payload.changed ?? 0}` });
      setConfirm(null);
    } catch (e) {
      toast({ title: "Не удалось сохранить права", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <Panel title="Права доступа" icon={ShieldCheck}>
        <div className="flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      </Panel>
    );
  }
  if (isError || !data || !draft) {
    return (
      <Panel title="Права доступа" icon={ShieldCheck}>
        <InlineError message={error instanceof Error ? error.message : "Не удалось загрузить матрицу прав"} onRetry={() => refetch()} />
      </Panel>
    );
  }

  const customized = data.overrides.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Матрица прав"
        description={editable ? "Переключатели действуют для трейдеров и кураторов. Админ всегда имеет всё." : "Только просмотр — менять права может администратор."}
        icon={ShieldCheck}
        actions={editable ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy || (!customized && changes.length === 0)} onClick={() => setConfirm("reset")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Сбросить
            </Button>
            <Button size="sm" disabled={busy || changes.length === 0} onClick={() => setConfirm("save")}>
              <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Сохранить{changes.length > 0 ? ` (${changes.length})` : ""}
            </Button>
          </>
        ) : undefined}
        padded={false}
      >
        <div className="px-4 pb-3 pt-3 sm:px-5">
          <Callout tone={customized ? "warn" : "neutral"} icon={customized ? Users : ShieldCheck}>
            {customized
              ? <>У деска свои настройки прав ({data.overrides.length}). Обновлено {data.updatedBy ? `${data.updatedBy}, ` : ""}{fmtDate(data.updatedAt)}.</>
              : <>Действуют права по умолчанию: кураторы работают со всем деском, трейдеры — только со своими данными. Назначения куратор / риск-менеджер / ментор влияют на доступ только при области «Подопечные».</>}
          </Callout>
        </div>
        <TableScroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border/60">
                <th scope="col" className="sticky left-0 z-raised bg-[var(--glass-bg)] px-4 py-2 text-left font-medium sm:px-5">Право</th>
                {COLUMNS.map((r) => (
                  <th key={r} scope="col" className="px-3 py-2 text-center font-medium">
                    {ROLE_LABEL[r] ?? r}
                    {!editableRoles.includes(r) && <Lock className="ml-1 inline h-3 w-3 opacity-60" aria-label="Закреплено" />}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.group}>
                <tr>
                  <th scope="rowgroup" colSpan={COLUMNS.length + 1} className="micro-label sticky left-0 bg-[var(--glass-bg)] px-4 pb-1 pt-3 text-left sm:px-5">{g.group}</th>
                </tr>
                {g.items.map((d) => (
                  <tr key={d.key} className="border-t border-border/40">
                    <th scope="row" className="sticky left-0 z-raised max-w-[280px] bg-[var(--glass-bg)] px-4 py-2 text-left font-normal sm:px-5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-foreground">{d.label}</span>
                        {d.adminOnly && <Pill tone="warn" className="text-2xs">только админ</Pill>}
                        {d.team && <Pill tone="neutral" className="text-2xs">команда</Pill>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{d.description}</div>
                    </th>
                    {COLUMNS.map((role) => {
                      const cell = draft[role]?.[d.key];
                      const serverCell = data.matrix[role]?.[d.key];
                      const dirty = !!cell && !!serverCell && (cell.allowed !== serverCell.allowed || (d.team && cell.scope !== serverCell.scope));
                      const lockedCell = !editableRoles.includes(role) || lockedCaps.has(d.key);
                      const interactive = editable && !lockedCell;
                      return (
                        <td key={role} className={cn("px-3 py-2 text-center align-middle", dirty && "bg-primary/8")}>
                          {!cell ? <Minus className="inline h-4 w-4 opacity-40" aria-hidden="true" /> : interactive ? (
                            <div className="flex flex-col items-center gap-1">
                              <Switch
                                checked={cell.allowed}
                                disabled={busy}
                                aria-label={`${d.label} — ${ROLE_LABEL[role] ?? role}`}
                                onCheckedChange={(v) => setCell(role, d.key, { allowed: v })}
                              />
                              {d.team && cell.allowed && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setCell(role, d.key, { scope: cell.scope === "desk" ? "assigned" : "desk" })}
                                  className={cn("chip min-h-6 rounded-full px-2 text-2xs", cell.scope === "assigned" && "ring-1 ring-primary/50")}
                                  title="Область действия: весь деск или только назначенные подопечные"
                                >
                                  {SCOPE_LABEL[cell.scope]}
                                </button>
                              )}
                            </div>
                          ) : cell.allowed ? (
                            <div className="flex flex-col items-center gap-1">
                              <Pill tone="up" title={lockedCell ? "Закреплено" : undefined}><Check className="h-3 w-3" aria-hidden="true" />да</Pill>
                              {d.team && cell.scope === "assigned" && <span className="text-2xs text-muted-foreground">{SCOPE_LABEL.assigned}</span>}
                            </div>
                          ) : (
                            <Pill tone="neutral" title={lockedCell ? "Закреплено" : undefined}>
                              {lockedCell ? <Lock className="h-3 w-3" aria-hidden="true" /> : <Minus className="h-3 w-3" aria-hidden="true" />}нет
                            </Pill>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </TableScroll>
      </Panel>

      {editable && changes.length > 0 && (
        <Panel title="Несохранённые изменения" description={`${changes.length} ячеек`} icon={Save}>
          <ul className="flex flex-col gap-1 text-sm">
            {changes.map((c) => (
              <li key={`${c.role}:${c.capability}`} className="flex flex-wrap items-center gap-2">
                <Pill tone="neutral">{ROLE_LABEL[c.role] ?? c.role}</Pill>
                <span className="text-foreground">{capLabel(c.capability)}</span>
                <span className="text-muted-foreground">→</span>
                <Pill tone={c.allowed ? "up" : "down"}>{c.allowed ? "разрешено" : "запрещено"}</Pill>
                {c.scope && c.allowed && <span className="text-xs text-muted-foreground">{SCOPE_LABEL[c.scope]}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => setConfirm("save")}>Сохранить</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(cloneMatrix(data.matrix))}>Отменить изменения</Button>
          </div>
        </Panel>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(v) => { if (!v && !busy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "reset" ? "Сбросить права к умолчаниям?" : "Применить изменения прав?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground">
                {confirm === "reset" ? (
                  <p>Все переопределения деска ({data.overrides.length}) будут удалены. Кураторы снова получат полный доступ к деску, трейдеры — только к своим данным.</p>
                ) : (
                  <>
                    <p className="mb-2">Изменения вступят в силу для всех пользователей роли в течение ~15 секунд (кэш API). Ваш собственный доступ администратора не изменится.</p>
                    <ul className="max-h-[45dvh] overflow-auto rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-xs">
                      {changes.map((c) => (
                        <li key={`${c.role}:${c.capability}`}>
                          {ROLE_LABEL[c.role] ?? c.role}: {capLabel(c.capability)} — {c.allowed ? "разрешить" : "запретить"}{c.scope && c.allowed ? ` (${SCOPE_LABEL[c.scope].toLowerCase()})` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {user?.traderName && <p className="mt-2">Запись в журнал аудита: {user.traderName}.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void submit(confirm === "reset" ? { reset: true } : { cells: changes }); }}
              className={confirm === "reset" ? "bg-destructive text-destructive-foreground hover:brightness-110" : undefined}
            >
              {busy ? "…" : confirm === "reset" ? "Сбросить" : "Применить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
