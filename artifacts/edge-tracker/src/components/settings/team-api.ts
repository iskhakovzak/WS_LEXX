import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { HttpError, fetchJson, readApiError } from "./shared";

export type TeamMember = {
  id: number;
  name: string;
  role: string;
  active: boolean;
  banned: boolean;
  createdAt: string | null;
  telegramLinked: boolean;
  tgNotificationsEnabled: boolean;
  assignedCurator: string | null;
  assignedRiskManager: string | null;
  assignedMentor: string | null;
  /** null when the server doesn't provide activity (older API). */
  trades30: number | null;
  lastTrade: string | null;
  riskTier: string | null;
};

export type AssignmentField = "assignedCurator" | "assignedRiskManager" | "assignedMentor";

export const ASSIGNMENT_FIELDS: { key: AssignmentField; label: string; short: string }[] = [
  { key: "assignedCurator", label: "Куратор", short: "Куратор" },
  { key: "assignedRiskManager", label: "Риск-менеджер", short: "Риск" },
  { key: "assignedMentor", label: "Ментор", short: "Ментор" },
];

export const TEAM_QUERY_KEY = ["users", "team"] as const;

type LegacyUser = { id: number; name: string; role: string; active: boolean; banned?: boolean; createdAt?: string };
type LegacyAssignment = {
  name: string; telegram_chat_id: string | null;
  assigned_curator: string | null; assigned_risk_manager: string | null; assigned_mentor: string | null;
};

/** Old API (before /users/team): merge /users/all + /telegram/assignments client-side. */
async function loadLegacyTeam(): Promise<TeamMember[]> {
  const [users, assignments] = await Promise.all([
    fetchJson<LegacyUser[]>(`${BASE}/api/users/all`),
    fetchJson<LegacyAssignment[]>(`${BASE}/api/telegram/assignments`).catch(() => [] as LegacyAssignment[]),
  ]);
  const byName = new Map(assignments.map((a) => [a.name, a]));
  return users.map((u) => {
    const a = byName.get(u.name);
    return {
      id: u.id, name: u.name, role: u.role, active: u.active, banned: !!u.banned, createdAt: u.createdAt ?? null,
      telegramLinked: !!a?.telegram_chat_id, tgNotificationsEnabled: true,
      assignedCurator: a?.assigned_curator ?? null, assignedRiskManager: a?.assigned_risk_manager ?? null, assignedMentor: a?.assigned_mentor ?? null,
      trades30: null, lastTrade: null, riskTier: null,
    };
  });
}

export function useTeam(enabled: boolean) {
  return useQuery<TeamMember[]>({
    queryKey: TEAM_QUERY_KEY,
    queryFn: async () => {
      try {
        return await fetchJson<TeamMember[]>(`${BASE}/api/users/team`);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return loadLegacyTeam();
        throw e;
      }
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useInvalidateTeam() {
  const qc = useQueryClient();
  return () => invalidateTeam(qc);
}

export function invalidateTeam(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: TEAM_QUERY_KEY });
  qc.invalidateQueries({ queryKey: ["users", "me", "profile"] });
}

/** PATCH all three assignments for a trader (the endpoint replaces all three). */
export async function saveAssignments(m: Pick<TeamMember, "name" | AssignmentField>): Promise<void> {
  const r = await fetch(`${BASE}/api/telegram/assignments/${encodeURIComponent(m.name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assigned_curator: m.assignedCurator,
      assigned_risk_manager: m.assignedRiskManager,
      assigned_mentor: m.assignedMentor,
    }),
  });
  if (!r.ok) throw new Error(await readApiError(r, "Назначение не сохранено"));
}

export async function setUserActive(id: number, active: boolean): Promise<void> {
  const r = active
    ? await fetch(`${BASE}/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: true }) })
    : await fetch(`${BASE}/api/users/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) {
    const msg = await readApiError(r);
    if (active && /no fields/i.test(msg)) throw new Error("Сервер ещё не поддерживает повторную активацию — нужен деплой API");
    throw new Error(msg);
  }
}

export async function unlinkTelegram(name: string): Promise<void> {
  const r = await fetch(`${BASE}/api/telegram/admin/disconnect/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await readApiError(r, "Не удалось отвязать"));
}

/** Random temporary password (no ambiguous characters). */
export function generatePassword(len = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
