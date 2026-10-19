/**
 * Does the configured PropReports token have superuser rights? The vendor has no "who am I" action: a superuser-only
 * action (instruments, profiles, upload*) answers 403 without the right. The answer is remembered in
 * propreports_cursors ("api:superuser") together with a fingerprint of host + token (./client.ts tokenFingerprint —
 * never the token), so a new token is re-detected. The integrations UI hides the superuser panel once it is false.
 */
import { getCursor, setCursor } from "./tick/cursor";
import type { PropReportsClient } from "./client";

export const SUPERUSER_KEY = "api:superuser";

export type SuperuserState = { superuser: boolean | null; checkedAt: string | null; via: string | null };

type Stored = { fingerprint: string; superuser: boolean; checkedAt: string; via: string };

export async function superuserState(client: Pick<PropReportsClient, "tokenFingerprint">): Promise<SuperuserState> {
  const s = await getCursor<Stored>(SUPERUSER_KEY).catch(() => null);
  if (!s || s.fingerprint !== client.tokenFingerprint) return { superuser: null, checkedAt: null, via: null };
  return { superuser: s.superuser, checkedAt: s.checkedAt, via: s.via };
}

/** Store the answer (skips the write when nothing changed). */
export async function rememberSuperuser(client: Pick<PropReportsClient, "tokenFingerprint">, superuser: boolean, via: string): Promise<SuperuserState> {
  const fingerprint = client.tokenFingerprint;
  const prev = await getCursor<Stored>(SUPERUSER_KEY).catch(() => null);
  if (prev && prev.fingerprint === fingerprint && prev.superuser === superuser) return { superuser, checkedAt: prev.checkedAt, via: prev.via };
  const next: Stored = { fingerprint, superuser, checkedAt: new Date().toISOString(), via };
  await setCursor(SUPERUSER_KEY, next);
  return { superuser, checkedAt: next.checkedAt, via };
}
