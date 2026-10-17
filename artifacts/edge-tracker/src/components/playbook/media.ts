import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { compressImage, imageFilesFrom } from "@/components/game-plan/media";

/**
 * Playbook screenshots (setup card + example trades): same approach as game-plan media —
 * client-side compression → POST /api/playbook-media?playbookId= (raw bytes) → { id }.
 * Read back with fetch() (the global fetch adds the Bearer token) and shown as blob: URLs, so no token
 * ever ends up in an <img src>. compressImage / imageFilesFrom are imported read-only from game-plan.
 */
export { imageFilesFrom };

export type UploadedPlaybookMedia = { id: number; url: string; size: number };

const blobUrls = new Map<number, string>();
const inflight = new Map<number, Promise<string>>();

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* not json */
  }
  if (res.status === 404) return "Скриншоты включатся после обновления сервера";
  return `Ошибка ${res.status}`;
}

export async function uploadPlaybookImage(file: Blob, playbookId: number): Promise<UploadedPlaybookMedia> {
  const { blob, width, height } = await compressImage(file);
  const qs = new URLSearchParams({ playbookId: String(playbookId), w: String(width), h: String(height) });
  const res = await fetch(apiUrl(`/api/playbook-media?${qs.toString()}`), {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new Error(await errorText(res));
  const out = (await res.json()) as UploadedPlaybookMedia;
  blobUrls.set(out.id, URL.createObjectURL(blob));
  return out;
}

function loadImage(id: number): Promise<string> {
  const cached = blobUrls.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = fetch(apiUrl(`/api/playbook-media/${id}`))
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      blobUrls.set(id, url);
      return url;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** blob: URL for a stored screenshot (null while loading; "error" when it can't be shown). */
export function usePlaybookMediaUrl(id: number | null | undefined): string | null | "error" {
  const [state, setState] = useState<string | null | "error">(() => (id ? blobUrls.get(id) ?? null : null));
  useEffect(() => {
    if (!id) { setState(null); return; }
    let alive = true;
    const hit = blobUrls.get(id);
    if (hit) { setState(hit); return; }
    setState(null);
    loadImage(id).then((u) => alive && setState(u)).catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [id]);
  return state;
}
