require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { logArtifact, logFailure, logStepEvent, readJsonIfExists, withOptionalPool } = require("./lib/script-observer");
const { writeManualPublishFallback } = require("./lib/manual-publish-fallback");

function fail(message) {
  console.error(`[youtube-upload][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sanitizeTags(tagsValue) {
  return tagsValue
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 15);
}

function toHashtag(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join("");

  if (!normalized) {
    return null;
  }

  return `#${normalized.slice(0, 30)}`;
}

function buildHashtagBlock(scriptData, tags) {
  const configured = sanitizeTags(process.env.YOUTUBE_DEFAULT_HASHTAGS || "");
  const candidates = [
    "shorts",
    ...(Array.isArray(tags) ? tags : []),
    ...configured,
    scriptData.topic || "",
    scriptData.category || "",
  ];

  const seen = new Set();
  const hashtags = [];

  for (const candidate of candidates) {
    const hashtag = toHashtag(candidate);
    if (!hashtag) {
      continue;
    }

    const key = hashtag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    hashtags.push(hashtag);

    if (hashtags.length >= 5) {
      break;
    }
  }

  return hashtags.join(" ");
}

async function main() {
  const videoPath = process.argv[2];
  const scriptPath = process.argv[3] || "/tmp/bot-videos/script.json";
  const resultPath = process.argv[4] || "/tmp/bot-videos/youtube-result.json";

  if (!videoPath) {
    fail("Usage: node /app/scripts/upload-youtube.js <videoPath> [scriptPath] [resultPath]");
  }

  const resolvedVideoPath = path.resolve(videoPath);
  if (!fs.existsSync(resolvedVideoPath)) {
    fail(`Video file not found: ${resolvedVideoPath}`);
  }

  const scriptData = readJsonIfExists(scriptPath) || {};
  const topicKey = scriptData.topic_key || null;
  const defaultTitle = scriptData.title || process.env.YOUTUBE_DEFAULT_TITLE || `Short IA ${new Date().toISOString().slice(0, 10)}`;
  const defaultDescription = scriptData.description || process.env.YOUTUBE_DEFAULT_DESCRIPTION || "Video generado automaticamente con n8n.";
  const defaultTags = (scriptData.tags || []).join(",") || process.env.YOUTUBE_DEFAULT_TAGS || "ia,automatizacion,shorts";
  const privacyStatus = process.env.YOUTUBE_PRIVACY_STATUS || "private";
  const categoryId = process.env.YOUTUBE_CATEGORY_ID || "28";
  const title = defaultTitle.slice(0, 100);
  const tags = sanitizeTags(defaultTags);
  const hashtagBlock = buildHashtagBlock(scriptData, tags);
  const description = [defaultDescription.trim(), hashtagBlock].filter(Boolean).join("\n\n").slice(0, 5000);

  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_started",
      stage: "youtube_upload",
      source: "upload-youtube",
      message: "Uploading video to YouTube",
      metadata: { platform: "youtube", status: "started", title, privacyStatus, categoryId },
    });
  });

  try {
    const clientId = getRequiredEnv("YOUTUBE_CLIENT_ID");
    const clientSecret = getRequiredEnv("YOUTUBE_CLIENT_SECRET");
    const refreshToken = getRequiredEnv("YOUTUBE_REFRESH_TOKEN");
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    const youtube = google.youtube({ version: "v3", auth });

    log("youtube upload starting", { videoPath: resolvedVideoPath, title, privacyStatus });

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      notifySubscribers: false,
      requestBody: {
        snippet: { title, description, tags, categoryId },
        status: { privacyStatus, selfDeclaredMadeForKids: false },
      },
      media: { body: fs.createReadStream(resolvedVideoPath) },
    });

    const videoId = response.data.id;
    const result = {
      videoId,
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      privacyStatus,
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));

    await withOptionalPool(async (pool) => {
      await logArtifact(pool, {
        topic_key: topicKey,
        artifact_type: "youtube_result",
        label: "YouTube upload result",
        file_path: resultPath,
        external_url: result.url,
        mime_type: "application/json",
        metadata: { videoId, privacyStatus },
      });
      await logStepEvent(pool, {
        topic_key: topicKey,
        event_type: "step_completed",
        stage: "youtube_upload",
        source: "upload-youtube",
        message: "Video uploaded to YouTube",
        metadata: { platform: "youtube", status: "published", videoId, url: result.url, privacyStatus },
      });
    });

    log("youtube upload completed", result);
  } catch (error) {
    const manualFallback = await writeManualPublishFallback({
      videoPath: resolvedVideoPath,
      scriptData,
      platform: "youtube",
      title,
      description,
      error: error.message,
      logger: log,
      metadata: {
        privacyStatus,
        categoryId,
        tags,
      },
    });
    const failedResult = {
      status: "failed",
      error: error.message,
      videoId: null,
      url: null,
      privacyStatus,
      manualFallback: {
        dir: manualFallback.dir,
        txtPath: manualFallback.txtPath,
        jsonPath: manualFallback.jsonPath,
        txtUrl: manualFallback.txtUrl,
        jsonUrl: manualFallback.jsonUrl,
        videoUrl: manualFallback.videoUrl,
        localVideoPath: manualFallback.localVideoPath,
      },
    };
    fs.writeFileSync(resultPath, JSON.stringify(failedResult, null, 2));

    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "youtube_upload",
        source: "upload-youtube",
        error: error.message,
        metadata: { title, privacyStatus },
      });
      await logArtifact(pool, {
        topic_key: topicKey,
        artifact_type: "youtube_manual_publish_fallback",
        label: "YouTube manual publish fallback",
        file_path: manualFallback.txtPath,
        external_url: manualFallback.videoUrl || null,
        mime_type: "text/plain",
        metadata: failedResult,
      });
      await logStepEvent(pool, {
        topic_key: topicKey,
        event_type: "step_warning",
        stage: "youtube_upload",
        source: "upload-youtube",
        message: "YouTube upload failed, manual fallback prepared",
        metadata: { platform: "youtube", ...failedResult },
      });
    });

    log("youtube upload failed, manual fallback prepared", failedResult);
  }
}

main().catch((error) => {
  fail(error.message);
});
