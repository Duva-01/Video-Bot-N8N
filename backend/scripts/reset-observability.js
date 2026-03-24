require("dotenv").config();

const { createPool, ensureSchema, hasDatabase } = require("./lib/content-db");

async function main() {
  if (!hasDatabase()) {
    throw new Error("Missing NEON_DATABASE_URL or DATABASE_URL");
  }

  const pool = createPool();
  try {
    await ensureSchema(pool);
    await pool.query(`
      TRUNCATE TABLE
        api_audit_logs,
        system_samples,
        workflow_snapshots,
        execution_logs,
        content_artifacts,
        content_events,
        content_runs
      RESTART IDENTITY CASCADE
    `);
    console.log(JSON.stringify({ ok: true, reset: "full_observability" }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[reset-observability][error] ${error.message}`);
  process.exit(1);
});
