-- The timing axis (lib/sessionFlow/timing.ts): every trade's timing is DERIVED from its fills (the stored strategy +
-- the entry time, nothing on the trade is written). A playbook setup lists the timings it allows — the author's own
-- matrix, written through PATCH /playbook/:id { timings } — and the mentor flags trades taken outside it.
--   am        pre-market round trip          opg      closed by the opening print     open30   09:30–09:59 entry
--   day       regular entry from 10:00       moc      close auction                   pm       after-market
--   opg_day   pre-market into the day        overnight next trading day              swing    two days or more
-- NULL or an empty array = no restriction (every timing allowed).
ALTER TABLE playbook ADD COLUMN IF NOT EXISTS timings text[];
ALTER TABLE playbook DROP CONSTRAINT IF EXISTS playbook_timings_check;
ALTER TABLE playbook ADD CONSTRAINT playbook_timings_check CHECK (
  timings IS NULL OR timings <@ ARRAY['am', 'opg', 'open30', 'day', 'moc', 'pm', 'opg_day', 'overnight', 'swing']::text[]
);
