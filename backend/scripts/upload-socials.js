require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const { logArtifact, logStepEvent, readJsonIfExists, withOptionalPool } = require("./lib/script-observer");

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

function buildMultipartBody(fields, fileField) {
  const boundary = `----factsengine${crypto.randomBytes(8).toString("hex")}`;
  const chunks = [];

  for (const [name, value] of Object.entries(fields || {})) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
    chunks.push(Buffer.from(String(value)));
    chunks.push(Buffer.from("\r\n"));
  }

  if (fileField) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n`),
    );
    chunks.push(Buffer.from(`Content-Type: ${fileField.contentType || "application/octet-stream"}\r\n\r\n`));
    chunks.push(fileField.data);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    boundary,
    buffer: Buffer.concat(chunks),
  };
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

function buildCloudinarySignature(params, apiSecret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

function isTruthyEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return String(raw).toLowerCase() === "true";
}

async function uploadVideoToCloudinary(videoPath, topicKey) {
  const cloudName = getRequiredEnv("CLOUDINARY_CLOUD_NAME");
  const apiKey = getRequiredEnv("CLOUDINARY_API_KEY");
  const apiSecret = getRequiredEnv("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = String(topicKey || `short-${Date.now()}`)
    .trim()
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const paramsToSign = {
    folder: process.env.CLOUDINARY_FOLDER || "bot-videos",
    public_id: publicId || `short-${timestamp}`,
    timestamp,
  };
  const signature = buildCloudinarySignature(paramsToSign, apiSecret);
  const multipart = buildMultipartBody(
    {
      api_key: apiKey,
      folder: paramsToSign.folder,
      public_id: paramsToSign.public_id,
      signature,
      timestamp,
    },
    {
      name: "file",
      filename: path.basename(videoPath),
      contentType: "video/mp4",
      data: fs.readFileSync(videoPath),
    },
  );

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
    },
    body: multipart.buffer,
  });
  const payload = await readJsonResponse(response, "Cloudinary upload");

  return {
    publicId: payload.public_id,
    resourceType: payload.resource_type || "video",
    url: payload.secure_url || payload.url || null,
  };
}

async function deleteCloudinaryAsset(publicId, resourceType = "video") {
  const cloudName = getRequiredEnv("CLOUDINARY_CLOUD_NAME");
  const apiKey = getRequiredEnv("CLOUDINARY_API_KEY");
  const apiSecret = getRequiredEnv("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    invalidate: "true",
    public_id: publicId,
    timestamp,
  };
  const signature = buildCloudinarySignature(paramsToSign, apiSecret);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      api_key: apiKey,
      invalidate: "true",
      public_id: publicId,
      signature,
      timestamp: String(timestamp),
    }).toString(),
  });
  const payload = await readJsonResponse(response, "Cloudinary destroy");
  return payload.result || null;
}

function buildInstagramApiUrl(resourcePath, query = {}) {
  const baseUrl = "https://graph.instagram.com";
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";
  const cleanPath = String(resourcePath || "").replace(/^\/+/, "");
  const params = new URLSearchParams(query);
  return params.size ? `${baseUrl}/${apiVersion}/${cleanPath}?${params.toString()}` : `${baseUrl}/${apiVersion}/${cleanPath}`;
}

async function verifyInstagramAccessToken(accessToken, expectedUserId) {
  const response = await fetch(
    buildInstagramApiUrl("me", {
      fields: "id,username",
      access_token: accessToken,
    }),
    { method: "GET" },
  );
  const payload = await readJsonResponse(response, "Instagram token preflight");

  if (expectedUserId && String(payload.id || "") !== String(expectedUserId)) {
    throw new Error(
      `Instagram token preflight returned unexpected user id ${payload.id || "unknown"} instead of ${expectedUserId}`,
    );
  }

  return payload;
}

async function readJsonResponse(response, errorPrefix) {
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(`${errorPrefix} failed with status ${response.status}: ${raw}`);
  }
  return payload;
}

async function waitForInstagramContainer(accessToken, creationId) {
  const pollIntervalMs = Number(process.env.INSTAGRAM_CONTAINER_POLL_INTERVAL_MS || 5000);
  const maxAttempts = Number(process.env.INSTAGRAM_CONTAINER_POLL_MAX_ATTEMPTS || 24);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const statusResponse = await fetch(
      buildInstagramApiUrl(creationId, {
        access_token: accessToken,
        fields: "status,status_code",
      }),
      { method: "GET" },
    );
    const statusPayload = await readJsonResponse(statusResponse, "Instagram container status");
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

async function uploadToInstagram(videoPath, scriptData) {
  const igUserId = getRequiredEnv("INSTAGRAM_IG_USER_ID");
  const accessToken = getRequiredEnv("INSTAGRAM_ACCESS_TOKEN");
  let videoUrl = process.env.INSTAGRAM_VIDEO_URL || null;
  let cloudinaryAsset = null;
  const caption = buildCaption(scriptData, "instagram");

  await verifyInstagramAccessToken(accessToken, igUserId);

  if (!videoUrl) {
    cloudinaryAsset = await uploadVideoToCloudinary(videoPath, scriptData.topic_key || scriptData.title || null);
    videoUrl = cloudinaryAsset.url;
  }

  if (!videoUrl) {
    throw new Error("Instagram video URL is missing. Provide INSTAGRAM_VIDEO_URL or Cloudinary credentials.");
  }

  const containerResponse = await fetch(buildInstagramApiUrl(`${igUserId}/media`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: accessToken,
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: "true",
    }).toString(),
  });
  const containerPayload = await readJsonResponse(containerResponse, "Instagram media container");
  const creationId = containerPayload.id;

  if (!creationId) {
    throw new Error(`Instagram media container returned no creation id: ${JSON.stringify(containerPayload)}`);
  }

  await waitForInstagramContainer(accessToken, creationId);

  const publishResponse = await fetch(buildInstagramApiUrl(`${igUserId}/media_publish`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: accessToken,
      creation_id: creationId,
    }).toString(),
  });
  const publishPayload = await readJsonResponse(publishResponse, "Instagram publish");
  const mediaId = publishPayload.id || null;

  let permalink = null;
  if (mediaId) {
    const infoResponse = await fetch(
      buildInstagramApiUrl(mediaId, {
        access_token: accessToken,
        fields: "permalink",
      }),
      { method: "GET" },
    );

    if (infoResponse.ok) {
      const infoPayload = await readJsonResponse(infoResponse, "Instagram media info");
      permalink = infoPayload.permalink || null;
    }
  }

  if (cloudinaryAsset && isTruthyEnv("CLOUDINARY_DELETE_AFTER_INSTAGRAM", true)) {
    await deleteCloudinaryAsset(cloudinaryAsset.publicId, cloudinaryAsset.resourceType);
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

  const results = {
    channelUrl:
      process.env.SOCIAL_CHANNEL_URL ||
      process.env.YOUTUBE_CHANNEL_URL ||
      null,
    youtube: {
      url: youtubeResult.url || null,
      privacyStatus: youtubeResult.privacyStatus || null,
    },
    instagram: { enabled: isEnabled("INSTAGRAM_PUBLISH_ENABLED"), status: "skipped" },
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
      },
    });
  });

  if (!results.instagram.enabled) {
    results.instagram.reason = "disabled";
  } else {
    try {
      const instagramResult = await uploadToInstagram(resolvedVideoPath, scriptData);
      results.instagram = {
        enabled: true,
        status: "published",
        ...instagramResult,
      };

      fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
      await logPlatformSuccess(topicKey, "instagram", resultPath, results.instagram);
      log("instagram publish completed", results.instagram);
    } catch (error) {
      results.instagram = {
        enabled: true,
        status: "failed",
        error: error.message,
      };
      await logPlatformWarning(topicKey, "instagram", error.message);
      log("instagram publish failed", { error: error.message });
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
  });
}

main().catch((error) => {
  fail(error.message);
});
