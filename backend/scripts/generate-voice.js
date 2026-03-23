require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
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
    throw new Error("Gemini TTS response did not include inline audio data");
  }

  return inlineData.data;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status}: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function runCommandWithInput(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status}: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

async function runCloudflareTts({ text, topicKey, outputPath }) {
  const apiToken = requiredEnv("CLOUDFLARE_AI_API_TOKEN");
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const model = process.env.CLOUDFLARE_TTS_MODEL || "@cf/deepgram/aura-2-es";
  const language = process.env.CLOUDFLARE_TTS_LANG || "es";
  const speaker = process.env.CLOUDFLARE_TTS_SPEAKER || "aquila";
  const isAuraModel = model.startsWith("@cf/deepgram/aura");
  const requestBody = isAuraModel
    ? {
        text,
        speaker,
        encoding: "mp3",
      }
    : {
        prompt: text,
        lang: language,
      };

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Cloudflare Workers AI TTS request failed with status ${response.status}: ${await response.text()}`);
  }

  const contentType = String(response.headers.get("content-type") || "");
  let buffer;

  if (contentType.includes("application/json")) {
    const payload = await response.json();
    const audioBase64 = payload?.result?.audio || payload?.audio || null;
    if (!audioBase64) {
      throw new Error("Cloudflare Workers AI TTS response did not include audio data");
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
      metadata: { provider: "cloudflare", model, language, speaker: isAuraModel ? speaker : null },
    });
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Voice generated",
      metadata: {
        provider: "cloudflare",
        model,
        language,
        speaker: isAuraModel ? speaker : null,
        bytes: buffer.length,
      },
    });
  });

  log("voice generation completed", {
    outputPath,
    bytes: buffer.length,
    provider: "cloudflare",
    model,
    language,
    speaker: isAuraModel ? speaker : null,
  });
}

async function runEspeakTts({ text, topicKey, outputPath, language }) {
  const voiceName = process.env.ESPEAK_VOICE || language || "es";
  const rate = process.env.ESPEAK_RATE || "165";
  const pitch = process.env.ESPEAK_PITCH || "55";

  runCommand("espeak-ng", ["-v", voiceName, "-s", String(rate), "-p", String(pitch), "-w", outputPath, text]);

  const stats = fs.statSync(outputPath);

  await withOptionalPool(async (pool) => {
    await logArtifact(pool, {
      topic_key: topicKey,
      artifact_type: "voice_track",
      label: "Narration audio",
      file_path: outputPath,
      mime_type: "audio/wav",
      metadata: { provider: "espeak", voiceName, rate: Number(rate), pitch: Number(pitch) },
    });
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Voice generated",
      metadata: {
        provider: "espeak",
        voiceName,
        rate: Number(rate),
        pitch: Number(pitch),
        bytes: stats.size,
      },
    });
  });

  log("voice generation completed", {
    outputPath,
    bytes: stats.size,
    provider: "espeak",
    voiceName,
    rate: Number(rate),
    pitch: Number(pitch),
  });
}

async function runPiperTts({ text, topicKey, outputPath }) {
  const voiceName = process.env.PIPER_VOICE || "es_ES-carlfm-x_low";
  const dataDir = process.env.PIPER_DATA_DIR || "/app/voices";
  const modelPath = process.env.PIPER_MODEL_PATH || path.join(dataDir, `${voiceName}.onnx`);
  const configPath = process.env.PIPER_CONFIG_PATH || `${modelPath}.json`;

  runCommandWithInput("piper", [
    "--model",
    modelPath,
    "--config",
    configPath,
    "--espeak_data",
    "/usr/share/piper/espeak-ng-data",
    "--output_file",
    outputPath,
  ], text);

  const stats = fs.statSync(outputPath);

  await withOptionalPool(async (pool) => {
    await logArtifact(pool, {
      topic_key: topicKey,
      artifact_type: "voice_track",
      label: "Narration audio",
      file_path: outputPath,
      mime_type: "audio/wav",
      metadata: { provider: "piper", voiceName, dataDir, modelPath, configPath },
    });
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Voice generated",
      metadata: { provider: "piper", voiceName, dataDir, modelPath, configPath, bytes: stats.size },
    });
  });

  log("voice generation completed", {
    outputPath,
    bytes: stats.size,
    provider: "piper",
    voiceName,
    dataDir,
    modelPath,
    configPath,
  });
}

async function runAzureTts({ text, topicKey, outputPath }) {
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
    throw new Error(`Azure Speech token request failed with status ${tokenResponse.status}: ${await tokenResponse.text()}`);
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
    throw new Error(`Azure Speech request failed with status ${response.status}: ${await response.text()}`);
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
      metadata: { provider: "azure", region, voiceName, outputFormat },
    });
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Voice generated",
      metadata: { provider: "azure", region, voiceName, outputFormat, bytes: buffer.length },
    });
  });

  log("voice generation completed", { outputPath, bytes: buffer.length, provider: "azure", region, voiceName, outputFormat });
}

async function runGeminiTts({ text, topicKey, outputPath, language }) {
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
    throw new Error(`Gemini TTS request failed with status ${response.status}: ${await response.text()}`);
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
      metadata: { provider: "gemini", model, voiceName },
    });
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Voice generated",
      metadata: { provider: "gemini", model, voiceName, bytes: pcmBuffer.length },
    });
  });

  log("voice generation completed", { outputPath, bytes: pcmBuffer.length, provider: "gemini", voiceName, model });
}

async function runElevenLabsTts({ text, topicKey, outputPath }) {
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
    throw new Error(`ElevenLabs request failed with status ${response.status}: ${await response.text()}`);
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
      metadata: { provider: "elevenlabs", voiceId, modelId },
    });
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Voice generated",
      metadata: { provider: "elevenlabs", voiceId, modelId, bytes: buffer.length },
    });
  });

  log("voice generation completed", { outputPath, bytes: buffer.length, provider: "elevenlabs", voiceId, modelId });
}

function normalizeProviderName(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (!value) {
    return "";
  }

  if (value === "espeak-ng") {
    return "espeak";
  }

  return value;
}

function getDefaultProvider() {
  return (
    process.env.TTS_PROVIDER ||
    (process.env.GEMINI_API_KEY
      ? "gemini"
      : process.env.CLOUDFLARE_AI_API_TOKEN
        ? "cloudflare"
        : process.env.AZURE_SPEECH_KEY
          ? "azure"
          : "elevenlabs")
  );
}

function resolveProviderChain() {
  const explicitChain = String(process.env.TTS_PROVIDER_CHAIN || "")
    .split(",")
    .map((item) => normalizeProviderName(item))
    .filter(Boolean);

  if (explicitChain.length > 0) {
    return [...new Set(explicitChain)];
  }

  const primaryProvider = normalizeProviderName(getDefaultProvider());
  const fallbackEnabled = (process.env.TTS_FALLBACK_ENABLED || "true") === "true";
  const fallbackProvider = normalizeProviderName(process.env.TTS_FALLBACK_PROVIDER || "piper");
  const providers = [primaryProvider];

  if (fallbackEnabled && fallbackProvider) {
    providers.push(fallbackProvider);
  }

  return [...new Set(providers.filter(Boolean))];
}

async function runProvider(provider, context) {
  if (provider === "cloudflare") {
    await runCloudflareTts(context);
    return;
  }

  if (provider === "azure") {
    await runAzureTts(context);
    return;
  }

  if (provider === "gemini") {
    await runGeminiTts(context);
    return;
  }

  if (provider === "espeak") {
    await runEspeakTts(context);
    return;
  }

  if (provider === "piper") {
    await runPiperTts(context);
    return;
  }

  if (provider === "elevenlabs") {
    await runElevenLabsTts(context);
    return;
  }

  throw new Error(`Unsupported TTS provider: ${provider}`);
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

  const providerChain = resolveProviderChain();
  const primaryProvider = providerChain[0] || getDefaultProvider();

  log("voice generation starting", { scriptPath, outputPath, provider: primaryProvider, providerChain });

  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_started",
      stage: "generate_voice",
      source: "generate-voice",
      message: "Generating voice track",
      metadata: { provider: primaryProvider, providerChain },
    });
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  try {
    const executionContext = { text, topicKey, outputPath, language };
    const errors = [];

    for (const provider of providerChain) {
      try {
        await runProvider(provider, executionContext);
        return;
      } catch (error) {
        errors.push({ provider, error: error.message });

        if (provider !== providerChain[providerChain.length - 1]) {
          log("tts provider failed, trying next provider", {
            provider,
            nextProvider: providerChain[providerChain.indexOf(provider) + 1],
            error: error.message,
          });

          await withOptionalPool(async (pool) => {
            await logStepEvent(pool, {
              topic_key: topicKey,
              event_type: "step_warning",
              stage: "generate_voice",
              source: "generate-voice",
              message: "TTS provider failed, trying next provider",
              metadata: {
                provider,
                nextProvider: providerChain[providerChain.indexOf(provider) + 1],
                error: error.message,
              },
            });
          });
          continue;
        }
      }
    }

    throw new Error(`All TTS providers failed: ${errors.map((item) => `${item.provider}: ${item.error}`).join(" | ")}`);
  } catch (error) {
    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "generate_voice",
        source: "generate-voice",
        error: error.message,
        metadata: { provider: primaryProvider, providerChain },
      });
    });
    throw error;
  }
}

main().catch((error) => {
  fail(error.message);
});
