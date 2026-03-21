require("dotenv").config();

const { createPool, ensureSchema, hasDatabase, markPublished } = require("./lib/content-db");
const { logArtifact, logFailure, logStepEvent, readJsonIfExists } = require("./lib/script-observer");

function fail(message) {
  console.error(`[finalize-content][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

async function main() {
  if (!hasDatabase()) {
    log("database not configured, skipping finalize");
    return;
  }

  const scriptPath = process.argv[2] || "/tmp/bot-videos/script.json";
  const youtubeResultPath = process.argv[3] || "/tmp/bot-videos/youtube-result.json";
  const scriptData = readJsonIfExists(scriptPath);
  if (!scriptData?.topic_key) {
    log("topic_key missing, skipping finalize");
    return;
  }

  const youtubeResult = readJsonIfExists(youtubeResultPath) || {};
  const pool = createPool();

  try {
    await ensureSchema(pool);
    await markPublished(pool, {
      topic_key: scriptData.topic_key,
      title: scriptData.title,
      description: scriptData.description,
      youtube_video_id: youtubeResult.videoId,
      youtube_url: youtubeResult.url,
      metadata: {
        category: scriptData.category,
        topic: scriptData.topic,
        search_query: scriptData.search_query,
      },
    });

    await logStepEvent(pool, {
      topic_key: scriptData.topic_key,
      event_type: "pipeline_completed",
      stage: "finalize_content",
      source: "finalize-content",
      message: "Content finalized in database",
      metadata: {
        youtube_video_id: youtubeResult.videoId || null,
        youtube_url: youtubeResult.url || null,
      },
    });

    await logArtifact(pool, {
      topic_key: scriptData.topic_key,
      artifact_type: "publication_record",
      label: "Published YouTube record",
      external_url: youtubeResult.url || null,
      mime_type: "application/json",
      metadata: {
        youtube_video_id: youtubeResult.videoId || null,
        title: scriptData.title,
      },
    });
  } catch (error) {
    try {
      await logFailure(pool, {
        topic_key: scriptData.topic_key,
        stage: "finalize_content",
        source: "finalize-content",
        error: error.message,
      });
    } catch (innerError) {
      log("finalize failure logging error", { error: innerError.message });
    }
    throw error;
  } finally {
    await pool.end();
  }

  log("content finalized in database", {
    topicKey: scriptData.topic_key,
    youtubeVideoId: youtubeResult.videoId || null,
  });
}

main().catch((error) => {
  fail(error.message);
});
