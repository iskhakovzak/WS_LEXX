/**
 * Usage of one Messages API response, per model — the executor's own tokens plus the advisor's sub-inferences.
 *
 * Advisor tool (docs): the top-level usage fields sum the executor iterations only; each advisor call is an entry of
 * usage.iterations with type "advisor_message" and its `model`, billed at that model's rates. Both are counted here
 * (cost at each model's prices, budget units at each model's weight — the advisor model is never the default one, so
 * its tokens count at the boost multiplier).
 */
import type { Anthropic } from "@workspace/integrations-anthropic-ai";
import { isAssistantModel, type AssistantModel, type Usage } from "./models";

type RawUsage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
type Iteration = RawUsage & { type?: string; model?: string };

const toUsage = (u: RawUsage | null | undefined): Usage => ({
  input: u?.input_tokens ?? 0,
  output: u?.output_tokens ?? 0,
  cacheRead: u?.cache_read_input_tokens ?? 0,
  cacheWrite: u?.cache_creation_input_tokens ?? 0,
});

export type ModelUsage = { model: AssistantModel; usage: Usage; advisor: boolean };

/**
 * Per-model usage of a response. `advisorModel` names the advisor when an iteration does not carry a known model id
 * (it is billed as that model, never as the cheap executor).
 */
export function usagesOf(executor: AssistantModel, m: Pick<Anthropic.Message, "usage">, advisorModel: AssistantModel | null = null): ModelUsage[] {
  const out: ModelUsage[] = [{ model: executor, usage: toUsage(m.usage as RawUsage), advisor: false }];
  const its = (m.usage as { iterations?: Iteration[] | null } | undefined)?.iterations;
  if (!Array.isArray(its)) return out;
  for (const it of its) {
    if (it?.type !== "advisor_message") continue;
    const model = isAssistantModel(it.model) ? it.model : advisorModel;
    if (!model) continue;
    const prev = out.find((x) => x.advisor && x.model === model);
    const u = toUsage(it);
    if (prev) prev.usage = { input: prev.usage.input + u.input, output: prev.usage.output + u.output, cacheRead: prev.usage.cacheRead + u.cacheRead, cacheWrite: prev.usage.cacheWrite + u.cacheWrite };
    else out.push({ model, usage: u, advisor: true });
  }
  return out;
}

/** Number of advisor consultations in a response (server_tool_use blocks named "advisor"). */
export function advisorCalls(m: Pick<Anthropic.Message, "content">): number {
  return (m.content as Array<{ type: string; name?: string }>).filter((b) => b.type === "server_tool_use" && b.name === "advisor").length;
}
