-- Briefing video library (lib/academyBriefings.ts, routes/academy-briefings.ts) — an extension of the Academy lessons
-- (academy_lessons, migration 0234), not a parallel system: a briefing is a lesson with a recording, tags and a
-- «must watch» flag; watching = the existing academy_lesson_progress. 0288: next free number of this branch.
--
-- (1) academy_media: an uploaded recording (the voice-note upload rules: multer, 25 MB, object storage when a bucket is
--     configured, else the bytes here). Soft delete.
CREATE TABLE IF NOT EXISTS academy_media (
  id          serial      PRIMARY KEY,
  mime        text        NOT NULL CHECK (mime ~ '^(video|audio)/[a-z0-9.+-]{1,40}$'),
  size_bytes  integer     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  bytes       bytea,
  object_path text        CHECK (object_path IS NULL OR char_length(object_path) <= 400),
  created_by  text        NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CHECK (bytes IS NOT NULL OR object_path IS NOT NULL)
);

-- (2) The lesson side: theme tags (codes such as tilt, fomo, g2r, 2ndday, execution — shown as #tag, never translated),
--     «must watch» for juniors, the uploaded recording, or a link to an internal file (any http(s) URL; video_url
--     keeps its YouTube / Vimeo / Loom allow-list for embeds). Setups stay in the existing playbook_ids.
ALTER TABLE academy_lessons ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE academy_lessons ADD COLUMN IF NOT EXISTS must_watch boolean NOT NULL DEFAULT false;
ALTER TABLE academy_lessons ADD COLUMN IF NOT EXISTS media_id integer REFERENCES academy_media(id);
ALTER TABLE academy_lessons ADD COLUMN IF NOT EXISTS media_link text;
ALTER TABLE academy_lessons DROP CONSTRAINT IF EXISTS academy_lessons_tags_check;
ALTER TABLE academy_lessons ADD CONSTRAINT academy_lessons_tags_check CHECK (cardinality(tags) <= 12);
ALTER TABLE academy_lessons DROP CONSTRAINT IF EXISTS academy_lessons_media_link_check;
ALTER TABLE academy_lessons ADD CONSTRAINT academy_lessons_media_link_check CHECK (media_link IS NULL OR (media_link ~ '^https?://' AND char_length(media_link) <= 1000));
CREATE INDEX IF NOT EXISTS academy_lessons_tags_idx ON academy_lessons USING GIN (tags);
