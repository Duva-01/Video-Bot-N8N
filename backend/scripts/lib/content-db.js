const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
    max: Number(process.env.CONTENT_DB_POOL_SIZE || 1),
    idleTimeoutMillis: Number(process.env.CONTENT_DB_IDLE_TIMEOUT_MS || 15000),
    connectionTimeoutMillis: Number(process.env.CONTENT_DB_CONNECT_TIMEOUT_MS || 15000),
  });
}

async function ensureSchema(pool) {
  const schemaPath = path.resolve(__dirname, "..", "..", "db", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schemaSql);
}

function json(value) {
  return JSON.stringify(value || {});
}

function checksumFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

function fileSize(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return fs.statSync(filePath).size;
}

async function upsertSelection(pool, item, metadata = {}) {
  await pool.query(
    `
      INSERT INTO content_runs (
        topic_key,
        category,
        topic,
        angle,
        status,
        current_stage,
        source,
        metadata
      )
      VALUES ($1, $2, $3, $4, 'selected', 'topic_selected', $5, $6::jsonb)
      ON CONFLICT (topic_key)
      DO UPDATE SET
        category = EXCLUDED.category,
        topic = EXCLUDED.topic,
        angle = EXCLUDED.angle,
        status = 'selected',
        current_stage = 'topic_selected',
        source = EXCLUDED.source,
        updated_at = NOW(),
        metadata = content_runs.metadata || EXCLUDED.metadata
    `,
    [item.key, item.category, item.topic, item.angle, item.source || "catalog", json(metadata)],
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
        current_stage = 'script_generated',
        source = COALESCE($4, source),
        updated_at = NOW(),
        metadata = content_runs.metadata || $5::jsonb
      WHERE topic_key = $1
    `,
    [
      payload.topic_key,
      payload.title || null,
      payload.description || null,
      payload.topic_source || null,
      json({
        search_query: payload.search_query,
        tags: payload.tags || [],
        visual_keywords: payload.visual_keywords || [],
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
        current_stage = 'published',
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
      json(payload.metadata || {}),
    ],
  );
}

async function markFailed(pool, payload) {
  await pool.query(
    `
      UPDATE content_runs
      SET
        status = 'failed',
        current_stage = COALESCE($2, current_stage),
        failed_at = NOW(),
        updated_at = NOW(),
        metadata = content_runs.metadata || $3::jsonb
      WHERE topic_key = $1
    `,
    [
      payload.topic_key,
      payload.stage || null,
      json({
        error: payload.error || null,
        failure_source: payload.source || null,
        failure_code: payload.code || null,
        ...payload.metadata,
      }),
    ],
  );
}

async function recordEvent(pool, payload) {
  await pool.query(
    `
      INSERT INTO content_events (topic_key, event_type, stage, level, source, message, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      payload.topic_key || null,
      payload.event_type || "info",
      payload.stage || "unknown",
      payload.level || "info",
      payload.source || "system",
      payload.message || "event",
      json(payload.metadata || {}),
    ],
  );
}

async function recordArtifact(pool, payload) {
  const sizeBytes = payload.size_bytes ?? fileSize(payload.file_path);
  const checksum = payload.checksum ?? checksumFromFile(payload.file_path);

  await pool.query(
    `
      INSERT INTO content_artifacts (
        topic_key,
        artifact_type,
        label,
        file_path,
        external_url,
        mime_type,
        size_bytes,
        checksum,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      payload.topic_key,
      payload.artifact_type,
      payload.label || null,
      payload.file_path || null,
      payload.external_url || null,
      payload.mime_type || null,
      sizeBytes || null,
      checksum || null,
      json(payload.metadata || {}),
    ],
  );
}

async function recordExecutionLog(pool, payload) {
  await pool.query(
    `
      INSERT INTO execution_logs (topic_key, workflow_id, execution_id, source, level, message, context)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      payload.topic_key || null,
      payload.workflow_id || null,
      payload.execution_id || null,
      payload.source || "runtime",
      payload.level || "info",
      payload.message || "execution log",
      json(payload.context || {}),
    ],
  );
}

async function upsertWorkflowSnapshot(pool, payload) {
  await pool.query(
    `
      INSERT INTO workflow_snapshots (
        workflow_id,
        workflow_name,
        active,
        trigger_count,
        last_execution_id,
        last_status,
        last_started_at,
        last_finished_at,
        metadata,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      ON CONFLICT (workflow_id)
      DO UPDATE SET
        workflow_name = EXCLUDED.workflow_name,
        active = EXCLUDED.active,
        trigger_count = EXCLUDED.trigger_count,
        last_execution_id = EXCLUDED.last_execution_id,
        last_status = EXCLUDED.last_status,
        last_started_at = EXCLUDED.last_started_at,
        last_finished_at = EXCLUDED.last_finished_at,
        metadata = workflow_snapshots.metadata || EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      String(payload.workflow_id),
      payload.workflow_name || "workflow",
      Boolean(payload.active),
      Number(payload.trigger_count || 0),
      payload.last_execution_id || null,
      payload.last_status || null,
      payload.last_started_at || null,
      payload.last_finished_at || null,
      json(payload.metadata || {}),
    ],
  );
}

async function recordSystemSample(pool, payload) {
  await pool.query(
    `
      INSERT INTO system_samples (service, sample_type, metric_name, metric_value, unit, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      payload.service || "facts-engine",
      payload.sample_type || "runtime",
      payload.metric_name,
      Number(payload.metric_value || 0),
      payload.unit || null,
      json(payload.metadata || {}),
    ],
  );
}

async function recordApiAudit(pool, payload) {
  await pool.query(
    `
      INSERT INTO api_audit_logs (actor, action, path, status_code, ip_address, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      payload.actor || null,
      payload.action || "request",
      payload.path || "/",
      payload.status_code || null,
      payload.ip_address || null,
      json(payload.metadata || {}),
    ],
  );
}

async function getDashboardSummary(pool) {
  const [
    totalsResult,
    statusResult,
    categoryResult,
    recentRunsResult,
    recentEventsResult,
    artifactSummaryResult,
    memorySamplesResult,
    workflowStateResult,
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_videos,
          COUNT(*) FILTER (WHERE status = 'published')::int AS published_videos,
          COUNT(*) FILTER (WHERE status = 'generated')::int AS generated_videos,
          COUNT(*) FILTER (WHERE status = 'selected')::int AS selected_videos,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_videos,
          COUNT(DISTINCT category)::int AS categories_covered,
          MAX(published_at) AS last_published_at
        FROM content_runs
      `,
    ),
    pool.query(
      `
        SELECT status, COUNT(*)::int AS total
        FROM content_runs
        GROUP BY status
        ORDER BY total DESC, status ASC
      `,
    ),
    pool.query(
      `
        SELECT category, COUNT(*)::int AS total
        FROM content_runs
        GROUP BY category
        ORDER BY total DESC, category ASC
        LIMIT 10
      `,
    ),
    pool.query(
      `
        SELECT
          topic_key,
          category,
          topic,
          angle,
          title,
          status,
          current_stage,
          source,
          youtube_url,
          youtube_video_id,
          selected_at,
          published_at,
          updated_at,
          metadata
        FROM content_runs
        ORDER BY COALESCE(published_at, updated_at, selected_at) DESC
        LIMIT 12
      `,
    ),
    pool.query(
      `
        SELECT id, topic_key, event_type, stage, level, source, message, metadata, created_at
        FROM content_events
        ORDER BY created_at DESC
        LIMIT 20
      `,
    ),
    pool.query(
      `
        SELECT artifact_type, COUNT(*)::int AS total
        FROM content_artifacts
        GROUP BY artifact_type
        ORDER BY total DESC, artifact_type ASC
      `,
    ),
    pool.query(
      `
        SELECT metric_name, metric_value, unit, metadata, created_at
        FROM system_samples
        WHERE metric_name IN ('rss_mb', 'heap_used_mb')
        ORDER BY created_at DESC
        LIMIT 20
      `,
    ),
    pool.query(
      `
        SELECT workflow_id, workflow_name, active, trigger_count, last_execution_id, last_status, last_started_at, last_finished_at, updated_at, metadata
        FROM workflow_snapshots
        ORDER BY updated_at DESC
        LIMIT 1
      `,
    ),
  ]);

  return {
    totals: totalsResult.rows[0] || {
      total_videos: 0,
      published_videos: 0,
      generated_videos: 0,
      selected_videos: 0,
      failed_videos: 0,
      categories_covered: 0,
      last_published_at: null,
    },
    byStatus: statusResult.rows,
    byCategory: categoryResult.rows,
    recentRuns: recentRunsResult.rows,
    recentEvents: recentEventsResult.rows,
    artifactSummary: artifactSummaryResult.rows,
    memorySamples: memorySamplesResult.rows.reverse(),
    workflowSnapshot: workflowStateResult.rows[0] || null,
  };
}

async function getOperationsLog(pool, limit = 40) {
  const [eventsResult, executionLogsResult, artifactsResult, apiAuditResult, sampleResult] = await Promise.all([
    pool.query(
      `
        SELECT id, topic_key, event_type, stage, level, source, message, metadata, created_at
        FROM content_events
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    ),
    pool.query(
      `
        SELECT id, topic_key, workflow_id, execution_id, source, level, message, context, created_at
        FROM execution_logs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    ),
    pool.query(
      `
        SELECT id, topic_key, artifact_type, label, file_path, external_url, mime_type, size_bytes, metadata, created_at
        FROM content_artifacts
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    ),
    pool.query(
      `
        SELECT id, actor, action, path, status_code, ip_address, metadata, created_at
        FROM api_audit_logs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    ),
    pool.query(
      `
        SELECT service, sample_type, metric_name, metric_value, unit, metadata, created_at
        FROM system_samples
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    ),
  ]);

  return {
    events: eventsResult.rows,
    executionLogs: executionLogsResult.rows,
    artifacts: artifactsResult.rows,
    apiAudit: apiAuditResult.rows,
    samples: sampleResult.rows,
  };
}

module.exports = {
  createPool,
  ensureSchema,
  getDashboardSummary,
  getOperationsLog,
  hasDatabase,
  markFailed,
  markGenerated,
  markPublished,
  recordApiAudit,
  recordArtifact,
  recordEvent,
  recordExecutionLog,
  recordSystemSample,
  upsertSelection,
  upsertWorkflowSnapshot,
};
