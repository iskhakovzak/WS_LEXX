/**
 * The model client the assistant engine talks to — one small interface over the Anthropic SDK stream, so tests and
 * the dev-only scripted model (mockClient.ts) plug in without a network.
 *
 * Real client (lib/integrations-anthropic-ai, key AI_INTEGRATIONS_ANTHROPIC_API_KEY):
 *   - Haiku 5.5 without the advisor: client.messages.stream (no server-side fallback exists for Haiku).
 *   - Sonnet 5.5 / Opus 5.5: client.beta.messages.stream with the server-side refusal fallback
 *     (beta server-side-fallback-2026-07-01, fallbacks: "default").
 *   - Any request carrying the advisor tool (type advisor_20260301): client.beta.messages.stream with the beta
 *     advisor-tool-2026-03-01 (plus the fallback beta on a model that has one). Advisor usage comes back in
 *     usage.iterations (type advisor_message, with its model); the top-level usage counts the executor only.
 * Effort is set explicitly — Haiku 5.5 defaults to medium, Sonnet 5.5 to high; adaptive thinking stays on by default
 * (it is never disabled on these models), thinking text is not displayed.
 */
import { getAnthropic, isAnthropicConfigured, type Anthropic } from "@workspace/integrations-anthropic-ai";
import { config } from "../../config";
import type { AssistantModel } from "./models";
import { mockClient } from "./mockClient";

export const ADVISOR_BETA = "advisor-tool-2026-03-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The advisor tool definition (docs: advisor tool; max_tokens >= 1024 bounds the advisor's output per call). */
export type AdvisorTool = { type: "advisor_20260301"; name: "advisor"; model: AssistantModel; max_uses?: number; max_tokens?: number };

export type StreamParams = {
  model: AssistantModel;
  max_tokens: number;
  system: Anthropic.TextBlockParam[];
  tools: Array<Record<string, unknown>>;
  messages: Anthropic.MessageParam[];
  output_config: { effort: "low" | "medium" | "high"; format?: { type: "json_schema"; schema: Record<string, unknown> } };
  tool_choice?: { type: "none" | "auto" };
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

export function hasAdvisor(params: Pick<StreamParams, "tools">): boolean {
  return params.tools.some((t) => t.type === "advisor_20260301");
}

/** The beta flags a request needs (empty = the plain Messages API). Exported for tests. */
export function betasFor(params: Pick<StreamParams, "model" | "tools">): string[] {
  const betas: string[] = [];
  if (hasAdvisor(params)) betas.push(ADVISOR_BETA);
  if (FALLBACK_MODELS.has(params.model)) betas.push(FALLBACK_BETA);
  return betas;
}

function anthropicClient(): AssistantClient {
  return {
    kind: "anthropic",
    stream(params, { signal }) {
      const sdk = getAnthropic();
      const betas = betasFor(params);
      if (betas.length) {
        // `fallbacks` and the advisor tool are newer than the pinned SDK's types; the body passes through unchanged.
        const body = { ...params, betas, ...(FALLBACK_MODELS.has(params.model) ? { fallbacks: "default" } : {}) };
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
