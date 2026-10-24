/**
 * Server-Sent Events framing for POST /api/ai/assistant/chat (pure + a tiny writer over an express Response).
 *
 *   event: <name>\n
 *   data: <one line of JSON>\n
 *   \n
 *
 * Events (the web parser is edge-tracker src/lib/assistant/sse.ts):
 *   meta   { model, reason, escalated, smart }                 first frame: the model the turn starts on
 *   model  { model, reason }                                   mid-turn escalation (the label on the answer changes)
 *   text   { delta }                                           answer text (markdown), in order
 *   retry  {}                                                  drop the text of the current step (the step is re-run)
 *   tool   { id, name, status: start | done | error, code? }    the «смотрю ваши сделки…» chips
 *   draft  { id, kind, draft }                                 a structured draft card (never saved by the server)
 *   done   { messageId, model, models, usage, costUsd, stop }   the end of a successful turn
 *   error  { code, message }                                   the end of a failed turn (HTTP status stays 200 once streaming started)
 * A comment line (`: ping`) keeps proxies from closing an idle stream while a tool runs.
 */
import type { Response } from "express";

export type SseEvent =
  | { event: "meta"; data: { model: string; reason: string; escalated: boolean; smart: boolean } }
  | { event: "model"; data: { model: string; reason: string } }
  | { event: "text"; data: { delta: string } }
  | { event: "retry"; data: Record<string, never> }
  | { event: "tool"; data: { id: string; name: string; status: "start" | "done" | "error"; code?: string } }
  | { event: "draft"; data: { id: string; kind: string; draft: unknown } }
  | { event: "done"; data: { messageId: number | null; model: string; models: string[]; usage: unknown; costUsd: number; stop: string } }
  | { event: "error"; data: { code: string; message: string } };

/** One SSE frame. JSON never contains a raw newline, so `data:` is always a single line. */
export function sseFrame(e: SseEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

export const SSE_PING = ": ping\n\n";

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // nginx / reverse proxies: do not buffer the stream
  "X-Accel-Buffering": "no",
};

export type SseWriter = { send: (e: SseEvent) => void; close: () => void; closed: () => boolean };

/** Start an SSE response: headers, flush, a ping every `pingMs`. `send` after the client left is a no-op. */
export function openSse(res: Response, pingMs = 15_000): SseWriter {
  res.status(200);
  for (const [k, v] of Object.entries(SSE_HEADERS)) res.setHeader(k, v);
  res.flushHeaders?.();
  let done = false;
  const write = (chunk: string) => {
    if (done || res.writableEnded || res.destroyed) return;
    res.write(chunk);
  };
  const ping = setInterval(() => write(SSE_PING), pingMs);
  ping.unref?.();
  res.on("close", () => { done = true; clearInterval(ping); });
  return {
    send: (e) => write(sseFrame(e)),
    close: () => {
      clearInterval(ping);
      if (!done && !res.writableEnded) res.end();
      done = true;
    },
    closed: () => done || res.writableEnded || res.destroyed,
  };
}
