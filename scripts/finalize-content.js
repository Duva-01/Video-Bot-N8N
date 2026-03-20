require("dotenv").config();

const fs = require("fs");
const { createPool, ensureSchema, hasDatabase, markPublished } = require("./lib/content-db");

function fail(message) {
  console.error(`[finalize-content][error] ${message}`);
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

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  if (!hasDatabase()) {
    log("database not configured, skipping finalize");
    return;
  }

  const scriptPath = process.argv[2] || "/tmp-output/script.json";
  const youtubeResultPath = process.argv[3] || "/tmp-output/youtube-result.json";
  const tiktokResultPath = process.argv[4] || "/tmp-output/tiktok-result.json";

  const scriptData = readJsonIfExists(scriptPath);
  if (!scriptData?.topic_key) {
    log("topic_key missing, skipping finalize");
    return;
  }

  const youtubeResult = readJsonIfExists(youtubeResultPath) || {};
  const tiktokResult = readJsonIfExists(tiktokResultPath) || {};

  const pool = createPool();

  try {
    await ensureSchema(pool);
    await markPublished(pool, {
      topic_key: scriptData.topic_key,
      title: scriptData.title,
      description: scriptData.description,
      youtube_video_id: youtubeResult.videoId,
      youtube_url: youtubeResult.url,
      tiktok_publish_id: tiktokResult.publish_id,
      tiktok_status: tiktokResult.status,
      metadata: {
        category: scriptData.category,
        topic: scriptData.topic,
        search_query: scriptData.search_query,
      },
    });
  } finally {
    await pool.end();
  }

  log("content finalized in database", {
    topicKey: scriptData.topic_key,
    youtubeVideoId: youtubeResult.videoId || null,
    tiktokPublishId: tiktokResult.publish_id || null,
  });
}

main().catch((error) => {
  fail(error.message);
});
