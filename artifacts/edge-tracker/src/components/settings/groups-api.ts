/**
 * Desk groups client (Волна 1 п. 1.19) — GET/POST/PUT /api/desk-groups (api-server routes/desk-groups.ts) + the pure
 * helpers the «Группы» screen and its tests share.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type GroupMember = { id: number; name: string };
export type DeskGroup = { id: number; name: string; curatorId: number | null; curatorName: string | null; sortOrder: number; members: GroupMember[] };
export type DeskGroupsState = { groups: DeskGroup[]; ungrouped: GroupMember[]; curators: GroupMember[]; canEdit?: boolean };

export const deskGroupsKeys = { all: ["desk-groups"] as const };

export function useDeskGroups(enabled = true) {
  return useQuery({ queryKey: deskGroupsKeys.all, queryFn: () => http.get<DeskGroupsState>("/api/desk-groups"), staleTime: STALE.short, enabled });
}

type Change =
  | { op: "create"; name: string; curatorId: number | null }
  | { op: "update"; id: number; name?: string; curatorId?: number | null; archived?: true }
  | { op: "move"; userId: number; groupId: number | null };

export function useDeskGroupsChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Change): Promise<unknown> => {
      if (c.op === "create") return http.post("/api/desk-groups", { name: c.name, curatorId: c.curatorId });
      if (c.op === "move") return http.put("/api/desk-groups/members", { userId: c.userId, groupId: c.groupId });
      const { op: _op, id, ...body } = c;
      return http.put(`/api/desk-groups/${id}`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deskGroupsKeys.all });
      void qc.invalidateQueries({ queryKey: ["curator"] }); // «Моя группа» in the cabinet follows
    },
  });
}

/** Select value of «no group» / «no curator». */
export const NONE = "none";

/** Where a trader can be moved: every other live group, plus «Без группы» when he is in one (current first). */
export function moveTargets(state: Pick<DeskGroupsState, "groups">, currentGroupId: number | null): { value: string; groupId: number | null; name: string | null }[] {
  const groups = state.groups.map((g) => ({ value: String(g.id), groupId: g.id as number | null, name: g.name as string | null }));
  return [...groups, { value: NONE, groupId: null, name: null }].sort((a, b) => Number(b.groupId === currentGroupId) - Number(a.groupId === currentGroupId));
}

/** A new group's name: trimmed, 1–60 chars, not taken by another live group (case-insensitive). */
export function groupNameProblem(name: string, groups: readonly Pick<DeskGroup, "id" | "name">[], exceptId: number | null = null): "empty" | "long" | "taken" | null {
  const n = name.trim();
  if (!n) return "empty";
  if (n.length > 60) return "long";
  return groups.some((g) => g.id !== exceptId && g.name.trim().toLowerCase() === n.toLowerCase()) ? "taken" : null;
}
