import { safeHttpUrl } from "@/lib/url";

/** Local calendar date YYYY-MM-DD (toISOString() would give the UTC date). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function initials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

const AVATAR_TONES = [
  "bg-[hsl(var(--chart-1)/0.18)] text-[hsl(var(--chart-1))]",
  "bg-[hsl(var(--chart-2)/0.18)] text-[hsl(var(--chart-2))]",
  "bg-[hsl(var(--chart-3)/0.18)] text-[hsl(var(--chart-3))]",
  "bg-[hsl(var(--chart-5)/0.18)] text-[hsl(var(--chart-5))]",
  "bg-[hsl(var(--chart-4)/0.18)] text-[hsl(var(--chart-4))]",
];

/** Stable tint per name so the same trader always has the same avatar colour. */
export function avatarTone(name: string | null | undefined): string {
  const n = name ?? "";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function fmtR(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const f = Math.abs(v).toFixed(digits);
  const s = f.includes(".") ? f.replace(/\.?0+$/, "") : f;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}R`;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const txt = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}$${txt}`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

/** First screenshot URL from a trade's newline-separated screenshotUrl field. */
export function firstScreenshot(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const line of raw.split("\n")) {
    const u = safeHttpUrl(line.trim());
    if (u) return u;
  }
  return null;
}

export function allScreenshots(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split("\n").map((l) => safeHttpUrl(l.trim())).filter((u): u is string => !!u);
}

/** Image URL usable in <img>: direct image links as-is, TradingView /x/ID snapshots → S3 PNG, else null. */
export function thumbUrl(url: string | null | undefined): string | null {
  const u = safeHttpUrl(url);
  if (!u) return null;
  const tv = u.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (tv) {
    const id = tv[1];
    return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
  }
  if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(u)) return u;
  if (/i\.imgur\.com|prnt\.sc\/.+\.png|cdn\.discordapp\.com\/attachments/i.test(u)) return u;
  return null;
}

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** True when the keyboard event originates in a text-entry control (so page shortcuts should not fire). */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
