require("dotenv").config();

const { createPool, ensureSchema, hasDatabase } = require("./lib/content-db");

function fail(message) {
  console.error(`[normalize-uploaded-runs][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

async function main() {
  if (!hasDatabase()) {
    fail("Database is not configured");
  }

  const apply = process.argv.includes("--apply");
  const pool = createPool();

  try {
    await ensureSchema(pool);

    const { rows } = await pool.query(`
      SELECT
        topic_key,
        status,
        current_stage,
        youtube_url,
        youtube_video_id,
        published_at,
        updated_at
      FROM content_runs
      WHERE
        (youtube_url IS NOT NULL OR youtube_video_id IS NOT NULL)
        AND status <> 'published'
      ORDER BY COALESCE(published_at, updated_at, selected_at) DESC
    `);

    if (!rows.length) {
      log("no uploaded runs require normalization");
      return;
    }

    log("uploaded runs require normalization", {
      total: rows.length,
      apply,
      topicKeys: rows.map((row) => row.topic_key),
    });

    if (!apply) {
      log("dry run only");
      return;
    }

    await pool.query("BEGIN");
    await pool.query(
      `
        UPDATE content_runs
        SET
          status = 'published',
          current_stage = 'published',
          published_at = COALESCE(published_at, updated_at, NOW()),
          updated_at = NOW()
        WHERE
          (youtube_url IS NOT NULL OR youtube_video_id IS NOT NULL)
          AND status <> 'published'
      `,
    );
    await pool.query("COMMIT");

    log("uploaded runs normalized", { total: rows.length });
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
