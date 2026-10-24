/**
 * Data layer of «Ассистент WS» (api-server routes/ai-assistant.ts): status + history queries, the streamed chat call
 * (SSE over http.raw — the one client that hands back the Response) and clearing.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { createSseParser, type AssistantEvent } from "@/lib/assistant/sse";
import type { DraftCard, PageContext, Starter } from "@/lib/assistant/model";

export type BudgetState = { used: number; limit: number; left: boolean };

export type AssistantStatus = {
  configured: boolean;
  mock: boolean;
  enabled: boolean;
  allowed: boolean;
  blocked: "AI_NOT_CONFIGURED" | "AI_ASSISTANT_OFF" | "AI_ASSISTANT_STAGE" | null;
  canConfigure: boolean;
  models: { default: string; smart: string };
  autoEscalate: boolean;
  budget: { default: BudgetState; smart: BudgetState };
  staff: boolean;
};

export type StoredMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  drafts: DraftCard[] | null;
  tools: string[];
  createdAt: string;
};

export const assistantKeys = {
  status: () => ["assistant", "status"] as const,
  history: () => ["assistant", "history"] as const,
};

export const statusQuery = () => queryOptions({
  queryKey: assistantKeys.status(),
  queryFn: () => http.get<AssistantStatus>("/api/ai/assistant/status"),
  staleTime: STALE.short,
});

export const historyQuery = () => queryOptions({
  queryKey: assistantKeys.history(),
  queryFn: () => http.get<{ messages: StoredMessage[] }>("/api/ai/assistant/history"),
  staleTime: STALE.static,
  meta: { i18n: false },
});

export function clearHistory(): Promise<{ cleared: number }> {
  return http.del<{ cleared: number }>("/api/ai/assistant/history");
}

export type ChatRequest = { message: string; smart?: boolean; intent?: Starter["intent"]; context?: PageContext };

/** POST the question and hand every SSE event to `onEvent` as it arrives. Rejects with ApiError on a non-2xx start. */
export async function streamChat(req: ChatRequest, onEvent: (e: AssistantEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await http.raw("/api/ai/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(req),
    signal,
  });
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const e of parser.feed(decoder.decode(value, { stream: true }))) onEvent(e);
  }
  for (const e of parser.flush()) onEvent(e);
}
