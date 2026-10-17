/**
 * Admin console data layer. New endpoints live under /api/admin/console/* (router routes/admin-console.ts);
 * until the API is rebuilt they answer 404, so every read falls back to existing endpoints and every
 * mutation falls back only to an existing *audited* endpoint — otherwise it reports «нужен перезапуск API».
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { addDays, nyDate } from "@/lib/trading-date";
import { errorFrom, type AuditEntry } from "./api";

/* ── Types ───────────────────────────────────────────────────────────────── */

export type PersonStatus = "active" | "frozen" | "archived";

export interface Person {
  id: number;
  name: string;
  role: string;
  status: PersonStatus;
  active: boolean;
  banned: boolean;
  bannedReason: string | null;
  createdAt: string | null;
  tier: string | null;
  curator: string | null;
  accounts: string[];
  lastSeen: string | null;
  trades30: number;
  lastTrade: string | null;
  telegramLinked: boolean;
}

export interface PeopleData {
  people: Person[];
  accounts: { unmapped: { id: number; account: string; lastSyncedAt: string | null }[]; unmatched: string[] };
  /** "console" = new endpoint, "fallback" = assembled from /users/team + /propreports/*. */
  source: "console" | "fallback";
}

export interface RunLite {
  id: number; startedAt: string | null; finishedAt?: string | null; source: string; status: string; fileName: string | null;
  inserted: number; updated: number; unchanged: number; skipped: number; conflicts: number; errors: number; errorText: string | null; actor: string | null;
}

export interface HealthData {
  today: string;
  sync: {
    configured: boolean;
    missingEnv: string[];
    scheduler: { enabled: boolean; minutes: number | null; nextRunAt: string | null; running: boolean; lastError: string | null };
    lastRun: RunLite | null;
    accounts: { total: number; mapped: number; unmapped: string[] };
    unmatched: string[];
    pending: number;
    imported: number;
    lastSyncedAt: string | null;
  };
  errors24h: { count: number; items: { at: string | null; source: string; text: string }[] };
  source: "console" | "fallback";
}

export interface DataCheck {
  key: string;
  label: string;
  severity: "high" | "medium" | "low";
  count: number;
  groups?: number;
  sample: Record<string, unknown>[];
  hint: string;
}

export interface Tier { key: string; name: string; order: number }

export interface AuditQuery {
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  q?: string;
  from?: string;
  to?: string;
}

export interface AuditResult {
  items: AuditEntry[];
  total: number;
  facets: { actors: { value: string; count: number }[]; actions: { value: string; count: number }[]; targetTypes: { value: string; count: number }[] };
  source: "console" | "fallback";
}

export class NotDeployedError extends Error {
  readonly notDeployed = true;
  constructor(what: string) {
    super(`${what} станет доступно после перезапуска API (новый роутер admin-console).`);
  }
}

/* ── Fetch helpers ───────────────────────────────────────────────────────── */

const api = (path: string, params?: Record<string, string | number | undefined | null>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== "") qs.set(k, String(v));
  const q = qs.toString();
  return `${BASE}/api${path}${q ? `?${q}` : ""}`;
};

/** GET that resolves to null on 404 (endpoint not deployed yet). */
async function getOrNull<T>(path: string, params?: Record<string, string | number | undefined | null>, fallbackMsg = "Ошибка загрузки"): Promise<T | null> {
  const r = await fetch(api(path, params));
  if (r.status === 404) return null;
  if (!r.ok) throw await errorFrom(r, fallbackMsg);
  return r.json() as Promise<T>;
}

async function getJson<T>(path: string, params?: Record<string, string | number | undefined | null>, fallbackMsg = "Ошибка загрузки"): Promise<T> {
  const r = await fetch(api(path, params));
  if (!r.ok) throw await errorFrom(r, fallbackMsg);
  return r.json() as Promise<T>;
}

/** POST/PUT; resolves `{ notFound: true }` on 404 so callers can fall back. */
async function send<T>(method: "POST" | "PUT", path: string, body: unknown, fallbackMsg: string): Promise<T | { notFound: true }> {
  const r = await fetch(api(path), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 404) {
    // A 404 with a JSON error from a deployed route (e.g. «Пользователь не найден») is a real error.
    const j = (await r.clone().json().catch(() => null)) as { error?: string } | null;
    if (j?.error && !/^Cannot (POST|PUT)/.test(j.error) && j.error !== "Not found") throw new Error(j.error);
    return { notFound: true };
  }
  if (!r.ok) throw await errorFrom(r, fallbackMsg);
  return r.json() as Promise<T>;
}
const isNotFound = (v: unknown): v is { notFound: true } => !!v && typeof v === "object" && (v as any).notFound === true;

export const consoleKeys = {
  people: ["admin-console", "people"] as const,
  health: ["admin-console", "health"] as const,
  audit: ["admin-console", "audit"] as const,
  quality: ["admin-console", "quality"] as const,
  tiers: ["admin-console", "tiers"] as const,
  eod: ["admin-console", "eod"] as const,
  eodQueue: ["admin-console", "eod-queue"] as const,
};

/* ── Queries ─────────────────────────────────────────────────────────────── */

type TeamRow = {
  id: number; name: string; role: string; active: boolean; banned: boolean; createdAt: string | null;
  assignedCurator: string | null; trades30: number; lastTrade: string | null; riskTier: string | null; telegramLinked: boolean;
};
type AccountRow = { id: number; account: string; trader: string | null; active: boolean; lastSyncedAt: string | null };

export function usePeople() {
  return useQuery<PeopleData>({
    queryKey: consoleKeys.people,
    queryFn: async () => {
      const direct = await getOrNull<Omit<PeopleData, "source">>("/admin/console/people", undefined, "Не удалось загрузить людей");
      if (direct) return { ...direct, source: "console" };
      const [team, accounts, status] = await Promise.all([
        getJson<TeamRow[]>("/users/team", undefined, "Не удалось загрузить команду"),
        getJson<AccountRow[]>("/propreports/accounts").catch(() => [] as AccountRow[]),
        getJson<{ settings?: { unmatched?: string[] } }>("/propreports/status").catch(() => null),
      ]);
      const accBy = new Map<string, string[]>();
      for (const a of accounts) if (a.trader) accBy.set(a.trader, [...(accBy.get(a.trader) ?? []), a.account]);
      return {
        source: "fallback",
        people: team.map((u) => ({
          id: u.id, name: u.name, role: u.role,
          status: !u.active ? "archived" : u.banned ? "frozen" : "active",
          active: u.active, banned: u.banned, bannedReason: null, createdAt: u.createdAt,
          tier: u.riskTier, curator: u.assignedCurator, accounts: accBy.get(u.name) ?? [],
          lastSeen: null, trades30: u.trades30 ?? 0, lastTrade: u.lastTrade, telegramLinked: !!u.telegramLinked,
        })),
        accounts: {
          unmapped: accounts.filter((a) => !a.trader).map((a) => ({ id: a.id, account: a.account, lastSyncedAt: a.lastSyncedAt })),
          unmatched: status?.settings?.unmatched ?? [],
        },
      };
    },
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

type PrStatus = {
  config: { configured: boolean; missing: string[] };
  scheduler: HealthData["sync"]["scheduler"];
  accounts: { total: number; mapped: number; unmapped: string[] };
  settings: { unmatched: string[] };
  trades: { imported: number; lastSyncedAt: string | null };
  pendingCount: number;
  lastRun: RunLite | null;
};

export function useHealth() {
  return useQuery<HealthData>({
    queryKey: consoleKeys.health,
    queryFn: async () => {
      const direct = await getOrNull<Omit<HealthData, "source">>("/admin/console/health", undefined, "Не удалось загрузить состояние системы");
      if (direct) return { ...direct, source: "console" };
      const [st, runs] = await Promise.all([
        getJson<PrStatus>("/propreports/status", undefined, "Не удалось загрузить статус PropReports"),
        getJson<RunLite[]>("/propreports/runs", { limit: 20 }).catch(() => [] as RunLite[]),
      ]);
      const since = Date.now() - 86_400_000;
      const items = runs
        .filter((r) => r.startedAt && Date.parse(r.startedAt) >= since && (r.status === "error" || r.status === "partial" || r.errors > 0))
        .map((r) => ({ at: r.startedAt, source: "propreports", text: `Синк #${r.id}: ${r.status}${r.errors ? `, ошибок ${r.errors}` : ""}${r.errorText ? ` — ${r.errorText}` : ""}` }));
      if (st.scheduler?.lastError) items.push({ at: null, source: "scheduler", text: `Планировщик: ${st.scheduler.lastError}` });
      return {
        source: "fallback",
        today: nyDate(),
        sync: {
          configured: st.config.configured,
          missingEnv: st.config.missing ?? [],
          scheduler: st.scheduler,
          lastRun: st.lastRun,
          accounts: st.accounts,
          unmatched: st.settings?.unmatched ?? [],
          pending: st.pendingCount ?? 0,
          imported: st.trades?.imported ?? 0,
          lastSyncedAt: st.trades?.lastSyncedAt ?? null,
        },
        errors24h: { count: items.length, items },
      };
    },
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}

export interface EodStatus {
  date: string;
  traders: { trader: string; status: string; trades: number; reviewedTrades: number; closedAt: string | null; reviewedAt: string | null }[];
}

/** Today's EOD (day close) status per trader. null when unavailable. */
export function useEodStatus() {
  return useQuery<EodStatus | null>({
    queryKey: consoleKeys.eod,
    queryFn: () => getJson<EodStatus>("/eod/status").catch(() => null),
    refetchInterval: 60_000,
    retry: false,
  });
}

/** Curator review queue size and SLA breaches. null when unavailable. */
export function useEodQueueCount() {
  return useQuery<{ count: number; overdue: number; slaHours: number } | null>({
    queryKey: consoleKeys.eodQueue,
    queryFn: () => getJson<{ count: number; overdue: number; slaHours: number }>("/eod/queue/count").catch(() => null),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useTiers() {
  return useQuery<Tier[]>({
    queryKey: consoleKeys.tiers,
    queryFn: async () => {
      const r = await getJson<{ tiers?: Tier[] }>("/scaling/config").catch(() => null);
      return (r?.tiers ?? []).map((t) => ({ key: t.key, name: t.name, order: t.order })).sort((a, b) => a.order - b.order);
    },
    staleTime: 10 * 60_000,
  });
}

export function useDataQuality(enabled = true) {
  return useQuery<{ checks: DataCheck[]; today: string; generatedAt: string } | null>({
    queryKey: consoleKeys.quality,
    queryFn: () => getOrNull("/admin/console/data-quality", undefined, "Не удалось проверить качество данных"),
    enabled,
    staleTime: 60_000,
  });
}

function sinceDaysFor(from?: string): number | undefined {
  if (!from) return undefined;
  const days = Math.ceil((Date.now() - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return days > 0 ? days : 1;
}

/** NY trading date of an ISO timestamp. */
export function nyDayOf(iso: string): string {
  return nyDate(new Date(iso));
}

export function useAuditSearch(actor: string, query: AuditQuery) {
  return useQuery<AuditResult>({
    queryKey: [...consoleKeys.audit, query],
    queryFn: async () => {
      const direct = await getOrNull<Omit<AuditResult, "source">>("/admin/console/audit", { ...query, limit: 1000 }, "Не удалось загрузить аудит");
      if (direct) return { ...direct, source: "console" };
      // Legacy endpoint: actor/action/q/sinceDays on the server, object and exact dates on the client.
      const exactAction = query.action && !query.action.endsWith(".*") ? query.action : undefined;
      const rows = await getJson<AuditEntry[]>("/admin/audit", {
        actor, filterActor: query.actor, filterAction: exactAction, q: query.q, sinceDays: sinceDaysFor(query.from), limit: 500,
      }, "Не удалось загрузить аудит");
      const prefix = query.action?.endsWith(".*") ? query.action.slice(0, -1) : null;
      const items = rows.filter((e) =>
        (!prefix || e.action.startsWith(prefix)) &&
        (!query.targetType || e.targetType === query.targetType) &&
        (!query.targetId || e.targetId === query.targetId) &&
        (!query.from || nyDayOf(e.createdAt) >= query.from) &&
        (!query.to || nyDayOf(e.createdAt) <= query.to));
      const count = (vals: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
        return [...m].map(([value, c]) => ({ value, count: c })).sort((a, b) => b.count - a.count);
      };
      return {
        source: "fallback",
        items,
        total: items.length,
        facets: { actors: count(rows.map((r) => r.actor)), actions: count(rows.map((r) => r.action)), targetTypes: count(rows.map((r) => r.targetType)) },
      };
    },
    placeholderData: (prev) => prev,
  });
}

/* ── Mutations ───────────────────────────────────────────────────────────── */

export type PeopleActionKind = "freeze" | "unfreeze" | "archive" | "restore" | "sessions" | "curator" | "role" | "tier";

export interface PeopleActionInput {
  kind: PeopleActionKind;
  people: Pick<Person, "id" | "name">[];
  reason: string;
  curator?: string | null;
  role?: string;
  tierKey?: string;
}

export interface PeopleActionResult { done: string[]; skipped: { name?: string; error: string }[] }

const ACTION_NAME: Record<PeopleActionKind, string> = {
  freeze: "Заморозка", unfreeze: "Разморозка", archive: "Архивирование", restore: "Возврат из архива",
  sessions: "Сброс сессий", curator: "Назначение куратора", role: "Смена роли", tier: "Смена тира",
};

async function runOne(actor: string, kind: PeopleActionKind, p: Pick<Person, "id" | "name">, input: PeopleActionInput): Promise<void> {
  if (kind === "tier") {
    // Existing audited endpoint (scaling.assign); the reason goes into the history comment.
    const r = await send("POST", "/scaling/assign", { trader: p.name, tierKey: input.tierKey, comment: input.reason }, "Не удалось сменить тир");
    if (isNotFound(r)) throw new Error("Не удалось сменить тир");
    return;
  }
  const path = kind === "sessions" ? `/admin/console/people/${p.id}/sessions/reset` : `/admin/console/people/${p.id}/${kind}`;
  const body = kind === "curator" ? { curator: input.curator ?? null, reason: input.reason } : kind === "role" ? { role: input.role, reason: input.reason } : { reason: input.reason };
  const r = await send("POST", path, body, `${ACTION_NAME[kind]}: ошибка`);
  if (!isNotFound(r)) return;
  // Fallbacks — existing audited admin routes only.
  if (kind === "freeze") {
    const b = await send("POST", `/admin/users/${p.id}/ban?actor=${encodeURIComponent(actor)}`, { actor, reason: input.reason }, "Не удалось заморозить");
    if (isNotFound(b)) throw new Error("Пользователь не найден");
    return;
  }
  if (kind === "unfreeze") {
    const b = await send("POST", `/admin/users/${p.id}/unban?actor=${encodeURIComponent(actor)}`, { actor }, "Не удалось разморозить");
    if (isNotFound(b)) throw new Error("Пользователь не найден");
    return;
  }
  if (kind === "role") {
    // Legacy route requires users.manage.admins (admins only).
    const b = await send("POST", `/admin/users/${p.id}/role?actor=${encodeURIComponent(actor)}`, { actor, role: input.role }, "Не удалось сменить роль");
    if (isNotFound(b)) throw new Error("Пользователь не найден");
    return;
  }
  throw new NotDeployedError(ACTION_NAME[kind]);
}

export function usePeopleAction(actor: string) {
  const qc = useQueryClient();
  return useMutation<PeopleActionResult, Error, PeopleActionInput>({
    mutationFn: async (input) => {
      const { kind, people } = input;
      if (people.length > 1 && kind !== "role" && kind !== "tier") {
        const r = await send<{ done: string[]; skipped: { name?: string; error: string }[] }>(
          "POST", "/admin/console/people/bulk",
          { ids: people.map((p) => p.id), action: kind, curator: input.curator ?? null, reason: input.reason },
          `${ACTION_NAME[kind]}: ошибка`,
        );
        if (!isNotFound(r)) return { done: r.done, skipped: r.skipped };
      }
      const done: string[] = [];
      const skipped: PeopleActionResult["skipped"] = [];
      for (const p of people) {
        try {
          await runOne(actor, kind, p, input);
          done.push(p.name);
        } catch (e) {
          if (e instanceof NotDeployedError) throw e;
          skipped.push({ name: p.name, error: (e as Error).message });
        }
      }
      if (!done.length && skipped.length === 1) throw new Error(`${skipped[0]!.name}: ${skipped[0]!.error}`);
      return { done, skipped };
    },
    onSettled: () => {
      for (const k of [consoleKeys.people, consoleKeys.audit, ["admin-desk-pulse"], ["admin-overview"], ["admin-audit"]]) qc.invalidateQueries({ queryKey: k });
    },
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation<{ id: number; name: string }, Error, { name: string; password: string; role: string; curator: string | null; reason: string }>({
    mutationFn: async (body) => {
      const r = await send<{ id: number; name: string }>("POST", "/admin/console/people", body, "Не удалось создать пользователя");
      if (isNotFound(r)) throw new NotDeployedError("Создание учётки с записью в аудит");
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consoleKeys.people });
      qc.invalidateQueries({ queryKey: ["admin-desk-pulse"] });
    },
  });
}

export function useMapAccount() {
  const qc = useQueryClient();
  return useMutation<{ legacy: boolean }, Error, { account: string; trader: string; reason: string }>({
    mutationFn: async (body) => {
      const r = await send("POST", "/admin/console/accounts/map", body, "Не удалось привязать счёт");
      if (!isNotFound(r)) return { legacy: false };
      // Existing audited route (propreports.accounts.update) — it has no reason field.
      const p = await send("PUT", "/propreports/accounts", { accounts: [{ account: body.account, trader: body.trader }] }, "Не удалось привязать счёт");
      if (isNotFound(p)) throw new Error("Не удалось привязать счёт");
      return { legacy: true };
    },
    onSuccess: () => {
      for (const k of [consoleKeys.people, consoleKeys.health, consoleKeys.quality, ["propreports"]]) qc.invalidateQueries({ queryKey: k });
    },
  });
}

/** Default «from» for the audit filter: 30 NY days back. */
export function defaultAuditFrom(): string {
  return addDays(nyDate(), -30);
}
