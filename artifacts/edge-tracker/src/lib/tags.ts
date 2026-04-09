export const TRADE_TAGS = {
  setup: {
    name: "Сетап",
    tags: [
      // === SMB Capital Core 20 ===
      "Opening Drive", "Second Day Play", "Opening Consolidation",
      "Gap and Go", "Flag / Pennant", "Breakout Trade", "Explosive Move", "Flipping",
      "Fade Trade", "Stuffed Trade", "Bounce Trade", "Biotech Fade",
      "Support Play", "Pullback Trade", "2D VWAP Trade", "Relative Strength Trade",
      "Fundamental / Catalyst Trade", "IPO Trade", "Secondary Offering Trade", "Special Dividend Trade",
      // === SMB Advanced / Specialty ===
      "Dr. S Trade", "Market Play", "Scalp Trade", "Opening Volatility Collapse",
      "Big Bid / Catalyst Trade", "ABCD Pattern",
      // === Gap plays ===
      "Gap Up", "Gap Down", "Gap and Go Long", "Gap and Go Short", "Gap Fill",
      "Earnings Gap Up", "Earnings Gap Down",
      // === Breakout / Continuation ===
      "Breakout", "Retest", "Trend Continuation", "Bull Flag", "Bear Flag",
      "Triangle", "Ascending Triangle", "Descending Triangle", "H Pattern",
      "ORB", "ORB 5min", "ORB 15min", "ORB 30min",
      "Inside Day Break", "Narrow Range Break (NR7)", "Range Expansion",
      "Wedge Breakout", "Cup and Handle", "Flat Top Breakout",
      // === VWAP ===
      "VWAP Reclaim", "VWAP Trend", "VWAP Rejection", "VWAP Bounce",
      "VWAP Hold Long", "VWAP Fade Short",
      // === Momentum ===
      "Intraday Momentum", "Momentum Ignition", "Volume Pocket Pivot",
      "Power Move", "Parabolic Run", "Acceleration Break",
      // === Short setups ===
      "Parabolic Short", "HOD Failure", "Dead Cat Bounce", "Failed Follow Through",
      "Short Squeeze", "Fade the Move", "Overextended Short",
      "Bear Trap", "Blow-Off Top Short", "Exhaustion Short",
      // === Reversal ===
      "Reversal", "Red to Green", "Green to Red", "Reddog Reversal",
      "V-Bottom Reversal", "Double Bottom", "Double Top",
      "Hammer Capitulation Buy", "Shooting Star Short",
      "Key Reversal Day", "Morning Star", "Evening Star",
      // === Mean Reversion / Stat Arb ===
      "Mean Reversion", "Pairs Trade", "ETF Arbitrage", "Relative Value",
      "Bollinger Band Bounce", "RSI Oversold Bounce", "RSI Overbought Short",
      // === Offering / Dilution ===
      "Offering Play", "Pricing Play", "ATM Offering", "Post-Offering Bounce",
      "Lock-Up Expiry Play",
      // === Auction / Order Flow ===
      "Imbalance", "Opening Imbalance (OPG)", "MOC Imbalance",
      "Closing Cross Play", "Liquidity Sweep",
      "Dark Pool Print", "Block Trade Follow",
      // === Prop Desk Specialty ===
      "Halt & Resume", "Sympathy Play", "Sector Rotation Play",
      "News Spike Fade", "Earnings Drift (PEAD)", "Catalyst Anticipation",
      "Pre-Earnings Run", "Post-Earnings Continuation",
      "Basket Trade", "Hedged Swing", "Macro Play",
      // === T3 / Advanced Technical ===
      "Doji Break", "Marubozu Continuation", "Engulfing Entry",
      "Pivot Point Bounce", "Fibonacci Retracement Entry",
      "Channel Break", "Trendline Break",
      // === Maverick / Position Management ===
      "Pyramid Into Winner", "Swing Hold", "Multi-Day Momentum",
      "Overnight Hold Gap", "Weekly Breakout",
    ],
  },
  catalyst: {
    name: "Катализатор",
    tags: [
      // Earnings
      "Earnings Beat", "Earnings Miss", "Revenue Beat", "Revenue Miss",
      "Guidance Up", "Guidance Down", "Earnings Inline",
      "Earnings Whisper", "Pre-Announcement", "Conference Call Comments",
      // Dilution / Offering
      "Offering", "Pricing", "ATM", "Lock-Up Expiry", "S-1 Filing",
      "Shelf Registration", "Bought Deal", "PIPE Deal",
      // FDA / Biotech
      "FDA Approval", "FDA Rejection", "PDUFA Date", "Clinical Trial Results",
      "Phase 1 Data", "Phase 2 Data", "Phase 3 Data",
      "FDA CRL", "FDA Priority Review", "EUA Authorization",
      "Drug Pricing News", "Patent Ruling",
      // News / Corporate
      "Breaking News", "Press Release", "Analyst Upgrade", "Analyst Downgrade",
      "Price Target Raised", "Price Target Cut",
      "Initiation of Coverage", "SEC Filing", "13F Filing",
      "Insider Buying", "Insider Selling",
      // Corporate actions
      "M&A", "Merger", "Acquisition", "Buyback", "CEO Change",
      "Bankruptcy", "Restructuring", "Short Report", "Halt",
      "Special Dividend", "Stock Split", "Reverse Split",
      "Spin-Off", "Activist Investor", "Board Shakeup",
      "Government Contract", "Partnership / JV",
      // Macro
      "CPI", "FOMC", "NFP", "GDP", "Interest Rate",
      "PPI", "Retail Sales", "Jobless Claims", "PMI",
      "Sector Catalyst", "Market Catalyst",
      "Geopolitical Event", "Trade War News", "Sanctions",
      "OPEC Decision", "Treasury Auction",
    ],
  },
  levels: {
    name: "Уровни",
    tags: [
      // Intraday levels
      "Open Price", "Premarket High", "Premarket Low",
      "HOD", "LOD", "VWAP", "2-Day VWAP",
      "Opening Range High", "Opening Range Low",
      // Prior day / week
      "Yesterday High", "Yesterday Low", "Yesterday Close",
      "Prior Week High", "Prior Week Low",
      "Prior Month High", "Prior Month Low",
      // Technical
      "Daily Resistance", "Daily Support", "Weekly Resistance", "Weekly Support",
      "All Time High", "All Time Low", "52-Week High", "52-Week Low",
      "Gap Fill Level", "Anchored VWAP",
      // Pivot Points
      "Daily Pivot", "R1", "R2", "R3", "S1", "S2", "S3",
      // Moving averages
      "EMA9", "EMA21", "SMA20", "SMA50", "SMA100", "SMA200",
      "EMA8 (1min)", "EMA20 (5min)",
      // Fibonacci
      "Fib 38.2%", "Fib 50%", "Fib 61.8%", "Fib 78.6%",
      "Fib Extension 127%", "Fib Extension 161%",
      // Round numbers / other
      "Round Number", "Half Dollar", "Whole Dollar",
      "IPO Price", "Offering Price", "Secondary Price",
      "Dark Pool Level", "POC (Point of Control)", "Value Area High", "Value Area Low",
    ],
  },
  stock_profile: {
    name: "Профиль акции",
    tags: [
      // Float
      "Low Float (<10M)", "Mid Float (10-50M)", "High Float (>50M)", "Extremely Low Float (<2M)",
      // Market cap
      "Nano Cap", "Micro Cap", "Small Cap", "Mid Cap", "Large Cap", "Mega Cap",
      // Short interest
      "High Short Interest (>20%)", "Moderate Short Interest", "Low Short Interest",
      "CTB High (Hard to Borrow)", "Easy to Borrow",
      // Volume
      "High Relative Volume", "Normal Volume", "Low Volume",
      "Volume Spike", "Volume Dry Up", "Unusual Options Activity",
      "Dark Pool Volume",
      // Price range
      "Penny Stock (<$1)", "Sub $5", "$5–$20", "$20–$100", "Over $100", "Over $500",
      // Sector
      "Biotech", "Tech", "Software", "Semiconductor", "Energy", "Oil & Gas",
      "Finance", "Healthcare", "Pharma",
      "Mining", "Cannabis", "EV / Clean Energy", "AI / Machine Learning",
      "SPAC", "IPO Stock", "Recent IPO (<6mo)",
      "Retail / Consumer", "Real Estate / REIT", "Aerospace / Defense",
      "Crypto-Related",
      // Special
      "ADR / Foreign", "Chinese ADR", "Meme Stock", "Reddit / Social Buzz",
    ],
  },
  market: {
    name: "Условия рынка",
    tags: [
      // Trend
      "Market Strong", "Market Weak", "Market Neutral",
      "Risk-On", "Risk-Off", "Choppy", "Trending Day", "Range-Bound",
      "Trend Day Up", "Trend Day Down", "Rotational Day",
      // Session
      "Premarket", "Regular Hours", "Power Hour", "After Hours",
      "Open Drive", "Quiet Open", "Gap Open", "Flat Open",
      "First 15min", "First 30min", "Midday Lull", "Last Hour",
      // Sector / Index
      "Sector Leading", "Sector Lagging", "Sector Rotation",
      "Index Against", "Index With",
      "SPY Above VWAP", "SPY Below VWAP",
      "QQQ Leading", "IWM Leading",
      // Conditions
      "High Volatility", "Low Volatility", "VIX Spike", "VIX Crush",
      "Wide Spread", "Tight Spread",
      "Low Liquidity", "High Liquidity",
      "News Risk", "Fed Day", "OPEX Day", "Triple Witching",
      "Quad Witching", "Earnings Season", "Holiday Week",
      "End of Quarter", "End of Month",
    ],
  },
  execution: {
    name: "Исполнение",
    tags: [
      // Entry quality
      "Perfect Entry", "Good Entry", "Late Entry", "Early Entry",
      "Chased Entry", "Missed Entry", "FOMO Entry",
      "Tape Reading Entry", "Level 2 Entry",
      // Size
      "Full Size", "Half Size", "Small Size", "Starter Position",
      "Sized Too Big", "Sized Too Small",
      "Pyramided In", "Added on Confirmation",
      // Exit quality
      "Full Target Hit", "Partial Target", "Early Exit", "Held Too Long",
      "Stopped Out", "Break Even", "Trail Stop",
      "Took Quick Profit", "Let Runner Run", "Scaled Out Well",
      // Execution type
      "Limit Order", "Market Order", "Scale In", "Scale Out",
      "Partial Profit", "Add to Winner", "Cut Loss Fast",
      "Hotkey Execution", "Algorithmic Entry",
      // Route / Venue
      "Direct Route", "Dark Pool Route", "ECN Route",
      "Pre-Market Entry", "After-Hours Entry",
    ],
  },
  mistakes: {
    name: "Ошибки / Уроки",
    tags: [
      // Mental
      "FOMO", "Revenge Trade", "Overtrading", "Hesitation",
      "Emotional Exit", "Panic Sell", "Ignored Stop",
      "Tilt / Frustration", "Overconfidence", "Fear of Loss",
      "Analysis Paralysis",
      // Process
      "No Plan", "Broke Rules", "Wrong Setup", "Wrong Direction",
      "Against Trend", "Against Market", "Chased",
      "Didn't Wait for Confirmation", "Skipped Checklist",
      "Traded Low Quality Setup", "Ignored Bigger Picture",
      // Size / Risk
      "Over-Sized", "Under-Sized", "Bad Risk/Reward",
      "No Stop Set", "Moved Stop", "Held Through News",
      "Added to Loser", "Averaged Down", "Didn't Take Partial",
      // Timing
      "Wrong Session", "Bad Timing", "Too Early", "Too Late",
      "Traded in Dead Zone (11-2)", "Traded Before News",
    ],
  },
  result: {
    name: "Результат",
    tags: [
      // Win types
      "Clean Win", "Home Run", "Quick Scalp Win", "Trend Trade Win",
      "Planned Trade", "Patient Trade", "Textbook Setup",
      "A+ Setup Execution", "Conviction Trade Win",
      // Loss types
      "Clean Loss", "Stop Hit", "Gave Back Gains", "Scratched",
      "Preventable Loss", "Unpreventable Loss (Stop Ran)",
      // Learning
      "Strong Setup Weak Result", "Weak Setup Lucky Result",
      "Repeated Mistake", "New Lesson", "Confirmed Edge",
      "Best Trade of Day", "Worst Trade of Day",
      "Process Win (Even if Loss)", "Discipline Win",
      "PlayBook Trade", "Non-PlayBook Trade",
    ],
  },
};

export type TagCategory = keyof typeof TRADE_TAGS;

export function getAllTags(): string[] {
  return Object.values(TRADE_TAGS).flatMap((cat) => cat.tags);
}

export function getTagsByCategory(category: TagCategory): string[] {
  return TRADE_TAGS[category]?.tags || [];
}

export function getCategoryForTag(tag: string): TagCategory | null {
  for (const [key, cat] of Object.entries(TRADE_TAGS)) {
    if (cat.tags.includes(tag)) return key as TagCategory;
  }
  return null;
}
