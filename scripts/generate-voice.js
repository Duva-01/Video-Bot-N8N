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

function writeWavFile(outputPath, pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  fs.writeFileSync(outputPath, Buffer.concat([header, pcmBuffer]));
}

function getGeminiInlineAudio(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const inlineData = parts.find((part) => part.inlineData?.data)?.inlineData;

  if (!inlineData?.data) {
    fail("Gemini TTS response did not include inline audio data");
  }

  return inlineData.data;
}

async function main() {
  const scriptPath = process.argv[2] || "/tmp-output/script.json";
  const outputPath = process.argv[3] || "/tmp-output/narration.wav";

  if (!fs.existsSync(scriptPath)) {
    fail(`Script file not found: ${scriptPath}`);
  }

  const scriptData = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  const text = scriptData.narration;
  const language = scriptData.language || process.env.VIDEO_DEFAULT_LANGUAGE || "es";

  if (!text) {
    fail(`Missing narration text in ${scriptPath}`);
  }

  const provider = process.env.TTS_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "elevenlabs");

  log("voice generation starting", {
    scriptPath,
    outputPath,
    provider,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (provider === "gemini") {
    const apiKey = getRequiredEnv("GEMINI_API_KEY");
    const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
    const voiceName = process.env.GEMINI_TTS_VOICE || "Kore";
    const prompt = [
      `Lee el siguiente texto en ${language}.`,
      "Usa un tono natural, claro y directo, apto para un video corto de tecnologia.",
      text,
    ].join("\n");

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      fail(`Gemini TTS request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const audioBase64 = getGeminiInlineAudio(data);
    const pcmBuffer = Buffer.from(audioBase64, "base64");
    writeWavFile(outputPath, pcmBuffer);

    log("voice generation completed", {
      outputPath,
      bytes: pcmBuffer.length,
      provider,
      voiceName,
      model,
    });

    return;
  }

  const apiKey = getRequiredEnv("ELEVENLABS_API_KEY");
  const voiceId = getRequiredEnv("ELEVENLABS_VOICE_ID");
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
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
  fs.writeFileSync(outputPath, buffer);

  log("voice generation completed", {
    outputPath,
    bytes: buffer.length,
    provider,
    voiceId,
    modelId,
  });
}

main().catch((error) => {
  fail(error.message);
});
