-- Trading pods (lib/pods/*, routes/pods.ts): 2–4 traders inside a curator's desk group (desk_groups, migration 0231)
-- with shared pod stats, a pod feed and a shared weekly review. 0287: next free number of this branch.
--
-- trading_pods         one pod of a group; archived, never deleted (its members are released on archive)
-- trading_pod_members  pod ↔ trader by users.id (a link: hard delete allowed); a trader is in at most one pod
-- trading_pod_posts    the pod feed (kind 'post') and the shared weekly review (kind 'review', one per pod and week,
--                      week = the Monday of the NY week, edited by any member or the curator; soft delete)
CREATE TABLE IF NOT EXISTS trading_pods (
  id          serial      PRIMARY KEY,
  group_id    integer     NOT NULL REFERENCES desk_groups(id),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_by  text        NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS trading_pods_group_idx ON trading_pods (group_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS trading_pod_members (
  pod_id   integer     NOT NULL REFERENCES trading_pods(id) ON DELETE CASCADE,
  user_id  integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pod_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS trading_pod_members_one_pod ON trading_pod_members (user_id);

CREATE TABLE IF NOT EXISTS trading_pod_posts (
  id         serial      PRIMARY KEY,
  pod_id     integer     NOT NULL REFERENCES trading_pods(id) ON DELETE CASCADE,
  kind       text        NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'review')),
  week       text        CHECK (week IS NULL OR week ~ '^\d{4}-\d{2}-\d{2}$'),
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  author     text        NOT NULL CHECK (char_length(author) BETWEEN 1 AND 200),
  updated_by text        CHECK (updated_by IS NULL OR char_length(updated_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((kind = 'review') = (week IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS trading_pod_posts_feed_idx ON trading_pod_posts (pod_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trading_pod_posts_review_once ON trading_pod_posts (pod_id, week) WHERE kind = 'review' AND deleted_at IS NULL;
