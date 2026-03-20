require("dotenv").config();

const fs = require("fs");
const path = require("path");

function fail(message) {
  console.error(`[generate-voice][error] ${message}`);
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

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const scriptPath = process.argv[2] || "/tmp-output/script.json";
  const outputPath = process.argv[3] || "/tmp-output/narration.mp3";

  if (!fs.existsSync(scriptPath)) {
    fail(`Script file not found: ${scriptPath}`);
  }

  const scriptData = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  const text = scriptData.narration;

  if (!text) {
    fail(`Missing narration text in ${scriptPath}`);
  }

  const apiKey = getRequiredEnv("ELEVENLABS_API_KEY");
  const voiceId = getRequiredEnv("ELEVENLABS_VOICE_ID");
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

  log("elevenlabs voice generation starting", {
    scriptPath,
    outputPath,
    voiceId,
    modelId,
  });

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    fail(`ElevenLabs request failed with status ${response.status}: ${await response.text()}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  log("elevenlabs voice generation completed", {
    outputPath,
    bytes: buffer.length,
  });
}

main().catch((error) => {
  fail(error.message);
});
