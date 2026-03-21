require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { logArtifact, logFailure, logStepEvent, readJsonIfExists, withOptionalPool } = require("./lib/script-observer");

function fail(message) {
  console.error(`[generate-subtitles][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

function toSrtTime(seconds) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const hours = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const secs = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${hours}:${minutes}:${secs},${millis}`;
}

function getAudioDuration(audioPath) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath], {
    encoding: "utf8",
  });

  if (result.status === 0) {
    const parsed = Number(result.stdout.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function splitNarration(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > 70 && current) {
      chunks.push(current);
      current = sentence;
      continue;
    }
    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [cleaned];
}

async function main() {
  const scriptPath = process.argv[2] || "/tmp/bot-videos/script.json";
  const audioPath = process.argv[3] || "/tmp/bot-videos/narration.wav";
  const outputPath = process.argv[4] || "/tmp/bot-videos/subtitles.srt";

  if (!fs.existsSync(scriptPath)) {
    fail(`Script file not found: ${scriptPath}`);
  }

  const scriptData = readJsonIfExists(scriptPath) || {};
  const narration = scriptData.narration;
  const topicKey = scriptData.topic_key || null;

  if (!narration) {
    fail(`Missing narration text in ${scriptPath}`);
  }

  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_started",
      stage: "generate_subtitles",
      source: "generate-subtitles",
      message: "Generating subtitles",
      metadata: { scriptPath, audioPath },
    });
  });

  try {
    const chunks = splitNarration(narration);
    const totalWords = narration.split(/\s+/).filter(Boolean).length || 1;
    const totalDuration = getAudioDuration(audioPath) || Math.max(8, totalWords / 2.5);

    let elapsed = 0;
    const lines = [];

    chunks.forEach((chunk, index) => {
      const chunkWords = chunk.split(/\s+/).filter(Boolean).length || 1;
      const duration = (chunkWords / totalWords) * totalDuration;
      const start = elapsed;
      const end = index === chunks.length - 1 ? totalDuration : elapsed + duration;

      lines.push(String(index + 1));
      lines.push(`${toSrtTime(start)} --> ${toSrtTime(end)}`);
      lines.push(chunk);
      lines.push("");
      elapsed = end;
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, lines.join("\n"), "utf8");

    await withOptionalPool(async (pool) => {
      await logArtifact(pool, {
        topic_key: topicKey,
        artifact_type: "subtitles_srt",
        label: "Subtitles file",
        file_path: outputPath,
        mime_type: "application/x-subrip",
        metadata: { entries: chunks.length, totalDuration },
      });
      await logStepEvent(pool, {
        topic_key: topicKey,
        event_type: "step_completed",
        stage: "generate_subtitles",
        source: "generate-subtitles",
        message: "Subtitles generated",
        metadata: { entries: chunks.length, totalDuration },
      });
    });

    log("subtitles generated", { outputPath, entries: chunks.length, totalDuration });
  } catch (error) {
    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "generate_subtitles",
        source: "generate-subtitles",
        error: error.message,
        metadata: { scriptPath, audioPath },
      });
    });
    throw error;
  }
}

main().catch((error) => {
  fail(error.message);
});
