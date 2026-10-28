/**
 * «Лёгкие деньги дня» on the client (api routes/easy-money.ts, lib/deskPulse/easyMoney): the clean moves of the
 * in-play tickers from the candle archive, matched against plans and PropReports trades. The only write is the
 * senior's / curator's note in their own plan.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { toastMutationError } from "@/hooks/optimistic";
import { fmtPct } from "@/lib/format";
import { timingLabel, type Timing } from "@/components/shared/session-flow/timing";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import { familyLabel, type Family } from "./api";

export const EASY_SOURCES = ["traded", "plan", "idea", "catalyst", "event", "earnings", "analyst", "em_break", "gap"] as const;
export type EasySource = (typeof EASY_SOURCES)[number];
export type EasyStatus = "took" | "against" | "skipped" | "missed";

export type EasyLine = {
  ticker: string; kind: "session" | "gap"; side: "long" | "short"; family: Family; timing: Timing | null; movePct: number;
  sources: EasySource[]; status: EasyStatus; planned: boolean; n: number; wins: number; losses: number; net: number | null;
};
export type MatchRow = { trader: string; status: EasyStatus; planned: boolean; n: number; wins: number; losses: number; net: number | null };
export type BoardMove = {
  day: string; ticker: string; kind: "session" | "gap"; side: "long" | "short"; family: Family; timing: Timing | null; movePct: number;
  gapPct: number; bodyPct: number; rangePct: number; clean: number; sources: EasySource[]; emPct: number | null; rows: MatchRow[];
};
export type EasyBoard =
  | { allowed: false }
  | {
      allowed: true; staff: boolean; scope: string; day: string; people: number; checked: number; noData: number; notes: Record<string, string>;
      cfg: { minMovePct: number; cleanShare: number; gapPct: number }; moves: BoardMove[];
    };

export const easyKeys = {
  board: (date: string | null) => ["trades", "easy-money", "group", date ?? "last"] as const,
};

/** The group board (curators / admins / seniors; anyone else gets { allowed: false }). `date` null = the last closed session. */
export const easyBoardQuery = (date: string | null) => queryOptions({
  queryKey: easyKeys.board(date),
  queryFn: ({ signal }) => http.get<EasyBoard>("/api/easy-money/group", { query: { date: date ?? undefined }, signal }),
  staleTime: STALE.long,
});

export function useSaveEasyNote(date: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { day: string; ticker: string; note: string }) => http.put<{ ticker: string; note: string | null }>("/api/easy-money/note", { date: v.day, ticker: v.ticker, note: v.note }),
    onSuccess: (r) => qc.setQueryData<EasyBoard>(easyKeys.board(date), (old) => {
      if (!old || !old.allowed) return old;
      const notes = { ...old.notes };
      if (r.note) notes[r.ticker] = r.note; else delete notes[r.ticker];
      return { ...old, notes };
    }),
    onError: (err) => toastMutationError(err, deskPulseI18n.t("easy.noteFailed")),
  });
}

/** «+6.8%» with the side's sign (the move that paid: up for a long, down for a short). */
export const moveText = (m: { side: "long" | "short"; movePct: number }): string => fmtPct(m.side === "long" ? m.movePct : -m.movePct, { decimals: 1, signed: true });

/** «Gap up — long · 9:30–10:00» (a session move without archived bars has no timing — said so). */
export const setupText = (m: { family: string; timing: string | null }): string =>
  `${familyLabel(m.family)} · ${m.timing ? timingLabel(m.timing) : deskPulseI18n.t("easy.noTiming")}`;
