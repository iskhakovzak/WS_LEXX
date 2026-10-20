-- Market themes («Темы рынка», owner 2026-10-20; lib/themes/*, routes/themes.ts): TradingView-style theme tracker.
-- A theme is an equal-weight basket of US-listed tickers; GET /api/themes averages the members' moves (today vs the
-- previous close, and from today's open). Staff edit the list (PUT / POST /api/themes); a theme is archived with
-- active = false, never deleted. Names are stored as on TradingView (English) and are not translated.

CREATE TABLE IF NOT EXISTS market_themes (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  tickers text[] NOT NULL CHECK (cardinality(tickers) BETWEEN 1 AND 30),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_themes_name_key ON market_themes (lower(name));
CREATE INDEX IF NOT EXISTS market_themes_order_idx ON market_themes (active, sort_order, id);

-- Seed: the themes of the TradingView Theme Tracker, in its order, 4–10 liquid US-listed names each (owner may edit).
-- Proxies where a theme has no direct US listing:
--   Korea Memory — Samsung Electronics and SK hynix trade only in Seoul: EWY / FLKR (MSCI / FTSE South Korea ETFs,
--   Samsung + SK hynix are their largest weights) plus the US memory names MU and SNDK.
--   Bitcoin — spot ETFs (IBIT, FBTC) plus the listed bitcoin-treasury / exchange names.
-- Idempotent: an existing name (any case) is left as it is.
INSERT INTO market_themes (name, tickers, sort_order, updated_by) VALUES
  ('Oil & Gas',          ARRAY['XOM','CVX','COP','OXY','EOG','DVN','SLB','HAL'],               10, 'seed'),
  ('Healthcare',         ARRAY['UNH','JNJ','LLY','ABBV','MRK','PFE','TMO','ABT'],              20, 'seed'),
  ('Space',              ARRAY['RKLB','ASTS','LUNR','PL','RDW','SATS'],                        30, 'seed'),
  ('Medical Devices',    ARRAY['ISRG','SYK','BSX','MDT','EW','DXCM','ZBH','PODD'],             40, 'seed'),
  ('Social Media',       ARRAY['META','SNAP','PINS','RDDT','MTCH'],                            50, 'seed'),
  ('Retail',             ARRAY['WMT','COST','TGT','HD','LOW','TJX','DG','BBY'],                60, 'seed'),
  ('Robotics',           ARRAY['SYM','TER','ROK','ISRG','SERV','ZBRA','CGNX'],                 70, 'seed'),
  ('Steel',              ARRAY['NUE','STLD','CLF','CMC','RS','MT'],                            80, 'seed'),
  ('Memory',             ARRAY['MU','WDC','STX','SNDK','SIMO','RMBS'],                         90, 'seed'),
  ('Batteries',          ARRAY['QS','ENVX','SLDP','EOSE','FLNC','ALB','SQM'],                 100, 'seed'),
  ('Growth Stocks',      ARRAY['PLTR','SHOP','CRWD','NET','DDOG','APP','HOOD','SNOW'],        110, 'seed'),
  ('Banks',              ARRAY['JPM','BAC','WFC','C','GS','MS','USB','PNC'],                  120, 'seed'),
  ('Bitcoin',            ARRAY['IBIT','FBTC','MSTR','COIN','XYZ'],                            130, 'seed'),
  ('AI',                 ARRAY['NVDA','MSFT','GOOGL','META','AMD','AVGO','PLTR','ORCL'],      140, 'seed'),
  ('Biotechnology',      ARRAY['AMGN','GILD','VRTX','REGN','BIIB','MRNA','ALNY','INCY'],      150, 'seed'),
  ('Software',           ARRAY['MSFT','ORCL','CRM','ADBE','NOW','INTU','WDAY'],               160, 'seed'),
  ('Transports',         ARRAY['UNP','CSX','NSC','FDX','UPS','ODFL','JBHT','CHRW'],           170, 'seed'),
  ('China Internet',     ARRAY['BABA','PDD','JD','BIDU','NTES','TME','BILI'],                 180, 'seed'),
  ('Telecom',            ARRAY['T','VZ','TMUS','CMCSA','CHTR','LUMN'],                        190, 'seed'),
  ('Gold Miners',        ARRAY['NEM','B','AEM','WPM','FNV','KGC','AU','GFI'],                 200, 'seed'),
  ('Materials',          ARRAY['LIN','SHW','APD','ECL','FCX','DD','DOW','PPG'],               210, 'seed'),
  ('Silver Miners',      ARRAY['PAAS','AG','HL','CDE','SVM','EXK'],                           220, 'seed'),
  ('Utilities',          ARRAY['NEE','DUK','SO','D','AEP','EXC','SRE','XEL'],                 230, 'seed'),
  ('Quantum',            ARRAY['IONQ','RGTI','QBTS','QUBT','ARQQ'],                           240, 'seed'),
  ('Real Estate',        ARRAY['PLD','AMT','EQIX','SPG','O','PSA','WELL','DLR'],              250, 'seed'),
  ('Uranium',            ARRAY['CCJ','UEC','NXE','DNN','UUUU','LEU'],                         260, 'seed'),
  ('Aerospace',          ARRAY['BA','LMT','RTX','GD','NOC','GE','HWM','TDG'],                 270, 'seed'),
  ('Cybersecurity',      ARRAY['CRWD','PANW','FTNT','ZS','OKTA','NET','S','CHKP'],            280, 'seed'),
  ('Industrials',        ARRAY['CAT','DE','HON','GE','ETN','MMM','EMR','ITW'],                290, 'seed'),
  ('Semiconductors',     ARRAY['NVDA','AMD','AVGO','TSM','QCOM','INTC','AMAT','LRCX','KLAC','MRVL'], 300, 'seed'),
  ('Infrastructure',     ARRAY['PWR','MTZ','EME','VMC','MLM','FIX','DY','STRL'],              310, 'seed'),
  ('Korea Memory',       ARRAY['EWY','FLKR','MU','SNDK'],                                     320, 'seed'),
  ('Power Grid',         ARRAY['GEV','ETN','VRT','PWR','HUBB','POWL','NVT','PRIM'],           330, 'seed'),
  ('Genomics',           ARRAY['ILMN','CRSP','NTLA','BEAM','PACB','TXG','TWST'],              340, 'seed'),
  ('Airlines',           ARRAY['DAL','UAL','AAL','LUV','ALK','JBLU'],                         350, 'seed'),
  ('Home Construction',  ARRAY['DHI','LEN','PHM','NVR','TOL','KBH','MTH'],                    360, 'seed'),
  ('Bitcoin Miners',     ARRAY['MARA','RIOT','CLSK','CIFR','HUT','BTDR','WULF','BITF'],       370, 'seed'),
  ('Solar',              ARRAY['FSLR','ENPH','SEDG','RUN','NXT','ARRY','CSIQ'],               380, 'seed'),
  ('Neocloud',           ARRAY['CRWV','NBIS','IREN','APLD','CORZ'],                           390, 'seed')
ON CONFLICT ((lower(name))) DO NOTHING;
