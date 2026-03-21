CREATE TABLE IF NOT EXISTS content_runs (
  id BIGSERIAL PRIMARY KEY,
  topic_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  topic TEXT NOT NULL,
  angle TEXT NOT NULL,
  title TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'selected' CHECK (status IN ('selected', 'generated', 'published', 'failed')),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  youtube_video_id TEXT,
  youtube_url TEXT,
  tiktok_publish_id TEXT,
  tiktok_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_content_runs_status ON content_runs (status);
CREATE INDEX IF NOT EXISTS idx_content_runs_category ON content_runs (category);
CREATE INDEX IF NOT EXISTS idx_content_runs_selected_at_desc ON content_runs (selected_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_runs_published_at_desc ON content_runs (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_runs_updated_at_desc ON content_runs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_runs_metadata_gin ON content_runs USING GIN (metadata);
