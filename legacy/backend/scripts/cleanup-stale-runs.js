require("dotenv").config();

const { createPool, ensureSchema, hasDatabase } = require("./lib/content-db");

function fail(message) {
  console.error(`[cleanup-stale-runs][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

function parseOlderThanHours() {
  const arg = process.argv.find((item) => item.startsWith("--older-than-hours="));
  if (!arg) {
    return 24;
  }

  const value = Number(arg.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    fail("Invalid --older-than-hours value");
  }

  return value;
}

async function main() {
  if (!hasDatabase()) {
    fail("Database is not configured");
  }

  const apply = process.argv.includes("--apply");
  const olderThanHours = parseOlderThanHours();
  const pool = createPool();

  try {
    await ensureSchema(pool);

    const { rows } = await pool.query(
      `
        SELECT
          topic_key,
          status,
          current_stage,
          category,
          title,
          topic,
          updated_at
        FROM content_runs
        WHERE
          status IN ('selected', 'generated')
          AND youtube_url IS NULL
          AND youtube_video_id IS NULL
          AND updated_at < NOW() - ($1::text || ' hours')::interval
        ORDER BY updated_at DESC
      `,
      [String(olderThanHours)],
    );

    const topicKeys = rows.map((row) => row.topic_key).filter(Boolean);

    if (!topicKeys.length) {
      log("no stale runs found", { olderThanHours });
      return;
    }

    log("stale runs found", {
      total: topicKeys.length,
      apply,
      olderThanHours,
      topicKeys,
    });

    if (!apply) {
      log("dry run only", { rows });
      return;
    }

    await pool.query("BEGIN");
    await pool.query("DELETE FROM execution_logs WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("DELETE FROM content_events WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("DELETE FROM content_artifacts WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("DELETE FROM content_runs WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("COMMIT");

    log("stale runs deleted", { total: topicKeys.length, olderThanHours });
  } catch (error) {
    try {
      await pool.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  fail(error.message);
});
