const { Pool } = require("pg");

function getDatabaseUrl() {
  return process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "";
}

function hasDatabase() {
  return Boolean(getDatabaseUrl());
}

function createPool() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error("Missing NEON_DATABASE_URL or DATABASE_URL");
  }

  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_runs (
      id BIGSERIAL PRIMARY KEY,
      topic_key TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      angle TEXT NOT NULL,
      title TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'selected',
      selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ,
      youtube_video_id TEXT,
      youtube_url TEXT,
      tiktok_publish_id TEXT,
      tiktok_status TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

async function upsertSelection(pool, item) {
  await pool.query(
    `
      INSERT INTO content_runs (topic_key, category, topic, angle, status, metadata)
      VALUES ($1, $2, $3, $4, 'selected', $5::jsonb)
      ON CONFLICT (topic_key)
      DO UPDATE SET
        status = 'selected',
        updated_at = NOW(),
        metadata = content_runs.metadata || EXCLUDED.metadata
    `,
    [item.key, item.category, item.topic, item.angle, JSON.stringify({ source: "catalog" })],
  );
}

async function markGenerated(pool, payload) {
  await pool.query(
    `
      UPDATE content_runs
      SET
        title = $2,
        description = $3,
        status = 'generated',
        updated_at = NOW(),
        metadata = content_runs.metadata || $4::jsonb
      WHERE topic_key = $1
    `,
    [
      payload.topic_key,
      payload.title || null,
      payload.description || null,
      JSON.stringify({
        search_query: payload.search_query,
        tags: payload.tags || [],
      }),
    ],
  );
}

async function markPublished(pool, payload) {
  await pool.query(
    `
      UPDATE content_runs
      SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        status = 'published',
        updated_at = NOW(),
        published_at = NOW(),
        youtube_video_id = COALESCE($4, youtube_video_id),
        youtube_url = COALESCE($5, youtube_url),
        tiktok_publish_id = COALESCE($6, tiktok_publish_id),
        tiktok_status = COALESCE($7, tiktok_status),
        metadata = content_runs.metadata || $8::jsonb
      WHERE topic_key = $1
    `,
    [
      payload.topic_key,
      payload.title || null,
      payload.description || null,
      payload.youtube_video_id || null,
      payload.youtube_url || null,
      payload.tiktok_publish_id || null,
      payload.tiktok_status || null,
      JSON.stringify(payload.metadata || {}),
    ],
  );
}

module.exports = {
  createPool,
  ensureSchema,
  hasDatabase,
  markGenerated,
  markPublished,
  upsertSelection,
};
