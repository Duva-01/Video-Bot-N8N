require("dotenv").config();

const { createPool, ensureSchema, hasDatabase } = require("./lib/content-db");

function fail(message) {
  console.error(`[cleanup-failed-runs][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

async function main() {
  if (!hasDatabase()) {
    fail("Database is not configured");
  }

  const mode = (process.argv[2] || "--dry-run").trim();
  const apply = mode === "--apply";
  const pool = createPool();

  try {
    await ensureSchema(pool);

    const { rows } = await pool.query(`
      SELECT topic_key
      FROM content_runs
      WHERE status = 'failed'
      ORDER BY updated_at DESC
    `);

    const topicKeys = rows.map((row) => row.topic_key).filter(Boolean);

    if (!topicKeys.length) {
      log("no failed runs found");
      return;
    }

    log("failed runs found", { total: topicKeys.length, apply });

    if (!apply) {
      log("dry run only", { topicKeys });
      return;
    }

    await pool.query("BEGIN");
    await pool.query("DELETE FROM execution_logs WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("DELETE FROM content_events WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("DELETE FROM content_artifacts WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("DELETE FROM content_runs WHERE topic_key = ANY($1::text[])", [topicKeys]);
    await pool.query("COMMIT");

    log("failed runs deleted", { total: topicKeys.length });
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
