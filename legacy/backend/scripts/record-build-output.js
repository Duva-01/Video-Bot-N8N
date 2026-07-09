require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { logArtifact, logFailure, logStepEvent, readJsonIfExists, withOptionalPool } = require("./lib/script-observer");

function fail(message) {
  console.error(`[record-build-output][error] ${message}`);
  process.exit(1);
}

async function main() {
  const outputPath = process.argv[2] || "/tmp/bot-videos/final.mp4";
  const scriptPath = process.argv[3] || path.join(path.dirname(outputPath), "script.json");
  const scriptData = readJsonIfExists(scriptPath) || {};
  const topicKey = scriptData.topic_key || null;

  if (!fs.existsSync(outputPath)) {
    fail(`Video file not found: ${outputPath}`);
  }

  await withOptionalPool(async (pool) => {
    await logArtifact(pool, {
      topic_key: topicKey,
      artifact_type: "final_video",
      label: "Final rendered short",
      file_path: outputPath,
      mime_type: "video/mp4",
      metadata: {
        category: scriptData.category || null,
        title: scriptData.title || null,
      },
    });

    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "build_video",
      source: "record-build-output",
      message: "Video rendered",
      metadata: {
        outputPath,
      },
    });
  });
}

main().catch(async (error) => {
  const scriptPath = process.argv[3] || path.join(path.dirname(process.argv[2] || "/tmp/bot-videos/final.mp4"), "script.json");
  const scriptData = readJsonIfExists(scriptPath) || {};
  await withOptionalPool(async (pool) => {
    await logFailure(pool, {
      topic_key: scriptData.topic_key || null,
      stage: "build_video",
      source: "record-build-output",
      error: error.message,
    });
  });
  fail(error.message);
});
