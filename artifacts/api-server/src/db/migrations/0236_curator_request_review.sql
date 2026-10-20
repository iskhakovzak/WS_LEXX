-- Волна 2 п. 2.13 «Попросить разбор»: a curator request of kind «review» from a discussion thread or a trade idea
-- (routes/curator-requests.ts, lib/people/curatorRequests.ts). `link` = that thread as a site path
-- («/discussions?thread=7», «/trade-ideas?idea=3»); one open review request per trader and thread, the other kinds
-- stay one open request per trader and kind. Idempotent, no rows touched.

ALTER TABLE curator_requests ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE curator_requests DROP CONSTRAINT IF EXISTS curator_requests_link_check;
ALTER TABLE curator_requests ADD CONSTRAINT curator_requests_link_check CHECK (link IS NULL OR char_length(link) <= 120);

ALTER TABLE curator_requests DROP CONSTRAINT IF EXISTS curator_requests_kind_check;
ALTER TABLE curator_requests ADD CONSTRAINT curator_requests_kind_check
  CHECK (kind IN ('limits', 'group', 'stage', 'plan', 'other', 'review'));

-- One open request per trader and kind → per trader, kind and thread (link is NULL for every kind but «review»).
DROP INDEX IF EXISTS curator_requests_open_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS curator_requests_open_link_uniq
  ON curator_requests (trader_id, kind, COALESCE(link, '')) WHERE status = 'open';
