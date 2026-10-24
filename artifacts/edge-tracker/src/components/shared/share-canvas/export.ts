/**
 * What the image-card dialogs do with a PNG: download it, copy it to the clipboard, hand it to the system share sheet
 * (on phones that is the sheet with Telegram). Everything stays in the browser. Each helper resolves to an outcome the
 * dialog turns into its own toast.
 */

/** Can this browser hand a PNG file to the system share sheet? */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
    return navigator.canShare({ files: [new File([new Uint8Array([0])], "probe.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

/** Save the blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type CopyOutcome = "copied" | "unsupported" | "failed";

/** Put a PNG on the clipboard. The promise goes inside the item: Safari keeps the user activation that way. */
export async function copyPng(png: Promise<Blob | null>): Promise<CopyOutcome> {
  const Item = (window as Window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!Item || !navigator.clipboard?.write) return "unsupported";
  try {
    const data = png.then((b) => b ?? Promise.reject(new Error("no image")));
    await navigator.clipboard.write([new Item({ "image/png": data })]);
    return "copied";
  } catch {
    return "failed";
  }
}

export type ShareOutcome = "shared" | "cancelled" | "failed";

/** Open the system share sheet with the PNG as a file. */
export async function sharePng(blob: Blob, fileName: string, title: string): Promise<ShareOutcome> {
  const file = new File([blob], fileName, { type: "image/png" });
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (e) {
    return (e as Error)?.name === "AbortError" ? "cancelled" : "failed";
  }
}
