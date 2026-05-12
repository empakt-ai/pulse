-- 005_content_intelligence.sql
-- Cross-platform content intelligence module: link posts that represent the
-- same piece of content across platforms, and group those pieces into series
-- where they form a numbered sequence (Part N, Episode N, etc).
--
-- Additive — safe to run on a populated DB. Run in Supabase SQL Editor.

-- ─── series ──────────────────────────────────────────────────────────────
-- A numbered content sequence detected across the user's catalogue.
-- `detected_name` is the normalized caption stem the detector grouped on;
-- `name` is what the AI or user labels it. trend is recomputed on every
-- sync run.
CREATE TABLE IF NOT EXISTS series (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text,
  detected_name   text NOT NULL,
  post_count      integer NOT NULL DEFAULT 0,
  avg_views       bigint NOT NULL DEFAULT 0,
  peak_views      bigint NOT NULL DEFAULT 0,
  latest_number   integer,
  -- growing: latest entry > first by 20%+ in views
  -- declining: latest entry < first * 0.7
  -- stable: in between
  -- stale: no new entry in 14+ days
  trend           text NOT NULL DEFAULT 'stable',
  last_entry_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_series_workspace ON series(workspace_id);
CREATE INDEX IF NOT EXISTS idx_series_workspace_detected
  ON series(workspace_id, detected_name);

-- ─── content_pieces ──────────────────────────────────────────────────────
-- Groups posts that are the same content republished across platforms (e.g.
-- a Reel posted to IG and reposted to TikTok). Detection runs on every sync
-- using a normalized caption fingerprint + a 48-hour window.
CREATE TABLE IF NOT EXISTS content_pieces (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  series_id           uuid REFERENCES series(id) ON DELETE SET NULL,
  title               text,
  fingerprint         text NOT NULL,  -- normalized caption stem used for grouping
  first_posted_at     timestamptz,
  detected_platforms  text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Convenience aggregates so signal generation can rank without re-joining:
  total_views         bigint NOT NULL DEFAULT 0,
  best_platform       text,
  best_views          bigint NOT NULL DEFAULT 0,
  worst_views         bigint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_pieces_workspace ON content_pieces(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_pieces_workspace_fp
  ON content_pieces(workspace_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_content_pieces_series ON content_pieces(series_id);

-- ─── posts.content_piece_id ──────────────────────────────────────────────
-- Foreign key linking each post to its content piece. NULL until the
-- detector groups it (every sync run).
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_piece_id uuid REFERENCES content_pieces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_content_piece ON posts(content_piece_id);

-- ─── posts.series_id ─────────────────────────────────────────────────────
-- Denormalized for fast "all posts in this series" reads. Always matches
-- content_pieces.series_id for the piece this post belongs to.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_series ON posts(series_id);

-- ─── posts.is_collab ─────────────────────────────────────────────────────
-- For the collaboration_multiplier signal. Detected from caption (@mentions
-- of accounts not in connected_accounts) or platform-specific collab flags
-- in raw_data. Boolean keeps the read path trivial.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS is_collab boolean NOT NULL DEFAULT false;

-- ─── posts.detected_language ─────────────────────────────────────────────
-- ISO 639-1 code or null. Populated lazily — only when the workspace has
-- mixed-language captions, the detector runs the langid heuristic.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS detected_language text;
