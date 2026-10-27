/**
 * «Ментор» — requests (api routes/mentor.ts). Every key starts with MENTOR_DOMAIN, so one invalidation refreshes the
 * page, the dashboard line and the curator's panel.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export const MENTOR_DOMAIN = "mentor";

export type Verdict = "untracked" | "new" | "on_track" | "at_risk" | "failing" | "achieved";
export type CommitmentKind = "pause_after_loss" | "max_trades" | "max_daily_loss" | "stop_after_losses" | "no_entry_before" | "no_entry_after" | "max_loss_per_trade" | "custom";
export const COMMITMENT_KINDS: readonly CommitmentKind[] = ["pause_after_loss", "max_trades", "max_daily_loss", "stop_after_losses", "no_entry_before", "no_entry_after", "max_loss_per_trade", "custom"];
export type Source = "mentor" | "trader" | "curator";
export type Params = Record<string, number | string>;

export type Progress = {
  tracked: boolean; unit: "loss" | "day" | "trade" | null; opportunities: number; kept: number; broken: number; rate: number | null; streak: number;
  days: { day: string; kept: number; broken: number }[]; breaks: { tradeId: number; day: string }[];
};
export type Commitment = {
  id: number; trader: string; kind: CommitmentKind; params: Params; text: string | null; source: Source;
  status: "active" | "achieved" | "dropped" | "replaced"; startedOn: string; closedOn: string | null; closeNote: string | null; createdBy: string; createdAt: string;
};
export type CommitmentView = Commitment & { progress: Progress; verdict: Verdict };

export type FactKind = "stage" | "strength" | "weakness" | "leak" | "edge" | "regime" | "agreement" | "focus";
export type Fact = { key: string; kind: FactKind; params: Record<string, string | number | null>; hidden: boolean };
export type NoteKind = "goal" | "strength" | "weakness" | "leak" | "discussed" | "preference" | "guidance";
export type Note = { id: number; kind: NoteKind; body: string; source: Source; author: string; createdAt: string; updatedAt: string };
export type Message = { id: number; role: "user" | "mentor"; kind: "chat" | "brief" | "debrief" | "weekly"; content: string; createdAt: string };

export type RhythmKind = "brief" | "debrief" | "weekly";
export type Proposal = { kind: CommitmentKind; minutes: number | null; count: number | null; usd: number | null; time: string | null; text: string; replaceId: number | null };
export type BriefContent = { headline: string; points: string[]; ruleToday: string; setupIds: number[]; setups: { id: number; name: string }[] };
export type DebriefContent = {
  summary: string; vsPlan: string; lesson: string; praise: string | null; challenge: string | null; ruleTomorrow: Proposal | null;
  savedCommitmentId: number | null; ruleSkipped: "full" | "duplicate" | null;
};
export type WeeklyContent = {
  summary: string; commitments: { id: number; verdict: "keep" | "close_achieved" | "drop"; note: string }[]; nextFocus: string;
  newCommitment: Proposal | null; applied: { id: number; status: string }[]; savedCommitmentId: number | null;
};
export type Digest<C = unknown> = { id: number; content: C; createdAt: string; deep: boolean; source: "live" | "batch"; stale: boolean };

export type Escalation = {
  id: number; trader: string; rule: "tilt_streak" | "rule_breaks" | "drawdown_near_limit" | "silence"; day: string; params: Record<string, number>;
  notified: string[]; status: "open" | "acknowledged"; ackBy: string | null; ackAt: string | null; createdAt: string;
};

export type Checkin = { sleepWell: boolean; focused: boolean; stressed: boolean; anxious: boolean; tilted: boolean; revenge: boolean; note: string | null };

export type MentorState = {
  trader: string; self: boolean; today: string; phase: "pre" | "session" | "post"; stage: string | null;
  status: { enabled: boolean; allowed: boolean; blocked: string | null; budget: { used: number; limit: number; left: boolean; leftShare: number } };
  facts: Fact[]; notes: Note[]; commitments: { active: CommitmentView[]; closed: Commitment[] }; checkin: Checkin | null;
  digests: { brief: Digest<BriefContent> | null; debrief: Digest<DebriefContent> | null; weekly: Digest<WeeklyContent> | null };
  thread: Message[]; escalations: Escalation[]; canGuide: boolean;
};

export type MentorLine = {
  enabled: boolean; phase: "pre" | "session" | "post"; ruleToday: string | null; hasBrief: boolean; hasDebrief: boolean; active: number;
  commitment: { id: number; kind: CommitmentKind; params: Params; text: string | null; kept: number; opportunities: number; verdict: Verdict } | null;
};

export const mentorQuery = (trader: string | null) =>
  queryOptions({
    queryKey: [MENTOR_DOMAIN, "state", trader ?? "me"],
    queryFn: ({ signal }) => http.get<MentorState>("/api/mentor", { query: trader ? { trader } : undefined, signal }),
    staleTime: STALE.short,
  });

export function useMentor(trader: string | null = null, enabled = true) {
  return useQuery({ ...mentorQuery(trader), enabled });
}

export function useMentorLine(enabled = true) {
  return useQuery({
    queryKey: [MENTOR_DOMAIN, "line"],
    queryFn: ({ signal }) => http.get<MentorLine>("/api/mentor/line", { signal }),
    staleTime: STALE.short,
    enabled,
  });
}

function useMentorMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: [MENTOR_DOMAIN] }) });
}

export const useRhythm = () => useMentorMutation((v: { kind: RhythmKind; force?: boolean }) => http.post<{ digest: Digest | null; cached: boolean }>("/api/mentor/rhythm", v));
export const useMentorChat = () =>
  useMentorMutation((message: string) => http.post<{ message: Message; commitment: { commitment: Commitment | null; skipped: string | null } | null; notes: number }>("/api/mentor/chat", { message }));
export const useClearThread = () => useMentorMutation(() => http.del<{ cleared: number }>("/api/mentor/thread"));
export const useAddNote = () => useMentorMutation((v: { kind: NoteKind; body: string; trader?: string }) => http.post<Note>("/api/mentor/notes", v));
export const useUpdateNote = () => useMentorMutation((v: { id: number; body: string }) => http.patch<Note>(`/api/mentor/notes/${v.id}`, { body: v.body }));
export const useDeleteNote = () => useMentorMutation((id: number) => http.del<{ deleted: boolean }>(`/api/mentor/notes/${id}`));
export const useSetHidden = () => useMentorMutation((keys: string[]) => http.put<{ hidden: string[] }>("/api/mentor/hidden", { keys }));
export const useAddCommitment = () =>
  useMentorMutation((v: Partial<Proposal> & { kind: CommitmentKind; text: string; trader?: string }) => http.post<{ commitment: Commitment | null }>("/api/mentor/commitments", v));
export const useCloseCommitment = () =>
  useMentorMutation((v: { id: number; status: "achieved" | "dropped" }) => http.patch<Commitment>(`/api/mentor/commitments/${v.id}`, { status: v.status }));
export const useAckEscalation = () => useMentorMutation((id: number) => http.post<Escalation>(`/api/mentor/escalations/${id}/ack`));

/** The 30-second check-in — the journal's own check-in (api routes/emotionalstate.ts), one row per NY day. */
export function useSaveCheckin(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Checkin) => http.post("/api/emotional-state", { date, sleepWell: c.sleepWell, focused: c.focused, stressed: c.stressed, anxious: c.anxious, tilted: c.tilted, revenge: c.revenge, freeText: c.note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [MENTOR_DOMAIN] });
      void qc.invalidateQueries({ queryKey: ["emotional-state-today"] });
    },
  });
}
