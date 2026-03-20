require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function fail(message) {
  console.error(`[generate-subtitles][error] ${message}`);
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

function toSrtTime(seconds) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const hours = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const secs = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${hours}:${minutes}:${secs},${millis}`;
}

function getAudioDuration(audioPath) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ],
    { encoding: "utf8" },
  );

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

  const scriptData = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  const narration = scriptData.narration;

  if (!narration) {
    fail(`Missing narration text in ${scriptPath}`);
  }

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

  log("subtitles generated", {
    outputPath,
    entries: chunks.length,
    totalDuration,
  });
}

main().catch((error) => {
  fail(error.message);
});

