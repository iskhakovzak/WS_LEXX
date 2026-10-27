/**
 * «Карточка трейдера» — a 1080×1350 PNG of the scouting card for sharing (the share-canvas toolkit: marble backdrop,
 * fonts, export). The image is a picture, not UI, so it paints with fixed colours like the other share cards.
 * Money follows the desk rule (sharePolicy): with "r_only" the net line is left out.
 */
import { drawBackdrop } from "@/components/shared/share-canvas/backdrop";
import { canvasPng, ellipsize, fitFontSize, font, loadCardFonts, roundRect, spaced, wrapLines } from "@/components/shared/share-canvas/canvas";
import type { MoneyPolicy } from "@/components/shared/share-canvas/policy";
import { personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { profileI18n } from "@/i18n/ns/profile";
import { fmtCount, fmtDate, fmtRate, fmtUsd } from "@/lib/format";
import type { ProfileResponse } from "./api";
import { attrName, orderedAttributes, summaryText } from "./model";

export const CARD_W = 1080;
export const CARD_H = 1350;

const GOLD = "rgba(232, 200, 120, 1)";
const INK = "rgba(255, 255, 255, 0.96)";
const SOFT = "rgba(255, 255, 255, 0.68)";
const TRACK = "rgba(255, 255, 255, 0.14)";
const DESK = "rgba(255, 255, 255, 0.55)";

/** Draws the card into a fresh canvas and returns it. */
export async function drawTradingCard(p: ProfileResponse, money: MoneyPolicy): Promise<HTMLCanvasElement> {
  const t = profileI18n.t;
  const name = personName(p.person.name);
  await loadCardFonts(name);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  drawBackdrop(ctx, { theme: "marble", tone: null, image: null, imageSize: null, seed: p.person.id * 7919 }, { w: CARD_W, h: CARD_H });

  const X = 96;
  const W = CARD_W - X * 2;
  // Name and role line.
  ctx.fillStyle = INK;
  const nameSize = fitFontSize(name, W, 96, 48, (s, size) => { ctx.font = font(800, size); return ctx.measureText(s).width; });
  ctx.font = font(800, nameSize);
  ctx.fillText(name, X, 190);
  const role = commonI18n.tryT(`tiers.${p.person.stage ?? ""}`);
  const roleLine = role ? t("share.cardStage", { role: t(`archetype.${p.summary.archetype}`), stage: role }) : t(`archetype.${p.summary.archetype}`);
  ctx.font = font(600, 34);
  ctx.fillStyle = GOLD;
  spaced(ctx, 1);
  ctx.fillText(roleLine, X, 250);
  spaced(ctx, 0);

  // The one-line characteristic.
  ctx.fillStyle = SOFT;
  ctx.font = font(500, 30);
  const lines = wrapLines(summaryText(p.summary), W, 3, (s) => ctx.measureText(s).width);
  lines.forEach((l, i) => ctx.fillText(l, X, 316 + i * 42));

  // Eight attribute bars.
  const top = 316 + lines.length * 42 + 40;
  const rowH = 84;
  orderedAttributes(p.attributes).forEach((a, i) => {
    const y = top + i * rowH;
    ctx.font = font(700, 32);
    ctx.fillStyle = INK;
    ctx.fillText(ellipsize(attrName(a.key), W - 160, (s) => ctx.measureText(s).width), X, y + 30);
    ctx.textAlign = "right";
    ctx.font = font(800, 34);
    ctx.fillStyle = a.low || a.score === null ? SOFT : INK;
    ctx.fillText(a.low || a.score === null ? "—" : String(a.score), X + W, y + 30);
    ctx.textAlign = "left";
    roundRect(ctx, { x: X, y: y + 46, w: W, h: 12 }, 6);
    ctx.fillStyle = TRACK;
    ctx.fill();
    if (a.score !== null && !a.low) {
      roundRect(ctx, { x: X, y: y + 46, w: Math.max(12, (W * a.score) / 100), h: 12 }, 6);
      ctx.fillStyle = GOLD;
      ctx.fill();
    }
    if (a.deskMedian !== null) {
      ctx.fillStyle = DESK;
      ctx.fillRect(X + (W * a.deskMedian) / 100 - 2, y + 40, 4, 24);
    }
  });

  // Bottom numbers.
  const s = p.stats;
  const facts = [
    t("share.cardTrades", { value: fmtCount(s.trades) }),
    t("share.cardDays", { value: fmtCount(s.activeDays) }),
    s.winRate === null ? null : t("share.cardWin", { value: fmtRate(s.winRate) }),
    money === "usd" ? t("share.cardNet", { value: fmtUsd(s.net, { signed: true, decimals: 0 }) }) : null,
  ].filter((x): x is string => !!x);
  ctx.font = font(600, 30);
  ctx.fillStyle = INK;
  const factsY = CARD_H - 150;
  const factText = facts.join("   ·   ");
  ctx.fillText(ellipsize(factText, W, (x) => ctx.measureText(x).width), X, factsY);
  ctx.font = font(500, 26);
  ctx.fillStyle = SOFT;
  ctx.fillText(t("share.cardFooter", { date: fmtDate(p.window.to, "medium") }), X, CARD_H - 92);
  return canvas;
}

export async function tradingCardPng(p: ProfileResponse, money: MoneyPolicy): Promise<Blob | null> {
  return canvasPng(await drawTradingCard(p, money));
}

export const tradingCardFileName = (p: ProfileResponse) => `ws-desk-card-${p.person.id}-${p.window.to}.png`;
