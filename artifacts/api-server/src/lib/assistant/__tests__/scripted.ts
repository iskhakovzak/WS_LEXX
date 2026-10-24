/**
 * Test double of the model: a scripted AssistantClient. Each request takes the next step of the script (a function
 * of the request, so a step can look at the tool results it was given) and streams it like the SDK would.
 * No network, no key — tests never call Anthropic.
 */
import type { Anthropic } from "@workspace/integrations-anthropic-ai";
import type { AssistantClient, StreamParams, TurnStream } from "../client";

export type ScriptStep =
  | { text?: string; tools?: { name: string; input: unknown; id?: string }[]; stop?: string; usage?: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }> }
  | { throw: unknown };

export type Scripted = AssistantClient & { calls: StreamParams[] };

let seq = 0;

export function scriptedClient(steps: Array<ScriptStep | ((p: StreamParams) => ScriptStep)>): Scripted {
  const calls: StreamParams[] = [];
  let i = 0;
  return {
    kind: "test",
    calls,
    stream(params): TurnStream {
      calls.push(JSON.parse(JSON.stringify(params)));
      const raw = steps[Math.min(i, steps.length - 1)]!;
      i++;
      const step = typeof raw === "function" ? raw(params) : raw;
      if ("throw" in step) {
        return {
          [Symbol.asyncIterator]: async function* () { throw step.throw; },
          finalMessage: async () => { throw step.throw; },
          abort: () => undefined,
        } as TurnStream;
      }
      const content: unknown[] = [];
      if (step.text) content.push({ type: "text", text: step.text, citations: null });
      for (const t of step.tools ?? []) content.push({ type: "tool_use", id: t.id ?? `toolu_${++seq}`, name: t.name, input: t.input });
      const message = {
        id: `msg_${++seq}`, type: "message", role: "assistant", model: params.model, content,
        stop_reason: step.stop ?? (step.tools?.length ? "tool_use" : "end_turn"), stop_sequence: null,
        usage: { input_tokens: step.usage?.input ?? 100, output_tokens: step.usage?.output ?? 50, cache_read_input_tokens: step.usage?.cacheRead ?? 0, cache_creation_input_tokens: step.usage?.cacheWrite ?? 0 },
      } as unknown as Anthropic.Message;
      async function* events(): AsyncGenerator<Anthropic.MessageStreamEvent> {
        let idx = 0;
        for (const b of content as Array<Record<string, any>>) {
          if (b.type === "text") {
            yield { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } } as unknown as Anthropic.MessageStreamEvent;
            for (const part of String(b.text).match(/.{1,5}/gs) ?? []) yield { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: part } } as Anthropic.MessageStreamEvent;
          } else {
            yield { type: "content_block_start", index: idx, content_block: { ...b, input: {} } } as unknown as Anthropic.MessageStreamEvent;
          }
          yield { type: "content_block_stop", index: idx } as Anthropic.MessageStreamEvent;
          idx++;
        }
      }
      return { [Symbol.asyncIterator]: () => events(), finalMessage: async () => message, abort: () => undefined };
    },
  };
}

/** The tool_result contents the model received in a request (by tool_use id order). */
export function toolResultsIn(p: StreamParams): string[] {
  const last = p.messages[p.messages.length - 1];
  if (!last || typeof last.content === "string") return [];
  return last.content.filter((b) => b.type === "tool_result").map((b) => String((b as { content?: unknown }).content ?? ""));
}
