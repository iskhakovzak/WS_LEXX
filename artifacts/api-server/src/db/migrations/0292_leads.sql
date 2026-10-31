-- Public landing leads (artifacts/landing -> POST /api/leads, routes/leads.ts). One row per form submission: a desk
-- booking a demo or a trader asking for access. Contact data of prospects only, no desk data; the owner is told in
-- Telegram (lib/leads/notify.ts). handled_at is for the owner's own follow-up.
CREATE TABLE IF NOT EXISTS leads (
  id            bigserial   PRIMARY KEY,
  segment       text        NOT NULL CHECK (segment IN ('prop_desk', 'funded_trader', 'futures_firm')),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  company       text        CHECK (company IS NULL OR char_length(company) <= 160),
  traders_count text        CHECK (traders_count IS NULL OR traders_count IN ('1', '2-10', '11-25', '26-50', '51-100', '100+')),
  platform      text        CHECK (platform IS NULL OR char_length(platform) <= 80),
  email         text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  locale        text        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'es')),
  message       text        CHECK (message IS NULL OR char_length(message) <= 2000),
  source_page   text        CHECK (source_page IS NULL OR char_length(source_page) <= 300),
  user_agent    text        CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  created_at    timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  handled_at    timestamptz
);
CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC);
