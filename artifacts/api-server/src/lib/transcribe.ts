import OpenAI from "openai";
import { logger } from "./logger";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
});

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  try {
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "wav";
    const uint8 = new Uint8Array(audioBuffer);
    const file = new File([uint8], `audio.${ext}`, { type: mimeType });
    const response = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
      response_format: "json",
    });
    return response.text ?? "";
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ error: msg }, "Transcription failed");
    throw new Error(`Transcription failed: ${msg}`);
  }
}
