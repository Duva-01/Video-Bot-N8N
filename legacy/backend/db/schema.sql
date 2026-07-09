CREATE TABLE IF NOT EXISTS content_runs (
  id BIGSERIAL PRIMARY KEY,
  topic_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  topic TEXT NOT NULL,
  angle TEXT NOT NULL,
  title TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'selected',
  current_stage TEXT NOT NULL DEFAULT 'selected',
  source TEXT NOT NULL DEFAULT 'catalog',
  run_origin TEXT NOT NULL DEFAULT 'n8n',
  n8n_workflow_id TEXT,
  n8n_workflow_name TEXT,
  workflow_execution_id BIGINT,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  youtube_video_id TEXT,
  youtube_url TEXT,
  tiktok_publish_id TEXT,
  tiktok_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE content_runs ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT 'selected';
ALTER TABLE content_runs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'catalog';
ALTER TABLE content_runs ADD COLUMN IF NOT EXISTS run_origin TEXT NOT NULL DEFAULT 'n8n';
ALTER TABLE content_runs ADD COLUMN IF NOT EXISTS n8n_workflow_id TEXT;
ALTER TABLE content_runs ADD COLUMN IF NOT EXISTS n8n_workflow_name TEXT;
ALTER TABLE content_runs ADD COLUMN IF NOT EXISTS workflow_execution_id BIGINT;
ALTER TABLE content_runs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS content_events (
  id BIGSERIAL PRIMARY KEY,
  topic_key TEXT REFERENCES content_runs(topic_key) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  stage TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_artifacts (
  id BIGSERIAL PRIMARY KEY,
  topic_key TEXT REFERENCES content_runs(topic_key) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  label TEXT,
  file_path TEXT,
  external_url TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id BIGSERIAL PRIMARY KEY,
  topic_key TEXT REFERENCES content_runs(topic_key) ON DELETE SET NULL,
  workflow_id TEXT,
  execution_id BIGINT,
  source TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_snapshots (
  workflow_id TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_execution_id BIGINT,
  last_status TEXT,
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS system_samples (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL,
  sample_type TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  unit TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  ip_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_runs_status ON content_runs (status);
CREATE INDEX IF NOT EXISTS idx_content_runs_stage ON content_runs (current_stage);
CREATE INDEX IF NOT EXISTS idx_content_runs_category ON content_runs (category);
CREATE INDEX IF NOT EXISTS idx_content_runs_source ON content_runs (source);
CREATE INDEX IF NOT EXISTS idx_content_runs_selected_at_desc ON content_runs (selected_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_runs_published_at_desc ON content_runs (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_runs_updated_at_desc ON content_runs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_runs_failed_at_desc ON content_runs (failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_runs_metadata_gin ON content_runs USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_content_events_topic_key ON content_events (topic_key);
CREATE INDEX IF NOT EXISTS idx_content_events_stage ON content_events (stage);
CREATE INDEX IF NOT EXISTS idx_content_events_level ON content_events (level);
CREATE INDEX IF NOT EXISTS idx_content_events_created_at_desc ON content_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_events_metadata_gin ON content_events USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_content_artifacts_topic_key ON content_artifacts (topic_key);
CREATE INDEX IF NOT EXISTS idx_content_artifacts_type ON content_artifacts (artifact_type);
CREATE INDEX IF NOT EXISTS idx_content_artifacts_created_at_desc ON content_artifacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_artifacts_metadata_gin ON content_artifacts USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_execution_logs_topic_key ON execution_logs (topic_key);
CREATE INDEX IF NOT EXISTS idx_execution_logs_workflow_id ON execution_logs (workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_execution_id ON execution_logs (execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_created_at_desc ON execution_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_logs_context_gin ON execution_logs USING GIN (context);

CREATE INDEX IF NOT EXISTS idx_system_samples_service_created_at_desc ON system_samples (service, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_samples_metric_created_at_desc ON system_samples (metric_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_audit_logs_created_at_desc ON api_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_action ON api_audit_logs (action);
