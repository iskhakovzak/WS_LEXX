/**
 * The nightly batch gathers a review's inputs exactly like a live review — through the app's own API — but there is no
 * request to borrow a token from. It reads AS the trader: a 15-minute token for that member (lib/auth
 * signServiceToken), sent over loopback to this same server only, so the review sees what the trader could open in
 * the app (same scope rules, section locks, $ redaction) and nothing more.
 */
import { config } from "../../../config";
import { signServiceToken } from "../../auth";
import type { Lang } from "../../../i18n";
import type { ApiCaller } from "../internalApi";

export async function memberCaller(u: { id: number; name: string; role: string }, lang: Lang, signal?: AbortSignal): Promise<ApiCaller> {
  const port = config.port ?? Number(process.env.PORT);
  const token = await signServiceToken(u);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    headers: { accept: "application/json", "x-lang": lang, "x-assistant": "1", authorization: `Bearer ${token}` },
    signal,
  };
}
