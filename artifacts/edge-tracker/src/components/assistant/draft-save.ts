/**
 * Saving a draft card — only on the person's click, through the site's own write endpoints and their usual
 * permissions (payloads: lib/assistant/drafts.ts). Plans and end-of-day summaries are merged into what is already
 * stored (empty fields filled, texts appended), never overwritten. Returns where the saved thing can be opened.
 */
import type { QueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { KEYS } from "@/lib/api/keys";
import { links } from "@/lib/links";
import { assistantI18n } from "@/i18n/ns/assistant";
import type { DraftCard } from "@/lib/assistant/model";
import { curatorNotePayload, eodLessons, eodSummary, planPayload, playbookPayload, rulePayload } from "@/lib/assistant/drafts";

type Rec = Record<string, unknown>;

export async function saveDraft(card: DraftCard, qc: QueryClient): Promise<{ href: string }> {
  const d = card.draft;
  switch (card.kind) {
    case "playbook": {
      const { body, tradeIds } = playbookPayload(d, (s) => assistantI18n.t(`drafts.fields.${s}`));
      const row = await http.post<{ id: number }>("/api/playbook", body);
      // Example trades: each link goes through the same rights check as «Привязать сделку» (failures are skipped).
      await Promise.allSettled(tradeIds.map((tradeId) => http.post(`/api/playbook/${row.id}/link-trade`, { tradeId })));
      void qc.invalidateQueries({ queryKey: ["playbook"] });
      return { href: links.setup(row.id) };
    }
    case "plan": {
      const date = String(d.date ?? "");
      const cur = await http.get<{ plan: { doc?: Rec; status?: string } | null }>("/api/game-plan/my", { query: { date } });
      await http.put(`/api/game-plan/my/${date}`, planPayload(cur.plan, d));
      void qc.invalidateQueries({ queryKey: KEYS.myPlan(date) });
      return { href: links.myPlan(date) };
    }
    case "eod": {
      const date = String(d.date ?? "");
      const cur = await http.get<{ day: { summary?: Rec | null } | null }>("/api/eod/day", { query: { date } });
      await http.put(`/api/eod/day/${date}`, { summary: eodSummary(cur.day?.summary ?? null, d) });
      await Promise.allSettled(eodLessons(d).map((l) => http.put(`/api/eod/trades/${l.tradeId}/review`, { lesson: l.lesson })));
      void qc.invalidateQueries({ queryKey: ["eod"] });
      return { href: links.journalDay(date) };
    }
    case "rule":
      await http.post("/api/rules", rulePayload(d));
      void qc.invalidateQueries({ queryKey: ["rules"] });
      return { href: "/rules" };
    case "curatorNote":
      await http.post("/api/curator/notes", curatorNotePayload(d));
      void qc.invalidateQueries({ queryKey: ["curator"] });
      return { href: "/curator" };
  }
}
