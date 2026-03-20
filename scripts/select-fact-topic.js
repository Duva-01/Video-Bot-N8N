require("dotenv").config();

const fs = require("fs");
const path = require("path");
const topics = require("../data/fact-topics.json");
const { createPool, ensureSchema, hasDatabase, upsertSelection } = require("./lib/content-db");

function fail(message) {
  console.error(`[select-fact-topic][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...meta,
    }),
  );
}

function buildCandidateList() {
  const allowedCategories = (process.env.FACT_ALLOWED_CATEGORIES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const filtered = allowedCategories.length
    ? topics.filter((item) => allowedCategories.includes(item.category))
    : topics;

  if (filtered.length === 0) {
    fail("No fact topics available after applying FACT_ALLOWED_CATEGORIES");
  }

  return filtered;
}

async function selectTopicFromDb(pool, candidates) {
  const { rows } = await pool.query(
    `
      SELECT topic_key
      FROM content_runs
      WHERE status IN ('selected', 'generated', 'published')
    `,
  );

  const usedKeys = new Set(rows.map((row) => row.topic_key));
  const available = candidates.filter((item) => !usedKeys.has(item.key));
  const poolToUse = available.length ? available : candidates;
  const chosen = poolToUse[Math.floor(Math.random() * poolToUse.length)];

  await upsertSelection(pool, chosen);
  return {
    ...chosen,
    reused_catalog: !available.length,
  };
}

function selectTopicWithoutDb(candidates) {
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function main() {
  const outputPath = process.argv[2] || "/tmp-output/topic.json";
  const candidates = buildCandidateList();

  let selected;
  let usedDatabase = false;
  let pool;

  try {
    if (hasDatabase()) {
      usedDatabase = true;
      pool = createPool();
      await ensureSchema(pool);
      selected = await selectTopicFromDb(pool, candidates);
    } else {
      selected = selectTopicWithoutDb(candidates);
    }
  } finally {
    if (pool) {
      await pool.end();
    }
  }

  const payload = {
    ...selected,
    cta: process.env.VIDEO_DEFAULT_CTA || "Visita el portfolio o pide una automatizacion a medida",
    duration_seconds: Number(process.env.VIDEO_DEFAULT_DURATION_SECONDS || 15),
    video_style: process.env.VIDEO_DEFAULT_STYLE || "rapido, curioso, directo",
    language: process.env.VIDEO_DEFAULT_LANGUAGE || "es",
    format: "curious-fact-short",
    used_database: usedDatabase,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  log("fact topic selected", {
    outputPath,
    topicKey: payload.key,
    category: payload.category,
    topic: payload.topic,
    usedDatabase,
  });
}

main().catch((error) => {
  fail(error.message);
});
