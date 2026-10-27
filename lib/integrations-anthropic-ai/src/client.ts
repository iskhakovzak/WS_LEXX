import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export class AnthropicNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`${missing} must be set. Did you forget to provision the Anthropic AI integration?`);
    this.name = "AnthropicNotConfiguredError";
  }
}

/**
 * The API key: AI_INTEGRATIONS_ANTHROPIC_API_KEY only (docs/AI_ASSISTANT.md). A shell-wide ANTHROPIC_API_KEY is ignored on
 * purpose, so the server never spends a key nobody configured for it. Never logged, never sent to a browser.
 */
function apiKey(): string | undefined {
  return process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY?.trim() || undefined;
}

/**
 * Configured = an API key is present. AI_INTEGRATIONS_ANTHROPIC_BASE_URL is optional: unset → the SDK default
 * (api.anthropic.com), which is what a key from platform.claude.com needs.
 */
export function isAnthropicConfigured(): boolean {
  return Boolean(apiKey());
}

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  const key = apiKey();
  if (!key) throw new AnthropicNotConfiguredError("AI_INTEGRATIONS_ANTHROPIC_API_KEY");
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL?.trim() || undefined;
  cached = new Anthropic({ apiKey: key, ...(baseURL ? { baseURL } : {}) });
  return cached;
}

export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_t, prop) {
    return (getAnthropic() as any)[prop];
  },
});
