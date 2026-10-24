/**
 * The Message Batches client the nightly AI reviews use (lib/assistant/batch) — one small interface over the SDK, so
 * tests and the dev-only scripted model plug in without a network (same pattern as client.ts / mockClient.ts).
 *
 * Message Batches API (docs: build-with-claude/batch-processing, 2026-10): up to 100,000 requests / 256 MB per batch,
 * most end within an hour, at most 24 h (then the unprocessed requests come back `expired`, unbilled); results stay
 * downloadable for 29 days, as JSONL in ANY order (matched by custom_id); every token costs 50% of the standard price.
 * Supported inside a batch: tools including the server tools (the advisor among them), structured outputs, prompt
 * caching (best effort — the 1-hour TTL is recommended because a batch can outlive the 5-minute cache) and most beta
 * features. Not supported: stream, speed, `fallbacks` (server-side refusal fallback) and max_tokens 0 — so a batch
 * request never carries the fallback beta / parameter, and a refusal comes back as stop_reason "refusal".
 * A request carrying the advisor tool is sent on the beta endpoint with the beta advisor-tool-2026-03-01.
 */
import { getAnthropic, isAnthropicConfigured, type Anthropic } from "@workspace/integrations-anthropic-ai";
import { config } from "../../config";
import { ADVISOR_BETA, hasAdvisor, type AssistantClient, type StreamParams } from "./client";
import { mockClient } from "./mockClient";

export type BatchRequest = { custom_id: string; params: StreamParams };

export type BatchCounts = { processing: number; succeeded: number; errored: number; canceled: number; expired: number };

export type BatchInfo = {
  id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: BatchCounts;
  created_at?: string | null;
  expires_at?: string | null;
  ended_at?: string | null;
};

export type BatchResultLine = {
  custom_id: string;
  result:
    | { type: "succeeded"; message: Anthropic.Message }
    | { type: "errored"; error?: { type?: string; error?: { type?: string; message?: string } } }
    | { type: "canceled" }
    | { type: "expired" };
};

export interface BatchClient {
  readonly kind: "anthropic" | "mock" | "test";
  create(requests: BatchRequest[]): Promise<BatchInfo>;
  retrieve(id: string): Promise<BatchInfo>;
  results(id: string): AsyncIterable<BatchResultLine>;
}

/** Beta flags of a batch: the advisor beta when any request carries the advisor tool (never the fallback beta). */
export function batchBetas(requests: readonly BatchRequest[]): string[] {
  return requests.some((r) => hasAdvisor(r.params)) ? [ADVISOR_BETA] : [];
}

function anthropicBatchClient(): BatchClient {
  return {
    kind: "anthropic",
    async create(requests) {
      const sdk = getAnthropic();
      const betas = batchBetas(requests);
      // The advisor tool and output_config.format are newer than the pinned SDK's types; the body passes through.
      const body = { requests, ...(betas.length ? { betas } : {}) };
      const created = betas.length
        ? await sdk.beta.messages.batches.create(body as unknown as Parameters<typeof sdk.beta.messages.batches.create>[0])
        : await sdk.messages.batches.create(body as unknown as Parameters<typeof sdk.messages.batches.create>[0]);
      return created as unknown as BatchInfo;
    },
    async retrieve(id) {
      return (await getAnthropic().messages.batches.retrieve(id)) as unknown as BatchInfo;
    },
    async *results(id) {
      // The beta decoder reads every content block type (advisor results included).
      for await (const line of await getAnthropic().beta.messages.batches.results(id)) yield line as unknown as BatchResultLine;
    },
  };
}

/**
 * DEVELOPMENT ONLY (AI_ASSISTANT_MOCK, see mockClient.ts): a batch that "ends" at once, its results written by the
 * scripted model. Kept in memory — a restart forgets it (the job then marks the batch failed when it cannot be read).
 */
export function batchFromClient(client: AssistantClient, kind: BatchClient["kind"] = "mock"): BatchClient {
  const batches = new Map<string, BatchRequest[]>();
  let seq = 0;
  const info = (id: string, n: number): BatchInfo => ({
    id, processing_status: "ended", request_counts: { processing: 0, succeeded: n, errored: 0, canceled: 0, expired: 0 }, created_at: new Date().toISOString(),
  });
  return {
    kind,
    async create(requests) {
      const id = `msgbatch_mock_${Date.now()}_${++seq}`;
      batches.set(id, requests);
      return info(id, requests.length);
    },
    async retrieve(id) {
      const reqs = batches.get(id);
      if (!reqs) throw new Error(`unknown batch ${id}`);
      return info(id, reqs.length);
    },
    async *results(id) {
      for (const r of batches.get(id) ?? []) {
        const stream = client.stream(r.params, { signal: new AbortController().signal });
        for await (const _ev of stream) { /* drain */ }
        yield { custom_id: r.custom_id, result: { type: "succeeded", message: await stream.finalMessage() } };
      }
    },
  };
}

let override: BatchClient | null = null;

/** Tests only: route every batch call to this client (null = back to the real resolution). */
export function __setBatchClientForTests(c: BatchClient | null): void {
  override = c;
}

let devMock: BatchClient | null = null;

/** The batch client for this process, or null when no key is configured (the nightly job then skips cleanly). */
export function batchClient(): BatchClient | null {
  if (override) return override;
  if (config.ai.assistantMock) return (devMock ??= batchFromClient(mockClient()));
  if (isAnthropicConfigured()) return anthropicBatchClient();
  return null;
}
