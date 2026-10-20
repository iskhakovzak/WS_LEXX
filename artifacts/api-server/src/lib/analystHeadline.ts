/**
 * Pure headline parser of the analyst-actions scan (lib/marketDataService.ts): broker firm + action + grades + price
 * target from «Wells Fargo downgrades Apple…» style news. Split out of lib/marketDataService.ts (size ratchet);
 * marketDataService re-exports parseAnalystSignalFromHeadline / ParsedAnalystSignal.
 */

// ──────────────────────────────────────────────────────────────────────────
// News-based analyst signal extraction.
// Yahoo's structured upgradeDowngradeHistory only covers tickers we poll.
// News headlines mention analyst calls on a much wider universe — we extract
// firm + action from "Wells Fargo downgrades Apple…" style headlines and
// insert them as source='news' rows.
// ──────────────────────────────────────────────────────────────────────────

// Curated list of broker/research firm names that commonly appear in
// upgrade/downgrade headlines. Sorted longest-first at module load so we
// always match the most specific name (e.g. "Mizuho Securities" before
// "Mizuho", "Goldman Sachs" before "Goldman").
const BROKER_NAMES: string[] = [
  "Morgan Stanley", "Goldman Sachs", "JP Morgan", "JPMorgan", "Wells Fargo",
  "Bank of America", "B of A Securities", "BofA", "Citigroup", "Citi",
  "Deutsche Bank", "Barclays", "UBS", "HSBC", "Credit Suisse", "BNP Paribas",
  "Macquarie", "Mizuho Securities", "Mizuho", "Nomura", "Jefferies", "Wedbush",
  "Wolfe Research", "Baird", "Raymond James", "Stifel", "Piper Sandler",
  "Oppenheimer", "Needham", "BMO Capital", "RBC Capital", "Scotiabank",
  "TD Cowen", "Cowen", "Cantor Fitzgerald", "Cantor", "Bernstein",
  "Evercore ISI", "Evercore", "Guggenheim", "Loop Capital", "Argus", "Truist",
  "KeyBanc", "DA Davidson", "Davidson", "Susquehanna", "Roth MKM",
  "Roth Capital", "Benchmark", "Citizens", "Rosenblatt", "Canaccord Genuity",
  "Canaccord", "Berenberg", "Redburn", "Northland", "JMP Securities", "JMP",
  "Craig-Hallum", "Lake Street", "B. Riley", "BTIG", "Maxim Group",
  "Hudson Square", "Atlantic Equities", "Tigress Financial",
  "New Street Research", "Rothschild", "Pivotal Research", "Phillip Securities",
  "Daiwa", "CFRA", "Zacks", "Morningstar", "Seaport", "Compass Point", "JPM",
].slice().sort((a, b) => b.length - a.length);

const GRADE_TOKENS: string[] = [
  "Strong Buy", "Outperform", "Overweight", "Buy", "Accumulate", "Add",
  "Equal-Weight", "Equal Weight", "Equalweight", "Market Perform", "Neutral",
  "Hold", "In-Line", "In Line", "Sector Perform", "Sector Weight",
  "Underweight", "Underperform", "Reduce", "Sell", "Strong Sell", "Market Outperform",
];

export type ParsedAnalystSignal = {
  firm: string;
  action: "up" | "down" | "init" | "main" | "reit";
  toGrade: string | null;
  fromGrade: string | null;
  priceTarget: string | null;
  priceTargetFrom: string | null;
};

function detectFirmInText(text: string): string | null {
  for (const name of BROKER_NAMES) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) return name;
  }
  return null;
}

function findFirstGradeToken(text: string): { grade: string; index: number } | null {
  // Returns the earliest-appearing canonical grade token in text, or null.
  let bestPos = Infinity;
  let bestGrade: string | null = null;
  for (const g of GRADE_TOKENS) {
    const idx = text.search(new RegExp(`\\b${g.replace(/[\s-]/g, "[\\s-]?")}\\b`, "i"));
    if (idx >= 0 && idx < bestPos) {
      bestPos = idx;
      bestGrade = g;
    }
  }
  return bestGrade ? { grade: bestGrade, index: bestPos } : null;
}

function normalizeGradePhrase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  // Try to map a free-text phrase back to a canonical grade token.
  const m = findFirstGradeToken(t);
  if (m) return m.grade;
  // Fallback: capitalize the cleaned phrase
  return t.replace(/\s+/g, " ").slice(0, 30);
}

export function parseAnalystSignalFromHeadline(title: string, summary?: string): ParsedAnalystSignal | null {
  const text = `${title} ${summary || ""}`.trim();
  if (!text) return null;
  const firm = detectFirmInText(text);
  if (!firm) return null; // Need a firm to attribute the action

  const lower = text.toLowerCase();
  let action: ParsedAnalystSignal["action"] | null = null;
  if (/\b(?:upgrades?|upgraded|raises?\s+(?:rating|to)|raised\s+to)\b/.test(lower)) action = "up";
  else if (/\b(?:downgrades?|downgraded|cuts?\s+(?:rating|to)|lowered\s+to|lowers\s+rating)\b/.test(lower)) action = "down";
  else if (/\b(?:initiates?|initiated|starts?\s+coverage|begins?\s+coverage|launches\s+coverage)\b/.test(lower)) action = "init";
  else if (/\b(?:reiterates?|reiterated|reaffirms?|reaffirmed)\b/.test(lower)) action = "reit";
  else if (/\b(?:maintains?|maintained|keeps?\s+(?:buy|sell|hold|outperform|neutral))\b/.test(lower)) action = "main";
  // Price-target moves without explicit upgrade verb → treat as reiteration
  else if (/\b(?:raises?|raised|lifts?|lifted|boosts?)\s+(?:price\s+target|target|pt)\b/.test(lower)) action = "reit";
  else if (/\b(?:cuts?|lowers?|lowered|trims?|reduces?)\s+(?:price\s+target|target|pt)\b/.test(lower)) action = "reit";
  if (!action) return null;

  // Grade extraction priority:
  //   1) "from X to Y" (or "to Y from X")  →  fromGrade=X, toGrade=Y
  //   2) "to Y" / "at Y"                   →  toGrade=Y
  //   3) For up/down only: bare grade token after the action verb
  let toGrade: string | null = null;
  let fromGrade: string | null = null;
  const fromTo = text.match(/from\s+([A-Za-z][A-Za-z\s-]{1,25}?)\s+to\s+([A-Za-z][A-Za-z\s-]{1,25}?)(?=[,.;:]|\s+(?:on|at|with|citing|by)\b|$)/i);
  const toFrom = !fromTo ? text.match(/to\s+([A-Za-z][A-Za-z\s-]{1,25}?)\s+from\s+([A-Za-z][A-Za-z\s-]{1,25}?)(?=[,.;:]|\s+(?:on|at|with|citing|by)\b|$)/i) : null;
  if (fromTo) {
    fromGrade = normalizeGradePhrase(fromTo[1]);
    toGrade = normalizeGradePhrase(fromTo[2]);
  } else if (toFrom) {
    toGrade = normalizeGradePhrase(toFrom[1]);
    fromGrade = normalizeGradePhrase(toFrom[2]);
  } else {
    const toOnly = text.match(/\b(?:to|at)\s+([A-Za-z][A-Za-z\s-]{2,25}?)(?=[,.;:]|\s+(?:on|at|with|citing|by|from|—|-)\b|$)/i);
    if (toOnly) toGrade = normalizeGradePhrase(toOnly[1]);
    if (!toGrade && (action === "up" || action === "down" || action === "reit" || action === "init" || action === "main")) {
      // Last resort: any grade token in headline (only safe when no from/to phrasing exists,
      // so we won't be misled by "from Buy to Hold")
      const tok = findFirstGradeToken(text);
      if (tok) toGrade = tok.grade;
    }
  }

  let priceTarget: string | null = null;
  let priceTargetFrom: string | null = null;
  const ptFromTo = text.match(/(?:price\s+target|target|pt)\s+from\s+\$?([0-9]+(?:\.[0-9]+)?)\s+to\s+\$?([0-9]+(?:\.[0-9]+)?)/i)
    || text.match(/from\s+\$([0-9]+(?:\.[0-9]+)?)\s+to\s+\$([0-9]+(?:\.[0-9]+)?)/i);
  if (ptFromTo) {
    priceTargetFrom = ptFromTo[1];
    priceTarget = ptFromTo[2];
  } else {
    const ptToFrom = text.match(/(?:price\s+target|target|pt)\s+(?:to\s+)?\$?([0-9]+(?:\.[0-9]+)?)\s+from\s+\$?([0-9]+(?:\.[0-9]+)?)/i)
      || text.match(/to\s+\$([0-9]+(?:\.[0-9]+)?)\s+from\s+\$([0-9]+(?:\.[0-9]+)?)/i);
    if (ptToFrom) {
      priceTarget = ptToFrom[1];
      priceTargetFrom = ptToFrom[2];
    } else {
      const ptOnly = text.match(/(?:price\s+target|target|pt)(?:\s+(?:to|of|at|raised\s+to|cut\s+to|lowered\s+to|lifted\s+to))?\s*[:=]?\s*\$([0-9]+(?:\.[0-9]+)?)/i)
        || text.match(/\$([0-9]+(?:\.[0-9]+)?)\s+(?:price\s+)?target/i);
      if (ptOnly) priceTarget = ptOnly[1];
    }
  }

  return { firm, action, toGrade, fromGrade, priceTarget, priceTargetFrom };
}

