/**
 * «✦ Помочь» — POST /api/ai/assistant/assist (api-server routes/ai-assistant.ts): the assistant rewrites a text field
 * (improve the wording, lay it out as a setup, fill gaps from linked trades) and returns a suggestion the person
 * accepts or rejects. Nothing is saved by the call; the field changes only on «Принять».
 */
import { http } from "@/lib/api/http";
import type { PageContext } from "./model";

export type AssistAction = "improve" | "structure" | "fill";
export type AssistField = "playbook" | "plan" | "eod" | "journal" | "note";
export type AssistResult = { suggestion: string; tier: "standard" | "boost" | "deep"; units: number; refused: boolean };

export function assistText(body: { action: AssistAction; field: AssistField; text: string; context?: PageContext }, signal?: AbortSignal): Promise<AssistResult> {
  return http.post<AssistResult>("/api/ai/assistant/assist", body, { signal });
}
