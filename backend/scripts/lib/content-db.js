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

async function checksumFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
    stream.on("error", reject);
  });
}

function fileSize(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return fs.statSync(filePath).size;
}

function buildTopicFallback(payload = {}) {
  const topicKey = payload.topic_key || payload.key || null;
  if (!topicKey) {
    return null;
  }

  return {
    key: topicKey,
    category: payload.category || "unknown",
    topic: payload.topic || payload.title || topicKey,
    angle: payload.angle || payload.stage || payload.message || "pipeline event",
    source: payload.source || payload.topic_source || "recovered",
  };
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

async function ensureContentRun(pool, payload, metadata = {}) {
  const fallback = buildTopicFallback(payload);
  if (!fallback) {
    return;
  }

  await upsertSelection(pool, fallback, {
    recovered: true,
    ...metadata,
  });
}

async function markGenerated(pool, payload) {
  await ensureContentRun(pool, payload, {
    title: payload.title || null,
    description: payload.description || null,
    search_query: payload.search_query || null,
  });

  await pool.query(
    `
      INSERT INTO content_runs (
        topic_key,
        category,
        topic,
        angle,
        title,
        description,
        status,
        current_stage,
        source,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'generated', 'script_generated', $7, $8::jsonb)
      ON CONFLICT (topic_key)
      DO UPDATE SET
        category = COALESCE(EXCLUDED.category, content_runs.category),
        topic = COALESCE(EXCLUDED.topic, content_runs.topic),
        angle = COALESCE(EXCLUDED.angle, content_runs.angle),
        title = COALESCE(EXCLUDED.title, content_runs.title),
        description = COALESCE(EXCLUDED.description, content_runs.description),
        status = 'generated',
        current_stage = 'script_generated',
        source = COALESCE(EXCLUDED.source, content_runs.source),
        updated_at = NOW(),
        metadata = content_runs.metadata || EXCLUDED.metadata
    `,
    [
      payload.topic_key,
      payload.category || "unknown",
      payload.topic || payload.title || payload.topic_key,
      payload.angle || "generated script",
      payload.title || null,
      payload.description || null,
      payload.topic_source || payload.source || "generated",
      json({
        search_query: payload.search_query,
        tags: payload.tags || [],
        visual_keywords: payload.visual_keywords || [],
      }),
    ],
  );
}

async function markPublished(pool, payload) {
  await ensureContentRun(pool, payload, {
    youtube_video_id: payload.youtube_video_id || null,
    youtube_url: payload.youtube_url || null,
  });

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
  await ensureContentRun(pool, payload, {
    error: payload.error || null,
    stage: payload.stage || null,
  });

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
  await ensureContentRun(pool, payload, {
    event_type: payload.event_type || "info",
    stage: payload.stage || "unknown",
  });

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
  await ensureContentRun(pool, payload, {
    artifact_type: payload.artifact_type || "artifact",
    file_path: payload.file_path || null,
    external_url: payload.external_url || null,
  });

  const sizeBytes = payload.size_bytes ?? fileSize(payload.file_path);
  const checksum = payload.checksum ?? (await checksumFromFile(payload.file_path));

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
  await ensureContentRun(pool, payload, {
    workflow_id: payload.workflow_id || null,
    execution_id: payload.execution_id || null,
  });

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
    youtubeSummaryResult,
    instagramSummaryResult,
    tiktokSummaryResult,
    youtubeRecentResult,
    instagramRecentResult,
    tiktokRecentResult,
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE youtube_url IS NOT NULL OR youtube_video_id IS NOT NULL)::int AS total_videos,
          COUNT(*) FILTER (WHERE status = 'published')::int AS published_videos,
          COUNT(*) FILTER (
            WHERE status = 'generated'
              AND youtube_url IS NULL
              AND youtube_video_id IS NULL
          )::int AS generated_videos,
          COUNT(*) FILTER (
            WHERE status = 'selected'
              AND youtube_url IS NULL
              AND youtube_video_id IS NULL
          )::int AS selected_videos,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_videos,
          COUNT(DISTINCT category) FILTER (
            WHERE status IN ('generated', 'published')
              OR youtube_url IS NOT NULL
              OR youtube_video_id IS NOT NULL
          )::int AS categories_covered,
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
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE metadata ? 'youtube_result'
               OR youtube_url IS NOT NULL
               OR youtube_video_id IS NOT NULL
          )::int AS attempted,
          COUNT(*) FILTER (
            WHERE youtube_url IS NOT NULL
               OR youtube_video_id IS NOT NULL
          )::int AS published,
          COUNT(*) FILTER (
            WHERE COALESCE(metadata -> 'youtube_result' ->> 'status', '') = 'failed'
          )::int AS failed,
          MAX(COALESCE(published_at, updated_at, selected_at)) FILTER (
            WHERE youtube_url IS NOT NULL
               OR youtube_video_id IS NOT NULL
          ) AS last_published_at
        FROM content_runs
      `,
    ),
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE metadata -> 'social_posts' ? 'instagram'
          )::int AS attempted,
          COUNT(*) FILTER (
            WHERE COALESCE(metadata -> 'social_posts' -> 'instagram' ->> 'status', '') = 'published'
          )::int AS published,
          COUNT(*) FILTER (
            WHERE COALESCE(metadata -> 'social_posts' -> 'instagram' ->> 'status', '') = 'failed'
          )::int AS failed,
          MAX(COALESCE(published_at, updated_at, selected_at)) FILTER (
            WHERE COALESCE(metadata -> 'social_posts' -> 'instagram' ->> 'status', '') = 'published'
          ) AS last_published_at
        FROM content_runs
      `,
    ),
    pool.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE metadata -> 'social_posts' ? 'tiktok'
               OR tiktok_publish_id IS NOT NULL
               OR tiktok_status IS NOT NULL
          )::int AS attempted,
          COUNT(*) FILTER (
            WHERE COALESCE(metadata -> 'social_posts' -> 'tiktok' ->> 'status', '') = 'published'
               OR COALESCE(tiktok_status, '') = 'PUBLISH_COMPLETE'
          )::int AS published,
          COUNT(*) FILTER (
            WHERE COALESCE(metadata -> 'social_posts' -> 'tiktok' ->> 'status', '') = 'failed'
          )::int AS failed,
          MAX(COALESCE(published_at, updated_at, selected_at)) FILTER (
            WHERE COALESCE(metadata -> 'social_posts' -> 'tiktok' ->> 'status', '') = 'published'
               OR COALESCE(tiktok_status, '') = 'PUBLISH_COMPLETE'
          ) AS last_published_at
        FROM content_runs
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
        WHERE metadata ? 'youtube_result'
           OR youtube_url IS NOT NULL
           OR youtube_video_id IS NOT NULL
        ORDER BY COALESCE(published_at, updated_at, selected_at) DESC
        LIMIT 8
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
        WHERE metadata -> 'social_posts' ? 'instagram'
        ORDER BY COALESCE(published_at, updated_at, selected_at) DESC
        LIMIT 8
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
          metadata,
          tiktok_publish_id,
          tiktok_status
        FROM content_runs
        WHERE metadata -> 'social_posts' ? 'tiktok'
           OR tiktok_publish_id IS NOT NULL
           OR tiktok_status IS NOT NULL
        ORDER BY COALESCE(published_at, updated_at, selected_at) DESC
        LIMIT 8
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
    platforms: {
      youtube: {
        name: "YouTube",
        key: "youtube",
        ...youtubeSummaryResult.rows[0],
        recentItems: youtubeRecentResult.rows,
      },
      instagram: {
        name: "Instagram",
        key: "instagram",
        ...instagramSummaryResult.rows[0],
        recentItems: instagramRecentResult.rows,
      },
      tiktok: {
        name: "TikTok",
        key: "tiktok",
        ...tiktokSummaryResult.rows[0],
        recentItems: tiktokRecentResult.rows,
      },
    },
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

function inferPlatform(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("youtube")) return "youtube";
  if (text.includes("instagram")) return "instagram";
  if (text.includes("tiktok")) return "tiktok";
  return null;
}

function normalizeConsoleEntry(entry) {
  const source = entry.source || entry.action || "system";
  const stage = entry.stage || entry.context?.stage || entry.metadata?.stage || entry.sample_type || "unknown";
  const platform =
    entry.platform ||
    entry.context?.platform ||
    entry.metadata?.platform ||
    inferPlatform(source) ||
    inferPlatform(stage) ||
    inferPlatform(entry.message);
  const status =
    entry.status ||
    entry.context?.status ||
    entry.metadata?.status ||
    (entry.level === "error" ? "failed" : entry.level === "warn" || entry.level === "warning" ? "warning" : "info");
  const reference =
    entry.reference ||
    entry.context?.reference ||
    entry.metadata?.reference ||
    entry.metadata?.publish_id ||
    entry.metadata?.videoId ||
    entry.metadata?.creationId ||
    entry.external_url ||
    null;

  return {
    id: entry.id || null,
    kind: entry.kind || "event",
    topic_key: entry.topic_key || null,
    workflow_id: entry.workflow_id || null,
    execution_id: entry.execution_id || null,
    source,
    stage,
    platform,
    level: entry.level || "info",
    status,
    message: entry.message || entry.label || entry.metric_name || "entry",
    reference,
    timestamp: entry.created_at || null,
    details: entry.context || entry.metadata || {},
  };
}

async function getConsoleFeed(pool, options = {}) {
  const limit = Math.max(20, Math.min(Number(options.limit || 200), 500));
  const overscan = Math.min(limit * 3, 800);
  const platformFilter = String(options.platform || "").trim().toLowerCase();
  const stageFilter = String(options.stage || "").trim().toLowerCase();
  const levelFilter = String(options.level || "").trim().toLowerCase();
  const kindFilter = String(options.kind || "").trim().toLowerCase();
  const search = String(options.search || "").trim().toLowerCase();

  const [eventsResult, executionLogsResult, artifactsResult, apiAuditResult] = await Promise.all([
    pool.query(
      `
        SELECT id, topic_key, event_type, stage, level, source, message, metadata, created_at
        FROM content_events
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [overscan],
    ),
    pool.query(
      `
        SELECT id, topic_key, workflow_id, execution_id, source, level, message, context, created_at
        FROM execution_logs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [overscan],
    ),
    pool.query(
      `
        SELECT id, topic_key, artifact_type, label, external_url, metadata, created_at
        FROM content_artifacts
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [Math.ceil(overscan / 2)],
    ),
    pool.query(
      `
        SELECT id, actor, action, path, status_code, metadata, created_at
        FROM api_audit_logs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [Math.ceil(overscan / 2)],
    ),
  ]);

  const rawEntries = [
    ...eventsResult.rows.map((row) => ({ ...row, kind: "event", metadata: row.metadata || {} })),
    ...executionLogsResult.rows.map((row) => ({ ...row, kind: "execution", context: row.context || {} })),
    ...artifactsResult.rows.map((row) => ({
      ...row,
      kind: "artifact",
      source: "artifact",
      level: "info",
      message: row.label || row.artifact_type,
      metadata: { ...(row.metadata || {}), artifact_type: row.artifact_type, reference: row.external_url || null },
    })),
    ...apiAuditResult.rows.map((row) => ({
      ...row,
      kind: "api",
      source: "api",
      level: row.status_code >= 400 ? "error" : "info",
      message: `${row.action} ${row.path}`,
      stage: "http",
      metadata: { ...(row.metadata || {}), status_code: row.status_code, actor: row.actor },
    })),
  ];

  const entries = rawEntries
    .map(normalizeConsoleEntry)
    .filter((entry) => {
      if (platformFilter && String(entry.platform || "").toLowerCase() !== platformFilter) {
        return false;
      }
      if (stageFilter && !String(entry.stage || "").toLowerCase().includes(stageFilter)) {
        return false;
      }
      if (levelFilter && String(entry.level || "").toLowerCase() !== levelFilter) {
        return false;
      }
      if (kindFilter && String(entry.kind || "").toLowerCase() !== kindFilter) {
        return false;
      }
      if (search) {
        const blob = JSON.stringify(entry).toLowerCase();
        return blob.includes(search);
      }
      return true;
    })
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .slice(0, limit);

  const counts = entries.reduce(
    (acc, entry) => {
      acc.total += 1;
      acc.byKind[entry.kind] = (acc.byKind[entry.kind] || 0) + 1;
      if (entry.platform) {
        acc.byPlatform[entry.platform] = (acc.byPlatform[entry.platform] || 0) + 1;
      }
      acc.byLevel[entry.level] = (acc.byLevel[entry.level] || 0) + 1;
      return acc;
    },
    { total: 0, byKind: {}, byPlatform: {}, byLevel: {} },
  );

  return { entries, counts };
}

module.exports = {
  createPool,
  ensureContentRun,
  ensureSchema,
  getConsoleFeed,
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
