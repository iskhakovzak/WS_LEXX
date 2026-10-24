/**
 * Incremental parser of the assistant's Server-Sent Events (POST /api/ai/assistant/chat; server framing in
 * api-server lib/assistant/sse.ts). Chunks may split a frame anywhere; comment lines (`: ping`) are ignored.
 */

export type AssistantEvent =
  | { event: "meta"; data: { model: string; reason: string; escalated: boolean; smart: boolean } }
  | { event: "model"; data: { model: string; reason: string } }
  | { event: "text"; data: { delta: string } }
  | { event: "retry"; data: Record<string, never> }
  | { event: "tool"; data: { id: string; name: string; status: "start" | "done" | "error"; code?: string } }
  | { event: "draft"; data: { id: string; kind: DraftKind; draft: Record<string, unknown> } }
  | { event: "done"; data: { messageId: number | null; model: string; models: string[]; usage: unknown; costUsd: number; stop: string } }
  | { event: "error"; data: { code: string; message: string } };

export type DraftKind = "playbook" | "plan" | "eod" | "rule" | "curatorNote";

const KNOWN = new Set(["meta", "model", "text", "retry", "tool", "draft", "done", "error"]);

export function createSseParser(): { feed: (chunk: string) => AssistantEvent[]; flush: () => AssistantEvent[] } {
  let buf = "";
  const parseFrame = (frame: string): AssistantEvent | null => {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (!KNOWN.has(event) || !data.length) return null;
    try {
      return { event, data: JSON.parse(data.join("\n")) } as AssistantEvent;
    } catch {
      return null;
    }
  };
  const take = (final: boolean): AssistantEvent[] => {
    buf = buf.replace(/\r\n/g, "\n");
    const out: AssistantEvent[] = [];
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const e = parseFrame(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (e) out.push(e);
    }
    if (final && buf.trim()) {
      const e = parseFrame(buf);
      buf = "";
      if (e) out.push(e);
    }
    return out;
  };
  return {
    feed: (chunk) => { buf += chunk; return take(false); },
    flush: () => take(true),
  };
}
