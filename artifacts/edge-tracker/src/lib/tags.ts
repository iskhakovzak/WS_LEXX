export type TagSubgroup = { label: string; tags: string[] };

export const TRADE_TAGS: Record<string, { name: string; groups: TagSubgroup[] }> = {
  setup: {
    name: "Сетап",
    groups: [
      { label: "SMB Core", tags: ["Opening Drive", "Second Day Play", "Opening Consolidation", "Gap and Go", "Flag / Pennant", "Breakout Trade", "Explosive Move", "Flipping", "Fade Trade", "Stuffed Trade", "Bounce Trade", "Biotech Fade", "Support Play", "Pullback Trade", "2D VWAP Trade", "Relative Strength Trade", "Fundamental / Catalyst Trade", "IPO Trade", "Secondary Offering Trade", "Special Dividend Trade"] },
      { label: "SMB Advanced", tags: ["Dr. S Trade", "Market Play", "Scalp Trade", "Opening Volatility Collapse", "Big Bid / Catalyst Trade", "ABCD Pattern"] },
      { label: "Gap", tags: ["Gap Up", "Gap Down", "Gap and Go Long", "Gap and Go Short", "Gap Fill", "Earnings Gap Up", "Earnings Gap Down"] },
      { label: "Breakout", tags: ["Breakout", "Retest", "Trend Continuation", "Bull Flag", "Bear Flag", "Triangle", "Ascending Triangle", "Descending Triangle", "H Pattern", "ORB", "ORB 5min", "ORB 15min", "ORB 30min", "Inside Day Break", "Narrow Range Break (NR7)", "Range Expansion", "Wedge Breakout", "Cup and Handle", "Flat Top Breakout"] },
      { label: "VWAP", tags: ["VWAP Reclaim", "VWAP Trend", "VWAP Rejection", "VWAP Bounce", "VWAP Hold Long", "VWAP Fade Short"] },
      { label: "Momentum", tags: ["Intraday Momentum", "Momentum Ignition", "Volume Pocket Pivot", "Power Move", "Parabolic Run", "Acceleration Break"] },
      { label: "Short", tags: ["Parabolic Short", "HOD Failure", "Dead Cat Bounce", "Failed Follow Through", "Short Squeeze", "Fade the Move", "Overextended Short", "Bear Trap", "Blow-Off Top Short", "Exhaustion Short"] },
      { label: "Reversal", tags: ["Reversal", "Red to Green", "Green to Red", "Reddog Reversal", "V-Bottom Reversal", "Double Bottom", "Double Top", "Hammer Capitulation Buy", "Shooting Star Short", "Key Reversal Day", "Morning Star", "Evening Star"] },
      { label: "Mean Rev / Arb", tags: ["Mean Reversion", "Pairs Trade", "ETF Arbitrage", "Relative Value", "Bollinger Band Bounce", "RSI Oversold Bounce", "RSI Overbought Short"] },
      { label: "Offering", tags: ["Offering Play", "Pricing Play", "ATM Offering", "Post-Offering Bounce", "Lock-Up Expiry Play"] },
      { label: "Auction / Flow", tags: ["Imbalance", "Opening Imbalance (OPG)", "MOC Imbalance", "Closing Cross Play", "Liquidity Sweep", "Dark Pool Print", "Block Trade Follow"] },
      { label: "Prop Desk", tags: ["Halt & Resume", "Sympathy Play", "Sector Rotation Play", "News Spike Fade", "Earnings Drift (PEAD)", "Catalyst Anticipation", "Pre-Earnings Run", "Post-Earnings Continuation", "Basket Trade", "Hedged Swing", "Macro Play"] },
      { label: "Technical", tags: ["Doji Break", "Marubozu Continuation", "Engulfing Entry", "Pivot Point Bounce", "Fibonacci Retracement Entry", "Channel Break", "Trendline Break"] },
      { label: "Swing / Multi-Day", tags: ["Pyramid Into Winner", "Swing Hold", "Multi-Day Momentum", "Overnight Hold Gap", "Weekly Breakout"] },
    ],
  },
  catalyst: {
    name: "Катализатор",
    groups: [
      { label: "Earnings", tags: ["Earnings Beat", "Earnings Miss", "Revenue Beat", "Revenue Miss", "Guidance Up", "Guidance Down", "Earnings Inline", "Earnings Whisper", "Pre-Announcement", "Conference Call Comments"] },
      { label: "Offering", tags: ["Offering", "Pricing", "ATM", "Lock-Up Expiry", "S-1 Filing", "Shelf Registration", "Bought Deal", "PIPE Deal"] },
      { label: "FDA / Bio", tags: ["FDA Approval", "FDA Rejection", "PDUFA Date", "Clinical Trial Results", "Phase 1 Data", "Phase 2 Data", "Phase 3 Data", "FDA CRL", "FDA Priority Review", "EUA Authorization", "Drug Pricing News", "Patent Ruling"] },
      { label: "News / Analyst", tags: ["Breaking News", "Press Release", "Analyst Upgrade", "Analyst Downgrade", "Price Target Raised", "Price Target Cut", "Initiation of Coverage", "SEC Filing", "13F Filing", "Insider Buying", "Insider Selling"] },
      { label: "Corporate", tags: ["M&A", "Merger", "Acquisition", "Buyback", "CEO Change", "Bankruptcy", "Restructuring", "Short Report", "Halt", "Special Dividend", "Stock Split", "Reverse Split", "Spin-Off", "Activist Investor", "Board Shakeup", "Government Contract", "Partnership / JV"] },
      { label: "Macro", tags: ["CPI", "FOMC", "NFP", "GDP", "Interest Rate", "PPI", "Retail Sales", "Jobless Claims", "PMI", "Sector Catalyst", "Market Catalyst", "Geopolitical Event", "Trade War News", "Sanctions", "OPEC Decision", "Treasury Auction"] },
    ],
  },
  levels: {
    name: "Уровни",
    groups: [
      { label: "Intraday", tags: ["Open Price", "Premarket High", "Premarket Low", "HOD", "LOD", "VWAP", "2-Day VWAP", "Opening Range High", "Opening Range Low"] },
      { label: "Prior D/W/M", tags: ["Yesterday High", "Yesterday Low", "Yesterday Close", "Prior Week High", "Prior Week Low", "Prior Month High", "Prior Month Low"] },
      { label: "Key Levels", tags: ["Daily Resistance", "Daily Support", "Weekly Resistance", "Weekly Support", "All Time High", "All Time Low", "52-Week High", "52-Week Low", "Gap Fill Level", "Anchored VWAP"] },
      { label: "Pivot", tags: ["Daily Pivot", "R1", "R2", "R3", "S1", "S2", "S3"] },
      { label: "MA", tags: ["EMA9", "EMA21", "SMA20", "SMA50", "SMA100", "SMA200", "EMA8 (1min)", "EMA20 (5min)"] },
      { label: "Fib", tags: ["Fib 38.2%", "Fib 50%", "Fib 61.8%", "Fib 78.6%", "Fib Extension 127%", "Fib Extension 161%"] },
      { label: "Other", tags: ["Round Number", "Half Dollar", "Whole Dollar", "IPO Price", "Offering Price", "Secondary Price", "Dark Pool Level", "POC (Point of Control)", "Value Area High", "Value Area Low"] },
    ],
  },
  stock_profile: {
    name: "Профиль акции",
    groups: [
      { label: "Float", tags: ["Low Float (<10M)", "Mid Float (10-50M)", "High Float (>50M)", "Extremely Low Float (<2M)"] },
      { label: "Cap", tags: ["Nano Cap", "Micro Cap", "Small Cap", "Mid Cap", "Large Cap", "Mega Cap"] },
      { label: "Short Interest", tags: ["High Short Interest (>20%)", "Moderate Short Interest", "Low Short Interest", "CTB High (Hard to Borrow)", "Easy to Borrow"] },
      { label: "Volume", tags: ["High Relative Volume", "Normal Volume", "Low Volume", "Volume Spike", "Volume Dry Up", "Unusual Options Activity", "Dark Pool Volume"] },
      { label: "Price", tags: ["Penny Stock (<$1)", "Sub $5", "$5–$20", "$20–$100", "Over $100", "Over $500"] },
      { label: "Sector", tags: ["Biotech", "Tech", "Software", "Semiconductor", "Energy", "Oil & Gas", "Finance", "Healthcare", "Pharma", "Mining", "Cannabis", "EV / Clean Energy", "AI / Machine Learning", "SPAC", "IPO Stock", "Recent IPO (<6mo)", "Retail / Consumer", "Real Estate / REIT", "Aerospace / Defense", "Crypto-Related"] },
      { label: "Special", tags: ["ADR / Foreign", "Chinese ADR", "Meme Stock", "Reddit / Social Buzz"] },
    ],
  },
  market: {
    name: "Условия рынка",
    groups: [
      { label: "Trend", tags: ["Market Strong", "Market Weak", "Market Neutral", "Risk-On", "Risk-Off", "Choppy", "Trending Day", "Range-Bound", "Trend Day Up", "Trend Day Down", "Rotational Day"] },
      { label: "Session", tags: ["Premarket", "Regular Hours", "Power Hour", "After Hours", "Open Drive", "Quiet Open", "Gap Open", "Flat Open", "First 15min", "First 30min", "Midday Lull", "Last Hour"] },
      { label: "Sector / Index", tags: ["Sector Leading", "Sector Lagging", "Sector Rotation", "Index Against", "Index With", "SPY Above VWAP", "SPY Below VWAP", "QQQ Leading", "IWM Leading"] },
      { label: "Conditions", tags: ["High Volatility", "Low Volatility", "VIX Spike", "VIX Crush", "Wide Spread", "Tight Spread", "Low Liquidity", "High Liquidity", "News Risk", "Fed Day", "OPEX Day", "Triple Witching", "Quad Witching", "Earnings Season", "Holiday Week", "End of Quarter", "End of Month"] },
    ],
  },
  execution: {
    name: "Исполнение",
    groups: [
      { label: "Entry", tags: ["Perfect Entry", "Good Entry", "Late Entry", "Early Entry", "Chased Entry", "Missed Entry", "FOMO Entry", "Tape Reading Entry", "Level 2 Entry"] },
      { label: "Size", tags: ["Full Size", "Half Size", "Small Size", "Starter Position", "Sized Too Big", "Sized Too Small", "Pyramided In", "Added on Confirmation"] },
      { label: "Exit", tags: ["Full Target Hit", "Partial Target", "Early Exit", "Held Too Long", "Stopped Out", "Break Even", "Trail Stop", "Took Quick Profit", "Let Runner Run", "Scaled Out Well"] },
      { label: "Order Type", tags: ["Limit Order", "Market Order", "Scale In", "Scale Out", "Partial Profit", "Add to Winner", "Cut Loss Fast", "Hotkey Execution", "Algorithmic Entry"] },
      { label: "Route", tags: ["Direct Route", "Dark Pool Route", "ECN Route", "Pre-Market Entry", "After-Hours Entry"] },
    ],
  },
  mistakes: {
    name: "Ошибки / Уроки",
    groups: [
      { label: "Mental", tags: ["FOMO", "Revenge Trade", "Overtrading", "Hesitation", "Emotional Exit", "Panic Sell", "Ignored Stop", "Tilt / Frustration", "Overconfidence", "Fear of Loss", "Analysis Paralysis"] },
      { label: "Process", tags: ["No Plan", "Broke Rules", "Wrong Setup", "Wrong Direction", "Against Trend", "Against Market", "Chased", "Didn't Wait for Confirmation", "Skipped Checklist", "Traded Low Quality Setup", "Ignored Bigger Picture"] },
      { label: "Risk", tags: ["Over-Sized", "Under-Sized", "Bad Risk/Reward", "No Stop Set", "Moved Stop", "Held Through News", "Added to Loser", "Averaged Down", "Didn't Take Partial"] },
      { label: "Timing", tags: ["Wrong Session", "Bad Timing", "Too Early", "Too Late", "Traded in Dead Zone (11-2)", "Traded Before News"] },
    ],
  },
  result: {
    name: "Результат",
    groups: [
      { label: "Win", tags: ["Clean Win", "Home Run", "Quick Scalp Win", "Trend Trade Win", "Planned Trade", "Patient Trade", "Textbook Setup", "A+ Setup Execution", "Conviction Trade Win"] },
      { label: "Loss", tags: ["Clean Loss", "Stop Hit", "Gave Back Gains", "Scratched", "Preventable Loss", "Unpreventable Loss (Stop Ran)"] },
      { label: "Learning", tags: ["Strong Setup Weak Result", "Weak Setup Lucky Result", "Repeated Mistake", "New Lesson", "Confirmed Edge", "Best Trade of Day", "Worst Trade of Day", "Process Win (Even if Loss)", "Discipline Win", "PlayBook Trade", "Non-PlayBook Trade"] },
    ],
  },
};

export type TagCategory = keyof typeof TRADE_TAGS;

export function getAllTags(): string[] {
  return Object.values(TRADE_TAGS).flatMap((cat) => cat.groups.flatMap((g) => g.tags));
}

export function getTagsByCategory(category: TagCategory): string[] {
  return TRADE_TAGS[category]?.groups.flatMap((g) => g.tags) || [];
}

export function getCategoryForTag(tag: string): TagCategory | null {
  for (const [key, cat] of Object.entries(TRADE_TAGS)) {
    if (cat.groups.some((g) => g.tags.includes(tag))) return key as TagCategory;
  }
  return null;
}
