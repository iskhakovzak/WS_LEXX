/**
 * «Картинка с цитатой»: a 1080×1350 card — an «Олимп» artwork (components/shared/share-canvas) under shades, the
 * category, a large opening mark, the quote in an italic serif fitted to the space, the speaker and the source, the
 * WS_Desk line and the artwork credit. Plain Canvas 2D; layout maths (fitQuote) is pure.
 */
import { drawBackdrop } from "@/components/shared/share-canvas/backdrop";
import { font, rgba, shadowed, spaced, wrapLines, ellipsize } from "@/components/shared/share-canvas/canvas";

export const QUOTE_CARD_W = 1080;
export const QUOTE_CARD_H = 1350;
const M = 96;
const GOLD = { r: 232, g: 195, b: 106 };
/** The app's accent serif (index.css --app-font-serif — the lock clock's face): system faces with Cyrillic and Greek. */
export const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
const serif = (size: number, italic = true, weight = 500) => `${italic ? "italic " : ""}${weight} ${size}px ${SERIF}`;

export interface QuoteCardInput {
  text: string;
  marks: readonly [string, string];
  author: string;
  citation: string;
  category: string;
  attributed: string | null;
  image: CanvasImageSource | null;
  imageSize: { w: number; h: number } | null;
  credit: string | null;
}

/** Largest font size (step 2) whose wrapped lines fit `maxH` with the given line height; returns the size and lines. */
export function fitQuote(
  text: string,
  maxW: number,
  maxH: number,
  measureAt: (s: string, size: number) => number,
  { max = 76, min = 34, lineHeight = 1.32 } = {},
): { size: number; lines: string[] } {
  for (let size = max; size >= min; size -= 2) {
    const maxLines = Math.floor(maxH / (size * lineHeight));
    if (maxLines < 1) continue;
    const lines = wrapLines(text, maxW, maxLines + 1, (s) => measureAt(s, size));
    if (lines.length <= maxLines && !lines[lines.length - 1]?.endsWith("…")) return { size, lines };
  }
  const maxLines = Math.max(1, Math.floor(maxH / (min * lineHeight)));
  return { size: min, lines: wrapLines(text, maxW, maxLines, (s) => measureAt(s, min)) };
}

export function drawQuoteCard(ctx: CanvasRenderingContext2D, d: QuoteCardInput): void {
  const W = QUOTE_CARD_W, H = QUOTE_CARD_H;
  drawBackdrop(ctx, { theme: "olymp", tone: null, image: d.image, imageSize: d.imageSize, seed: 7 }, { w: W, h: H }, 1.35);

  // Category + WS line at the top.
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = rgba(GOLD, 0.95);
  ctx.font = font(700, 26);
  spaced(ctx, 6);
  ctx.fillText(d.category.toUpperCase(), M, 132);
  if (d.attributed) {
    const w = ctx.measureText(d.category.toUpperCase()).width;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = font(600, 22);
    spaced(ctx, 3);
    ctx.fillText(`· ${d.attributed.toUpperCase()}`, M + w + 18, 132);
  }
  ctx.restore();

  // Opening mark.
  ctx.save();
  ctx.fillStyle = rgba(GOLD, 0.9);
  ctx.font = serif(220, false, 600);
  ctx.textBaseline = "alphabetic";
  shadowed(ctx, 30, 0.45);
  ctx.fillText(d.marks[0], M - 10, 360);
  ctx.restore();

  // The quote.
  const top = 400, bottom = H - 330;
  ctx.save();
  const { size, lines } = fitQuote(`${d.text}${d.marks[1]}`, W - 2 * M, bottom - top, (s, px) => { ctx.font = serif(px); return ctx.measureText(s).width; });
  ctx.font = serif(size);
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.textBaseline = "top";
  shadowed(ctx, 18, 0.6);
  const lh = size * 1.32;
  lines.forEach((ln, i) => ctx.fillText(ln, M, top + i * lh));
  const textEnd = top + lines.length * lh;
  ctx.restore();

  // Speaker and source.
  const y = Math.min(textEnd + 56, H - 270);
  ctx.save();
  ctx.fillStyle = rgba(GOLD, 0.95);
  ctx.fillRect(M, y, 64, 3);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#fff";
  ctx.font = font(700, 40);
  ctx.fillText(ellipsize(d.author, W - 2 * M, (s) => ctx.measureText(s).width), M, y + 26);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = serif(30);
  const cite = wrapLines(d.citation, W - 2 * M, 2, (s) => ctx.measureText(s).width);
  cite.forEach((ln, i) => ctx.fillText(ln, M, y + 82 + i * 40));
  ctx.restore();

  // Footer: brand + credit.
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = font(800, 28);
  spaced(ctx, 4);
  ctx.fillText("WS_DESK", M, H - 72);
  if (d.credit) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = font(500, 18);
    spaced(ctx, 0);
    ctx.textAlign = "right";
    ctx.fillText(ellipsize(d.credit, W - 2 * M - 220, (s) => ctx.measureText(s).width), W - M, H - 74);
  }
  ctx.restore();
}

/** Wait for the serif face (Cyrillic / Greek glyphs of the sample) before drawing. Never throws. */
export async function loadQuoteFonts(sample: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([document.fonts.load(serif(60), sample), document.fonts.load(font(700, 40), sample)]);
  } catch {
    /* fallback faces draw */
  }
}
