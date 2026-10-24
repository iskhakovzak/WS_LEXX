/**
 * The conversation state of the panel: history from the server once, then the streamed turns. Each turn POSTs the
 * question with the page context and applies the SSE events to the answer as they arrive (lib/assistant/model.ts).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/http";
import { applyEvent, newAssistantMessage, type ChatMessage, type PageContext, type Starter } from "@/lib/assistant/model";
import { assistantKeys, clearHistory, historyQuery, streamChat, type StoredMessage } from "./api";

let seq = 0;
const nextKey = () => `m${Date.now().toString(36)}${(++seq).toString(36)}`;

function fromStored(m: StoredMessage): ChatMessage {
  const base = newAssistantMessage(`h${m.id}`);
  return { ...base, role: m.role, text: m.content, model: m.model, drafts: m.drafts ?? [], status: "done" };
}

export type SendOptions = { smart?: boolean; intent?: Starter["intent"]; context: PageContext };

export function useAssistantChat(enabled: boolean) {
  const qc = useQueryClient();
  const history = useQuery({ ...historyQuery(), enabled });
  const [live, setLive] = React.useState<ChatMessage[] | null>(null);
  const ctl = React.useRef<AbortController | null>(null);
  const messages = React.useMemo(() => live ?? (history.data?.messages ?? []).map(fromStored), [live, history.data]);
  const busy = messages.some((m) => m.role === "assistant" && m.status === "streaming");

  const patchLast = React.useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setLive((list) => {
      const cur = list ?? [];
      const i = cur.length - 1;
      if (i < 0 || cur[i]!.role !== "assistant") return cur;
      const next = cur.slice();
      next[i] = fn(cur[i]!);
      return next;
    });
  }, []);

  const send = React.useCallback(async (text: string, opts: SendOptions) => {
    const message = text.trim();
    if (!message || busy) return;
    const user: ChatMessage = { ...newAssistantMessage(nextKey()), role: "user", text: message, status: "done" };
    const answer = newAssistantMessage(nextKey());
    setLive([...messages, user, answer]);
    const c = new AbortController();
    ctl.current = c;
    try {
      await streamChat({ message, smart: opts.smart || undefined, intent: opts.intent, context: opts.context }, (e) => patchLast((m) => applyEvent(m, e)), c.signal);
      patchLast((m) => (m.status === "streaming" ? { ...m, status: c.signal.aborted ? "stopped" : "done" } : m));
    } catch (err) {
      if (c.signal.aborted) { patchLast((m) => ({ ...m, status: "stopped" })); return; }
      const code = isApiError(err) ? err.code ?? `HTTP_${err.status}` : "NETWORK";
      patchLast((m) => ({ ...m, status: "error", error: { code, message: err instanceof Error ? err.message : String(err) } }));
      if (code === "AI_NOT_CONFIGURED" || code === "AI_ASSISTANT_OFF" || code === "AI_ASSISTANT_STAGE") void qc.invalidateQueries({ queryKey: assistantKeys.status() });
    } finally {
      if (ctl.current === c) ctl.current = null;
      void qc.invalidateQueries({ queryKey: assistantKeys.status() }); // the budget line moves
    }
  }, [busy, messages, patchLast, qc]);

  const stop = React.useCallback(() => { ctl.current?.abort(); }, []);

  const clear = React.useCallback(async () => {
    ctl.current?.abort();
    await clearHistory();
    setLive([]);
    qc.setQueryData(assistantKeys.history(), { messages: [] });
  }, [qc]);

  React.useEffect(() => () => ctl.current?.abort(), []);

  return { messages, busy, loading: history.isLoading, send, stop, clear };
}
