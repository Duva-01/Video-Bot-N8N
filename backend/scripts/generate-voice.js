require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const { logArtifact, logFailure, logStepEvent, readJsonIfExists, withOptionalPool } = require("./lib/script-observer");

function fail(message) {
  console.error(`[generate-voice][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function writeWavFile(outputPath, pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
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
  header.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
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
  const scriptPath = process.argv[2] || "/tmp/bot-videos/script.json";
  const outputPath = process.argv[3] || "/tmp/bot-videos/narration.wav";

  if (!fs.existsSync(scriptPath)) {
    fail(`Script file not found: ${scriptPath}`);
  }

  const scriptData = readJsonIfExists(scriptPath) || {};
  const text = scriptData.narration;
  const language = scriptData.language || process.env.VIDEO_DEFAULT_LANGUAGE || "es";
  const topicKey = scriptData.topic_key || null;

  if (!text) {
    fail(`Missing narration text in ${scriptPath}`);
  }

  const provider =
    process.env.TTS_PROVIDER ||
    (process.env.CLOUDFLARE_AI_API_TOKEN
      ? "cloudflare"
      : process.env.AZURE_SPEECH_KEY
        ? "azure"
        : process.env.GEMINI_API_KEY
          ? "gemini"
          : "elevenlabs");

  log("voice generation starting", { scriptPath, outputPath, provider });

  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_started",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Generating voice track",
      metadata: { provider },
    });
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  try {
    if (provider === "cloudflare") {
      const apiToken = getRequiredEnv("CLOUDFLARE_AI_API_TOKEN");
      const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
      const model = process.env.CLOUDFLARE_TTS_MODEL || "@cf/myshell-ai/melotts";
      const language = process.env.CLOUDFLARE_TTS_LANG || "es";

      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: text,
          lang: language,
        }),
      });

      if (!response.ok) {
        fail(`Cloudflare Workers AI TTS request failed with status ${response.status}: ${await response.text()}`);
      }

      const contentType = String(response.headers.get("content-type") || "");
      let buffer;

      if (contentType.includes("application/json")) {
        const payload = await response.json();
        const audioBase64 = payload?.result?.audio || payload?.audio || null;
        if (!audioBase64) {
          fail("Cloudflare Workers AI TTS response did not include audio data");
        }
        buffer = Buffer.from(audioBase64, "base64");
      } else {
        buffer = Buffer.from(await response.arrayBuffer());
      }

      fs.writeFileSync(outputPath, buffer);

      await withOptionalPool(async (pool) => {
        await logArtifact(pool, {
          topic_key: topicKey,
          artifact_type: "voice_track",
          label: "Narration audio",
          file_path: outputPath,
          mime_type: "audio/mpeg",
          metadata: { provider, model, language },
        });
        await logStepEvent(pool, {
          topic_key: topicKey,
          event_type: "step_completed",
          stage: "generate_voice",
          source: "generate-voice",
          message: "Voice generated",
          metadata: { provider, model, language, bytes: buffer.length },
        });
      });

      log("voice generation completed", { outputPath, bytes: buffer.length, provider, model, language });
      return;
    }

    if (provider === "azure") {
      const subscriptionKey = getRequiredEnv("AZURE_SPEECH_KEY");
      const region = getRequiredEnv("AZURE_SPEECH_REGION");
      const voiceName = process.env.AZURE_SPEECH_VOICE || "es-ES-ElviraNeural";
      const outputFormat = process.env.AZURE_SPEECH_OUTPUT_FORMAT || "riff-24khz-16bit-mono-pcm";
      const tokenResponse = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": subscriptionKey,
          "Content-Length": "0",
        },
      });

      if (!tokenResponse.ok) {
        fail(`Azure Speech token request failed with status ${tokenResponse.status}: ${await tokenResponse.text()}`);
      }

      const accessToken = await tokenResponse.text();
      const ssml = [
        '<speak version="1.0" xml:lang="es-ES">',
        `  <voice name="${xmlEscape(voiceName)}">`,
        `    ${xmlEscape(text)}`,
        "  </voice>",
        "</speak>",
      ].join("\n");

      const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": outputFormat,
          "User-Agent": "facts-engine-bot",
        },
        body: ssml,
      });

      if (!response.ok) {
        fail(`Azure Speech request failed with status ${response.status}: ${await response.text()}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);

      await withOptionalPool(async (pool) => {
        await logArtifact(pool, {
          topic_key: topicKey,
          artifact_type: "voice_track",
          label: "Narration audio",
          file_path: outputPath,
          mime_type: "audio/wav",
          metadata: { provider, region, voiceName, outputFormat },
        });
        await logStepEvent(pool, {
          topic_key: topicKey,
          event_type: "step_completed",
          stage: "generate_voice",
          source: "generate-voice",
          message: "Voice generated",
          metadata: { provider, region, voiceName, outputFormat, bytes: buffer.length },
        });
      });

      log("voice generation completed", { outputPath, bytes: buffer.length, provider, region, voiceName, outputFormat });
      return;
    }

    if (provider === "gemini") {
      const apiKey = getRequiredEnv("GEMINI_API_KEY");
      const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
      const voiceName = process.env.GEMINI_TTS_VOICE || "Kore";
      const prompt = [`Lee el siguiente texto en ${language}.`, "Usa un tono natural, claro y directo.", text].join("\n");

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
      });

      if (!response.ok) {
        fail(`Gemini TTS request failed with status ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const pcmBuffer = Buffer.from(getGeminiInlineAudio(data), "base64");
      writeWavFile(outputPath, pcmBuffer);

      await withOptionalPool(async (pool) => {
        await logArtifact(pool, {
          topic_key: topicKey,
          artifact_type: "voice_track",
          label: "Narration audio",
          file_path: outputPath,
          mime_type: "audio/wav",
          metadata: { provider, model, voiceName },
        });
        await logStepEvent(pool, {
          topic_key: topicKey,
          event_type: "step_completed",
          stage: "generate_voice",
          source: "generate-voice",
          message: "Voice generated",
          metadata: { provider, model, voiceName, bytes: pcmBuffer.length },
        });
      });

      log("voice generation completed", { outputPath, bytes: pcmBuffer.length, provider, voiceName, model });
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
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      fail(`ElevenLabs request failed with status ${response.status}: ${await response.text()}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);

    await withOptionalPool(async (pool) => {
      await logArtifact(pool, {
        topic_key: topicKey,
        artifact_type: "voice_track",
        label: "Narration audio",
        file_path: outputPath,
        mime_type: "audio/mpeg",
        metadata: { provider, voiceId, modelId },
      });
      await logStepEvent(pool, {
        topic_key: topicKey,
        event_type: "step_completed",
        stage: "generate_voice",
        source: "generate-voice",
        message: "Voice generated",
        metadata: { provider, voiceId, modelId, bytes: buffer.length },
      });
    });

    log("voice generation completed", { outputPath, bytes: buffer.length, provider, voiceId, modelId });
  } catch (error) {
    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "generate_voice",
        source: "generate-voice",
        error: error.message,
        metadata: { provider },
      });
    });
    throw error;
  }
}

main().catch((error) => {
  fail(error.message);
});
