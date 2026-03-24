require("dotenv").config();

const path = require("path");
const { spawn } = require("child_process");
const { logFailure, logStepEvent, readJsonIfExists, withOptionalPool } = require("./lib/script-observer");

function fail(message) {
  console.error(`[run-build-video][error] ${message}`);
  process.exit(1);
}

function relay(stream, target) {
  stream.on("data", (chunk) => {
    target.write(chunk);
  });
}

async function main() {
  const outputPath = process.argv[2] || "/tmp/bot-videos/final.mp4";
  const audioPath = process.argv[3] || "/tmp/bot-videos/narration.wav";
  const clipsDir = process.argv[4] || "/tmp/bot-videos/clips";
  const subtitlePath = process.argv[5] || "/tmp/bot-videos/subtitles.ass";
  const scriptPath = process.argv[6] || path.join(path.dirname(outputPath), "script.json");
  const timeoutMs = Number(process.env.BUILD_VIDEO_TIMEOUT_MS || 420000);
  const scriptData = readJsonIfExists(scriptPath) || {};
  const topicKey = scriptData.topic_key || null;

  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_started",
      stage: "build_video",
      source: "run-build-video",
      message: "Rendering video",
      metadata: {
        outputPath,
        audioPath,
        clipsDir,
        subtitlePath,
        timeoutMs,
      },
    });
  });

  const buildArgs = ["/app/scripts/build-short.sh", outputPath, audioPath, clipsDir, subtitlePath];
  const buildChild = spawn("bash", buildArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  relay(buildChild.stdout, process.stdout);
  relay(buildChild.stderr, process.stderr);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    buildChild.kill("SIGTERM");
  }, timeoutMs);

  const buildExitCode = await new Promise((resolve, reject) => {
    buildChild.on("error", reject);
    buildChild.on("exit", (code) => resolve(code ?? 1));
  });

  clearTimeout(timer);

  if (timedOut) {
    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "build_video",
        source: "run-build-video",
        error: `Build video timed out after ${timeoutMs}ms`,
        metadata: { outputPath, audioPath, clipsDir, subtitlePath },
      });
    });
    fail(`Build video timed out after ${timeoutMs}ms`);
  }

  if (buildExitCode !== 0) {
    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "build_video",
        source: "run-build-video",
        error: `build-short exited with code ${buildExitCode}`,
        metadata: { outputPath, audioPath, clipsDir, subtitlePath },
      });
    });
    fail(`build-short exited with code ${buildExitCode}`);
  }

  const recordArgs = ["/app/scripts/record-build-output.js", outputPath, scriptPath];
  const recordChild = spawn("node", recordArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  relay(recordChild.stdout, process.stdout);
  relay(recordChild.stderr, process.stderr);

  const recordExitCode = await new Promise((resolve, reject) => {
    recordChild.on("error", reject);
    recordChild.on("exit", (code) => resolve(code ?? 1));
  });

  if (recordExitCode !== 0) {
    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "build_video",
        source: "run-build-video",
        error: `record-build-output exited with code ${recordExitCode}`,
        metadata: { outputPath, scriptPath },
      });
    });
    fail(`record-build-output exited with code ${recordExitCode}`);
  }
}

main().catch((error) => {
  fail(error.message);
});
