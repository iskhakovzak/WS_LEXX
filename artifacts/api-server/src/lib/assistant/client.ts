/**
 * The model client the assistant engine talks to — one small interface over the Anthropic SDK stream, so tests and
 * the dev-only scripted model (mockClient.ts) plug in without a network.
 *
 * Real client (lib/integrations-anthropic-ai, key AI_INTEGRATIONS_ANTHROPIC_API_KEY):
 *   - Haiku 5.5: client.messages.stream (no server-side fallback exists for Haiku).
 *   - Sonnet 5.5 / Opus 5.5: client.beta.messages.stream with the server-side refusal fallback
 *     (beta server-side-fallback-2026-07-01, fallbacks: "default") — on a policy decline the API re-runs the request on
 *     a fallback model inside the same call; fallback blocks in the content are echoed back like any other block.
 * Effort is set explicitly (medium) — Haiku 5.5 defaults to medium, Sonnet 5.5 to high; adaptive thinking stays on by
 * default (it is never disabled on these models), thinking text is not displayed.
 */
import { getAnthropic, isAnthropicConfigured, type Anthropic } from "@workspace/integrations-anthropic-ai";
import { config } from "../../config";
import type { AssistantModel } from "./models";
import { mockClient } from "./mockClient";

export type StreamParams = {
  model: AssistantModel;
  max_tokens: number;
  system: Anthropic.TextBlockParam[];
  tools: Array<Record<string, unknown>>;
  messages: Anthropic.MessageParam[];
  output_config: { effort: "low" | "medium" | "high" };
};

export interface TurnStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
  abort(): void;
}

export interface AssistantClient {
  readonly kind: "anthropic" | "mock" | "test";
  stream(params: StreamParams, opts: { signal: AbortSignal }): TurnStream;
}

const FALLBACK_MODELS: ReadonlySet<AssistantModel> = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

function anthropicClient(): AssistantClient {
  return {
    kind: "anthropic",
    stream(params, { signal }) {
      const sdk = getAnthropic();
      if (FALLBACK_MODELS.has(params.model)) {
        // `fallbacks` is newer than the pinned SDK's types; the request body passes it through unchanged.
        const body = { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
        return sdk.beta.messages.stream(body as unknown as Parameters<typeof sdk.beta.messages.stream>[0], { signal }) as unknown as TurnStream;
      }
      return sdk.messages.stream(params as unknown as Parameters<typeof sdk.messages.stream>[0], { signal }) as unknown as TurnStream;
    },
  };
}

let override: AssistantClient | null = null;

/** Tests only: route every assistant call to this client (null = back to the real resolution). */
export function __setAssistantClientForTests(c: AssistantClient | null): void {
  override = c;
}

/** The client for this process, or null when the assistant cannot run (no key and no dev mock) → 503 AI_NOT_CONFIGURED. */
export function assistantClient(): AssistantClient | null {
  if (override) return override;
  // An explicit dev mock wins over a key (a demo never spends money by accident); production ignores the flag.
  if (config.ai.assistantMock) return mockClient();
  if (isAnthropicConfigured()) return anthropicClient();
  return null;
}
