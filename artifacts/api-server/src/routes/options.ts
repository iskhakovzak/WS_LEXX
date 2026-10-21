import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { handleAiNotConfigured } from "../lib/aiErrors";
import { AppError } from "../lib/http";
import { aiLanguageEn } from "../i18n/ai";
import { langOf } from "../i18n";
import { getOptionsChain } from "../lib/options/chainService";
import { aiChainTable, type AiContractRow } from "../lib/options/aiChainTable";

const router: IRouter = Router();

const AI_MODEL = "claude-sonnet-4-6";
const aiRateMap = new Map<string, number[]>();
const AI_RATE_WINDOW = 60 * 60 * 1000;
const AI_RATE_MAX = 20;

function checkAiRateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (aiRateMap.get(ip) ?? []).filter(t => now - t < AI_RATE_WINDOW);
  if (hits.length >= AI_RATE_MAX) return false;
  hits.push(now);
  aiRateMap.set(ip, hits);
  return true;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
/** Expirations + the chain for `expiration` (or the nearest one). Yahoo → NASDAQ, 5-min cache (lib/options/chainService). */
router.get("/options/chain", asyncHandler(async (req, res): Promise<void> => {
  const symbol = String(req.query.symbol || "").toUpperCase().trim();
  if (!symbol || !/^[A-Z0-9.\-^=]{1,12}$/.test(symbol)) throw new AppError("INVALID_SYMBOL");
  const expiration = req.query.expiration ? String(req.query.expiration) : null; // "2026-05-30"
  if (expiration !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiration)) throw new AppError("INVALID_DATE");
  res.json(await getOptionsChain(symbol, expiration));
}));

router.post("/options/ai-analyze", asyncHandler(async (req, res): Promise<void> => {
  const { symbol, spot, daysToExpiry, calls, puts, strikes, userPrompt } = req.body as {
    symbol: string;
    spot: number;
    daysToExpiry: number;
    calls: AiContractRow[];
    puts: AiContractRow[];
    strikes: number[];
    userPrompt: string;
  };

  if (!symbol || typeof spot !== "number" || !userPrompt?.trim() || !Array.isArray(calls) || !Array.isArray(puts)) throw new AppError("VALIDATION");
  if (userPrompt.length > 600) throw new AppError("TEXT_TOO_LONG", undefined, { field: "userPrompt", max: 600 });
  // The prompt only ever uses ATM ±10 strikes — refuse oversized payloads instead of mapping them.
  if (calls.length > 400 || puts.length > 400 || (Array.isArray(strikes) && strikes.length > 400)) throw new AppError("TOO_MANY", undefined, { field: "calls / puts / strikes", max: 400 });

  const ip = (req.ip ?? "anon").slice(0, 64);
  if (!checkAiRateLimit(ip)) throw new AppError("RATE_LIMITED");

  // Compact chain table (ATM ±10 strikes; IV / delta when the chain carries them).
  const chainTable = aiChainTable(spot, strikes, calls, puts);

  const systemPrompt = `You are a professional options strategist at a prop trading desk. Respond ONLY with valid JSON — no markdown fences, no text outside the JSON object. Write every text field (strategy, reasoning, whyBest, keyRisk, altStrategies) in ${aiLanguageEn(langOf(req))}; keep tickers, numbers and option terms as is.`;

  const userMsg = `OPTIONS CHAIN — ${symbol} | Spot: $${spot.toFixed(2)} | DTE: ${daysToExpiry}d

${chainTable}

Trader's request: "${userPrompt.trim()}"

Recommend the single best strategy. Return ONLY this JSON (numbers, not strings for numeric fields):
{
  "strategy": "<name>",
  "reasoning": "<2-3 sentences>",
  "legs": [{"action":"buy"|"sell","type":"call"|"put","strike":<n>,"premium":<n>,"contracts":<n>}],
  "maxRisk": <number|null>,
  "maxProfit": <number|null for unlimited>,
  "breakevens": [<number>],
  "whyBest": "<1-2 sentences>",
  "keyRisk": "<1 sentence>",
  "altStrategies": ["<alt1>","<alt2>"]
}`;

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      logger.warn({ symbol, raw: clean.slice(0, 200) }, "Options AI returned invalid JSON");
      throw new AppError("GENERATION_FAILED");
    }
    res.json(parsed);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (handleAiNotConfigured(e, res)) return; // 503 ai_not_configured (audit P2-3)
    if (e instanceof AppError) throw e;
    logger.warn({ symbol, error: msg }, "Options AI analyze error");
    throw new AppError("AI_UNAVAILABLE");
  }
}));

export default router;
