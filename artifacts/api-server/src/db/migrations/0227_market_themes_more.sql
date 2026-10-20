-- More shared «Темы рынка» baskets (owner request 2026-10-20: "больше новых уникальных групп").
-- Equal-weight, US-listed, liquid names; admins edit them in «Настроить темы». Idempotent: an existing name is kept.
INSERT INTO market_themes (name, tickers, sort_order, updated_by) VALUES
  ('Magnificent 7',          ARRAY['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA'],      400, 'seed'),
  ('Nuclear SMR',            ARRAY['OKLO','SMR','NNE','BWXT','LEU'],                        410, 'seed'),
  ('Drones',                 ARRAY['AVAV','KTOS','RCAT','UMAC','ONDS'],                     420, 'seed'),
  ('eVTOL',                  ARRAY['JOBY','ACHR','EH'],                                     430, 'seed'),
  ('GLP-1 & Obesity',        ARRAY['LLY','NVO','VKTX','HIMS','AMGN'],                       440, 'seed'),
  ('Fintech',                ARRAY['HOOD','SOFI','AFRM','UPST','PYPL','XYZ'],               450, 'seed'),
  ('Optical Networking',     ARRAY['COHR','LITE','CIEN','AAOI','FN','CRDO'],                460, 'seed'),
  ('Data Center Cooling',    ARRAY['VRT','MOD','NVT','POWL','JCI'],                         470, 'seed'),
  ('Rare Earths',            ARRAY['MP','USAR','UUUU','TMC','NB'],                          480, 'seed'),
  ('China EV',               ARRAY['NIO','XPEV','LI','ZK'],                                 490, 'seed'),
  ('Robotaxi',               ARRAY['TSLA','UBER','LYFT','PONY','WRD','MBLY'],               500, 'seed'),
  ('Satellite Comms',        ARRAY['ASTS','IRDM','GSAT','VSAT'],                            510, 'seed'),
  ('Tankers & Shipping',     ARRAY['FRO','STNG','TNK','INSW','DHT','ZIM'],                  520, 'seed'),
  ('Casinos & Betting',      ARRAY['DKNG','FLUT','MGM','LVS','WYNN','CZR'],                 530, 'seed'),
  ('Travel & Cruise',        ARRAY['CCL','RCL','NCLH','BKNG','EXPE','ABNB'],                540, 'seed'),
  ('Meme Stocks',            ARRAY['GME','AMC','OPEN','KSS','BYND'],                        550, 'seed')
ON CONFLICT ((lower(name))) DO NOTHING;
