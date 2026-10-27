-- Persistence audit (docs/persistence/AUDIT.md): user edits that came back wrong after a reload or an API restart.
-- 0274: 0272 / 0273 are left for the branches in flight (one-truth, day-states). The runner allows gaps.

-- (1) One-time seeds. The playbook strategies (lib/migrate.ts runSeeds, on every boot) and the scaling tiers / rules
--     (lib/scalingStore.ensureScalingSeed, on empty tables) were re-inserted after a person renamed a seeded setup,
--     cleared its tags or saved an empty rule list. A seed now runs once per database and leaves its marker here.
CREATE TABLE IF NOT EXISTS seed_markers (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 80),
  done_at timestamptz NOT NULL DEFAULT now()
);

-- A database that already holds the seeded data counts as seeded (nothing is re-inserted on the next boot).
INSERT INTO seed_markers (key) SELECT 'playbook.strategies' WHERE EXISTS (SELECT 1 FROM playbook) ON CONFLICT DO NOTHING;
INSERT INTO seed_markers (key) SELECT 'scaling.tiers' WHERE EXISTS (SELECT 1 FROM scaling_tiers) ON CONFLICT DO NOTHING;
INSERT INTO seed_markers (key) SELECT 'scaling.rules' WHERE EXISTS (SELECT 1 FROM scaling_rules) ON CONFLICT DO NOTHING;

-- (2) Scaling rules on the old 1–10 discipline grade were read ×10 on every load (lib/disciplineIndex), so a threshold
--     a curator typed as 8 came back as 80. The old rows are converted once here and the read stays as stored.
UPDATE scaling_rules
   SET value = value * 10
 WHERE metric = 'discipline' AND unit = 'abs' AND value > 0 AND value <= 10;
UPDATE scaling_rules
   SET label = NULL
 WHERE metric = 'discipline' AND btrim(label) IN ('Оценка дисциплины', 'Дисциплина ниже 4');

-- (3) The morning check-in: one row per person and day. Two quick saves made two rows and the reads picked either one.
--     Duplicates keep the newest row (the last save the person made).
DELETE FROM emotional_state_log e
 USING emotional_state_log newer
 WHERE newer.user_id = e.user_id AND newer.date = e.date AND newer.id > e.id;
CREATE UNIQUE INDEX IF NOT EXISTS emotional_state_log_user_date_uniq ON emotional_state_log (user_id, date);

-- (4) Voice notes without the Replit object storage (local runs, any host without DEFAULT_OBJECT_STORAGE_BUCKET_ID):
--     every save failed with 500 STORAGE_FAILED. The audio now lives here (routes/voicenotes.ts, audio_url '/db/<key>').
CREATE TABLE IF NOT EXISTS voice_note_audio (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 80),
  mime text NOT NULL CHECK (char_length(mime) BETWEEN 1 AND 80),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
