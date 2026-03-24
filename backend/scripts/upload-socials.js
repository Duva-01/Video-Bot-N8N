require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const { logArtifact, logStepEvent, readJsonIfExists, withOptionalPool } = require("./lib/script-observer");
const { ensureFreshInstagramAccessToken, verifyInstagramAccessToken } = require("./lib/instagram-token");
const { deleteCloudinaryAsset } = require("./lib/cloudinary-utils");
const { ensureCloudinaryFallbackVideo, getManualPublishDir, writeManualPublishFallback } = require("./lib/manual-publish-fallback");
const { uploadToTikTok } = require("./upload-tiktok");

function fail(message) {
  console.error(`[upload-socials][error] ${message}`);
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

function sanitizeHashtags(tagsValue) {
  return String(tagsValue || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) =>
      `#${tag
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "")}`,
    )
    .filter((tag) => tag !== "#");
}

function buildCaption(scriptData, platform) {
  const title = String(scriptData.title || "").trim();
  const description = String(scriptData.description || "").trim();
  const channelUrl =
    process.env[`${platform.toUpperCase()}_CHANNEL_URL`] ||
    process.env.SOCIAL_CHANNEL_URL ||
    process.env.YOUTUBE_CHANNEL_URL ||
    "";
  const platformHashtags = sanitizeHashtags(process.env[`${platform.toUpperCase()}_HASHTAGS`] || "");
  const defaultTags = Array.isArray(scriptData.tags) ? scriptData.tags : [];
  const autoHashtags = sanitizeHashtags(defaultTags.join(","));
  const hashtags = [...new Set([...platformHashtags, ...autoHashtags])].slice(0, 8);
  const instagramFixedCta =
    platform === "instagram" ? String(process.env.INSTAGRAM_FIXED_CTA || "").trim() : "";

  return [title, description, hashtags.join(" "), instagramFixedCta, channelUrl]
    .filter(Boolean)
    .join("\n\n")
    .trim()
    .slice(0, 2200);
}

function buildTikTokTitle(scriptData) {
  const baseTitle = String(scriptData.title || process.env.TIKTOK_DEFAULT_TITLE || "Curious fact").trim();
  const hashtags = sanitizeHashtags(
    (Array.isArray(scriptData.tags) ? scriptData.tags.join(",") : "") || process.env.TIKTOK_HASHTAGS || "",
  );
  return [baseTitle, hashtags.join(" ")].filter(Boolean).join(" ").trim().slice(0, 150);
}

async function logPlatformSuccess(topicKey, platform, resultPath, result) {
  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "upload_socials",
      source: "upload-socials",
      message: `${platform} publish completed`,
      metadata: { platform, ...result },
    });
    await logArtifact(pool, {
      topic_key: topicKey,
      artifact_type: `${platform}_result`,
      label: `${platform} publish result`,
      file_path: resultPath,
      external_url: result.url || null,
      mime_type: "application/json",
      metadata: { platform, ...result },
    });
  });
}

async function logPlatformWarning(topicKey, platform, error) {
  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_warning",
      stage: "upload_socials",
      source: "upload-socials",
      message: `${platform} publish failed`,
      metadata: { platform, error },
    });
  });
}

function isTruthyEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return String(raw).toLowerCase() === "true";
}

function buildInstagramApiUrl(resourcePath, query = {}) {
  const baseUrl = "https://graph.instagram.com";
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";
  const cleanPath = String(resourcePath || "").replace(/^\/+/, "");
  const params = new URLSearchParams(query);
  return params.size ? `${baseUrl}/${apiVersion}/${cleanPath}?${params.toString()}` : `${baseUrl}/${apiVersion}/${cleanPath}`;
}

function shouldRetryInstagramRequest(status, raw) {
  if (status >= 500) {
    return true;
  }

  try {
    const payload = raw ? JSON.parse(raw) : {};
    const error = payload?.error || {};
    return Number(error.code) === 1;
  } catch {
    return false;
  }
}

async function fetchInstagramJson(resourcePath, { method = "GET", query = {}, body, headers = {}, errorPrefix }) {
  const maxAttempts = Number(process.env.INSTAGRAM_REQUEST_MAX_ATTEMPTS || 4);
  const baseDelayMs = Number(process.env.INSTAGRAM_REQUEST_RETRY_DELAY_MS || 1500);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(buildInstagramApiUrl(resourcePath, query), {
      method,
      headers,
      body,
    });
    const raw = await response.text();

    if (response.ok) {
      return raw ? JSON.parse(raw) : {};
    }

    lastError = new Error(`${errorPrefix} failed with status ${response.status}: ${raw}`);
    if (!shouldRetryInstagramRequest(response.status, raw) || attempt === maxAttempts) {
      throw lastError;
    }

    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
  }

  throw lastError || new Error(`${errorPrefix} failed`);
}

async function waitForInstagramContainer(accessToken, creationId) {
  const pollIntervalMs = Number(process.env.INSTAGRAM_CONTAINER_POLL_INTERVAL_MS || 5000);
  const maxAttempts = Number(process.env.INSTAGRAM_CONTAINER_POLL_MAX_ATTEMPTS || 24);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const statusPayload = await fetchInstagramJson(creationId, {
      query: {
        access_token: accessToken,
        fields: "status,status_code",
      },
      errorPrefix: "Instagram container status",
    });
    const statusCode = String(statusPayload.status_code || statusPayload.status || "").toUpperCase();

    if (statusCode === "FINISHED" || statusCode === "PUBLISHED") {
      return statusPayload;
    }

    if (statusCode === "ERROR" || statusCode === "EXPIRED" || statusCode === "FAILED") {
      throw new Error(`Instagram container is not publishable: ${JSON.stringify(statusPayload)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Instagram container was not ready after ${maxAttempts} attempts`);
}

async function uploadToInstagram(videoPath, scriptData, options = {}) {
  const igUserId = getRequiredEnv("INSTAGRAM_IG_USER_ID");
  let accessToken = null;
  let videoUrl = process.env.INSTAGRAM_VIDEO_URL || null;
  let cloudinaryAsset = options.sharedCloudinaryAsset || null;
  const caption = buildCaption(scriptData, "instagram");
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";

  try {
    const tokenInfo = await ensureFreshInstagramAccessToken({
      logger: log,
    });
    accessToken = tokenInfo.accessToken;
    await verifyInstagramAccessToken(accessToken, apiVersion, igUserId);
  } catch (error) {
    if (!String(error.message || "").includes('"code":190')) {
      throw error;
    }

    log("instagram token preflight failed, trying forced refresh", { error: error.message });
    const tokenInfo = await ensureFreshInstagramAccessToken({
      logger: log,
      forceRefresh: true,
    });
    accessToken = tokenInfo.accessToken;
    await verifyInstagramAccessToken(accessToken, apiVersion, igUserId);
  }

  if (!videoUrl) {
    cloudinaryAsset =
      cloudinaryAsset || (await ensureCloudinaryFallbackVideo(videoPath, scriptData, options.logger || log));
    videoUrl = cloudinaryAsset.url;
  }

  if (!videoUrl) {
    throw new Error("Instagram video URL is missing. Provide INSTAGRAM_VIDEO_URL or Cloudinary credentials.");
  }

  const containerPayload = await fetchInstagramJson(`${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: accessToken,
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: "true",
    }).toString(),
    errorPrefix: "Instagram media container",
  });
  const creationId = containerPayload.id;

  if (!creationId) {
    throw new Error(`Instagram media container returned no creation id: ${JSON.stringify(containerPayload)}`);
  }

  await waitForInstagramContainer(accessToken, creationId);

  const publishPayload = await fetchInstagramJson(`${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: accessToken,
      creation_id: creationId,
    }).toString(),
    errorPrefix: "Instagram publish",
  });
  const mediaId = publishPayload.id || null;

  let permalink = null;
  if (mediaId) {
    const infoPayload = await fetchInstagramJson(mediaId, {
      query: {
        access_token: accessToken,
        fields: "permalink",
      },
      errorPrefix: "Instagram media info",
    });
    permalink = infoPayload.permalink || null;
  }

  return {
    creationId,
    cloudinaryPublicId: cloudinaryAsset?.publicId || null,
    cloudinaryUrl: cloudinaryAsset?.url || videoUrl,
    mediaId,
    url: permalink,
  };
}

function isEnabled(name) {
  return String(process.env[name] || "false").toLowerCase() === "true";
}

async function main() {
  const videoPath = process.argv[2];
  const scriptPath = process.argv[3] || "/tmp/bot-videos/script.json";
  const youtubeResultPath = process.argv[4] || "/tmp/bot-videos/youtube-result.json";
  const resultPath = process.argv[5] || "/tmp/bot-videos/social-result.json";

  if (!videoPath) {
    fail("Usage: node /app/scripts/upload-socials.js <videoPath> [scriptPath] [youtubeResultPath] [resultPath]");
  }

  const resolvedVideoPath = path.resolve(videoPath);
  if (!fs.existsSync(resolvedVideoPath)) {
    fail(`Video file not found: ${resolvedVideoPath}`);
  }

  const scriptData = readJsonIfExists(scriptPath) || {};
  const youtubeResult = readJsonIfExists(youtubeResultPath) || {};
  const topicKey = scriptData.topic_key || null;
  let sharedCloudinaryAsset = null;

  const results = {
    channelUrl:
      process.env.SOCIAL_CHANNEL_URL ||
      process.env.YOUTUBE_CHANNEL_URL ||
      null,
    youtube: {
      status: youtubeResult.status || (youtubeResult.videoId ? "published" : "unknown"),
      url: youtubeResult.url || null,
      privacyStatus: youtubeResult.privacyStatus || null,
      error: youtubeResult.error || null,
      manualFallback: youtubeResult.manualFallback || null,
    },
    instagram: { enabled: isEnabled("INSTAGRAM_PUBLISH_ENABLED"), status: "skipped" },
    tiktok: { enabled: isEnabled("TIKTOK_PUBLISH_ENABLED"), status: "skipped" },
  };

  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_started",
      stage: "upload_socials",
      source: "upload-socials",
      message: "Publishing to social platforms",
      metadata: {
        instagramEnabled: results.instagram.enabled,
        tiktokEnabled: results.tiktok.enabled,
      },
    });
  });

  if (!results.instagram.enabled) {
    results.instagram.reason = "disabled";
  } else {
    try {
      const instagramResult = await uploadToInstagram(resolvedVideoPath, scriptData, {
        sharedCloudinaryAsset,
        logger: log,
      });
      if (instagramResult.cloudinaryPublicId && instagramResult.cloudinaryUrl) {
        sharedCloudinaryAsset = {
          publicId: instagramResult.cloudinaryPublicId,
          resourceType: "video",
          url: instagramResult.cloudinaryUrl,
        };
      }
      results.instagram = {
        enabled: true,
        status: "published",
        ...instagramResult,
      };

      fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
      await logPlatformSuccess(topicKey, "instagram", resultPath, results.instagram);
      log("instagram publish completed", results.instagram);
    } catch (error) {
      const manualFallback = await writeManualPublishFallback({
        videoPath: resolvedVideoPath,
        scriptData,
        platform: "instagram",
        title: scriptData.title,
        description: scriptData.description,
        caption: buildCaption(scriptData, "instagram"),
        error: error.message,
        logger: log,
        metadata: {
          youtubeUrl: youtubeResult.url || null,
        },
      });
      if (manualFallback.cloudinaryPublicId && manualFallback.videoUrl) {
        sharedCloudinaryAsset = {
          publicId: manualFallback.cloudinaryPublicId,
          resourceType: "video",
          url: manualFallback.videoUrl,
        };
      }
      results.instagram = {
        enabled: true,
        status: "failed",
        error: error.message,
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
      await logPlatformWarning(topicKey, "instagram", error.message);
      log("instagram publish failed", { error: error.message });
    }
  }

  if (!results.tiktok.enabled) {
    results.tiktok.reason = "disabled";
  } else {
    try {
      const tiktokResult = await uploadToTikTok(resolvedVideoPath, {
        ...scriptData,
        title: buildTikTokTitle(scriptData),
      }, {
        logger: log,
      });

      if (tiktokResult?.skipped) {
        results.tiktok = {
          enabled: true,
          status: "skipped",
          reason: tiktokResult.reason || "missing_access_token",
        };
      } else {
        results.tiktok = {
          enabled: true,
          status: "published",
          ...tiktokResult,
        };
        fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
        await logPlatformSuccess(topicKey, "tiktok", resultPath, results.tiktok);
        log("tiktok publish completed", results.tiktok);
      }
    } catch (error) {
      const publishResult = error.publishResult || {};
      const manualFallback = await writeManualPublishFallback({
        videoPath: resolvedVideoPath,
        scriptData,
        platform: "tiktok",
        title: buildTikTokTitle(scriptData),
        description: scriptData.description,
        caption: buildTikTokTitle(scriptData),
        error: error.message,
        logger: log,
        metadata: {
          privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
          publishResult,
        },
      });
      if (manualFallback.cloudinaryPublicId && manualFallback.videoUrl) {
        sharedCloudinaryAsset = {
          publicId: manualFallback.cloudinaryPublicId,
          resourceType: "video",
          url: manualFallback.videoUrl,
        };
      }
      results.tiktok = {
        enabled: true,
        status: "failed",
        error: error.message,
        raw: publishResult.raw || null,
        publish_id: publishResult.publish_id || null,
        creatorInfo: publishResult.creatorInfo || null,
        privacyLevel: publishResult.privacyLevel || process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
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
      await logPlatformWarning(topicKey, "tiktok", error.message);
      log("tiktok publish failed", { error: error.message });
    }
  }

  const shouldPreserveCloudinaryAsset =
    results.youtube.status === "failed" ||
    results.instagram.status === "failed" ||
    results.tiktok.status === "failed";

  if (
    sharedCloudinaryAsset?.publicId &&
    !shouldPreserveCloudinaryAsset &&
    isTruthyEnv("CLOUDINARY_DELETE_AFTER_INSTAGRAM", true)
  ) {
    await deleteCloudinaryAsset(sharedCloudinaryAsset.publicId, sharedCloudinaryAsset.resourceType || "video");
    try {
      const statePath = path.join(getManualPublishDir(resolvedVideoPath), "cloudinary-video.json");
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }
    } catch {
      // Ignore local cleanup failures.
    }
  }

  fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));

  await withOptionalPool(async (pool) => {
    await logArtifact(pool, {
      topic_key: topicKey,
      artifact_type: "social_publish_result",
      label: "Social publish result",
      file_path: resultPath,
      mime_type: "application/json",
      metadata: results,
    });
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_completed",
      stage: "upload_socials",
      source: "upload-socials",
      message: "Social publishing stage finished",
      metadata: results,
    });
  });

  log("social publishing stage finished", {
    instagram: results.instagram.status,
    tiktok: results.tiktok.status,
  });
}

main().catch((error) => {
  fail(error.message);
});
