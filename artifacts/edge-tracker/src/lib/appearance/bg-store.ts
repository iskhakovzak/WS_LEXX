/**
 * The custom background image («Вид» → Фон): kept in IndexedDB on this device only, never uploaded. The file is
 * downscaled (long side ≤ 2400 px) and re-encoded before it is stored, so a 12 MB phone photo becomes a few hundred
 * kilobytes and the page paints it cheaply. One image per browser profile (key "bg").
 */

const DB_NAME = "ws_lexx_appearance";
const STORE = "files";
const KEY = "bg";
const MAX_SIDE = 2400;
/** Inputs above this are refused before decoding (a 40 MP RAW export would stall the tab). */
export const BG_MAX_INPUT_BYTES = 25 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function loadBgImage(): Promise<Blob | null> {
  try {
    const v = await tx<unknown>("readonly", (s) => s.get(KEY));
    return v instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

export async function saveBgImage(blob: Blob): Promise<void> {
  await tx("readwrite", (s) => s.put(blob, KEY));
}

export async function deleteBgImage(): Promise<void> {
  try { await tx("readwrite", (s) => s.delete(KEY)); } catch { /* nothing stored */ }
}

/** Decode → downscale → re-encode (WebP, JPEG fallback). Throws on a non-image or an oversized file. */
export async function prepareBgImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("not-image");
  if (file.size > BG_MAX_INPUT_BYTES) throw new Error("too-big");
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no-canvas");
    ctx.drawImage(bmp, 0, 0, w, h);
    const encode = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.82));
    const out = (await encode("image/webp")) ?? (await encode("image/jpeg"));
    if (!out) throw new Error("encode-failed");
    return out;
  } finally {
    bmp.close();
  }
}
