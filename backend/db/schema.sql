create extension if not exists pgcrypto;

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  language_code text not null default 'en',
  niche text,
  niche_strategy jsonb not null default '{}'::jsonb,
  brand_payload jsonb not null default '{}'::jsonb,
  default_duration_minutes integer not null default 38,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists content_runs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  run_date date not null,
  niche text,
  canonical_topic text,
  angle text,
  topic text not null,
  format text not null default 'longform',
  status text not null default 'draft',
  review_status text not null default 'needs_review',
  delivery_mode text not null default 'b2_manual_publish',
  delivery_status text not null default 'queued',
  title text,
  description text,
  hook text,
  target_duration_minutes numeric(6,2) not null default 38,
  final_duration_seconds integer,
  render_provider text,
  render_job_id text,
  voice_provider text,
  music_provider text,
  storage_bucket text,
  storage_prefix text,
  storage_url text,
  thumbnail_url text,
  youtube_video_id text,
  youtube_url text,
  thumbnail_prompt text,
  originality_score numeric(5,2),
  monetization_status text,
  uniqueness_hash text,
  source_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, run_date)
);

create table if not exists content_chapters (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references content_runs(id) on delete cascade,
  chapter_index integer not null,
  title text not null,
  objective text,
  summary text,
  estimated_duration_seconds integer,
  script_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, chapter_index)
);

create table if not exists content_scenes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references content_runs(id) on delete cascade,
  chapter_id uuid references content_chapters(id) on delete set null,
  scene_index integer not null,
  visual_type text,
  asset_query text,
  visual_prompt text,
  voice_text text not null,
  estimated_duration_seconds integer,
  status text not null default 'draft',
  scene_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, scene_index)
);

create table if not exists content_assets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references content_runs(id) on delete cascade,
  scene_id uuid references content_scenes(id) on delete set null,
  asset_type text not null,
  provider text,
  source_url text,
  storage_url text,
  mime_type text,
  duration_seconds numeric(8,2),
  width integer,
  height integer,
  status text not null default 'created',
  asset_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists publish_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references content_runs(id) on delete cascade,
  platform text not null default 'backblaze_b2',
  status text not null default 'queued',
  scheduled_for timestamptz,
  published_at timestamptz,
  remote_id text,
  remote_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references content_runs(id) on delete cascade,
  event_type text not null,
  stage text,
  level text not null default 'info',
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists editorial_topics (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  niche text not null,
  canonical_topic text not null,
  working_title text,
  angle text,
  status text not null default 'candidate',
  priority integer not null default 0,
  source_type text,
  source_url text,
  notes text,
  last_considered_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, canonical_topic)
);

create table if not exists subtitle_segments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references content_runs(id) on delete cascade,
  scene_id uuid references content_scenes(id) on delete set null,
  segment_index integer not null,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  emphasis_words jsonb not null default '[]'::jsonb,
  style_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, segment_index)
);

create index if not exists idx_content_runs_status on content_runs(status);
create index if not exists idx_content_runs_review_status on content_runs(review_status);
create index if not exists idx_content_runs_delivery_status on content_runs(delivery_status);
create index if not exists idx_content_runs_run_date on content_runs(run_date desc);
create index if not exists idx_content_runs_canonical_topic on content_runs(canonical_topic);
create index if not exists idx_content_runs_uniqueness_hash on content_runs(uniqueness_hash);
create index if not exists idx_content_scenes_run_id on content_scenes(run_id);
create index if not exists idx_content_assets_run_id on content_assets(run_id);
create index if not exists idx_publish_jobs_run_id on publish_jobs(run_id);
create index if not exists idx_workflow_events_run_id on workflow_events(run_id);
create index if not exists idx_editorial_topics_channel_niche on editorial_topics(channel_id, niche);
create index if not exists idx_editorial_topics_status on editorial_topics(status);
create index if not exists idx_subtitle_segments_run_id on subtitle_segments(run_id);
