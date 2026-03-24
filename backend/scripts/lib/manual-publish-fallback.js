require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { hasCloudinaryConfig, uploadVideoToCloudinary } = require("./cloudinary-utils");

function sanitizeFileStem(value) {
  return String(value || "manual")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function getManualPublishDir(videoPath) {
  const baseDir =
    process.env.MANUAL_PUBLISH_DIR ||
    path.join(path.dirname(path.resolve(videoPath)), "manual-publish-fallback");

  return ensureDir(baseDir);
}

function getCloudinaryStatePath(baseDir) {
  return path.join(baseDir, "cloudinary-video.json");
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function ensureCloudinaryFallbackVideo(videoPath, scriptData = {}, logger = () => {}) {
  const baseDir = getManualPublishDir(videoPath);
  const statePath = getCloudinaryStatePath(baseDir);
  const existing = readJsonIfExists(statePath);
  if (existing?.url) {
    return existing;
  }

  if (!hasCloudinaryConfig()) {
    throw new Error("Cloudinary is not configured for manual publish fallback");
  }

  const topicKey = scriptData.topic_key || scriptData.title || path.basename(videoPath, path.extname(videoPath));
  const asset = await uploadVideoToCloudinary(videoPath, {
    publicId: `${sanitizeFileStem(topicKey)}-manual`,
  });

  fs.writeFileSync(statePath, JSON.stringify(asset, null, 2));
  logger("manual fallback video stored in cloudinary", {
    platform: "manual",
    cloudinaryUrl: asset.url,
    cloudinaryPublicId: asset.publicId,
  });

  return asset;
}

function buildManualText(payload) {
  const lines = [
    `Platform: ${payload.platform}`,
    `Status: ${payload.status}`,
    payload.title ? `Title: ${payload.title}` : null,
    payload.videoUrl ? `Video URL: ${payload.videoUrl}` : null,
    payload.localVideoPath ? `Local Video: ${payload.localVideoPath}` : null,
    payload.error ? `Error: ${payload.error}` : null,
    "",
    "Caption / Description:",
    payload.caption || payload.description || "",
    "",
    "Generated at:",
    payload.generatedAt,
  ];

  return lines.filter((line) => line !== null).join("\n").trim() + "\n";
}

async function writeManualPublishFallback({
  videoPath,
  scriptData = {},
  platform,
  title,
  description,
  caption,
  error,
  logger = () => {},
  metadata = {},
}) {
  const baseDir = getManualPublishDir(videoPath);
  const stem = sanitizeFileStem(platform || "manual");
  let cloudinaryAsset = null;
  let cloudinaryError = null;

  try {
    cloudinaryAsset = await ensureCloudinaryFallbackVideo(videoPath, scriptData, logger);
  } catch (innerError) {
    cloudinaryError = innerError.message;
    logger("manual fallback cloudinary upload skipped", {
      platform,
      error: innerError.message,
    });
  }

  const payload = {
    platform,
    status: "manual_fallback_ready",
    generatedAt: new Date().toISOString(),
    title: title || scriptData.title || "",
    description: description || scriptData.description || "",
    caption: caption || "",
    videoUrl: cloudinaryAsset?.url || null,
    cloudinaryPublicId: cloudinaryAsset?.publicId || null,
    cloudinaryResourceType: cloudinaryAsset?.resourceType || null,
    cloudinaryError,
    localVideoPath: path.resolve(videoPath),
    error: error || null,
    topicKey: scriptData.topic_key || null,
    metadata,
  };

  const jsonPath = path.join(baseDir, `${stem}.json`);
  const txtPath = path.join(baseDir, `${stem}.txt`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(txtPath, buildManualText(payload));

  return {
    ...payload,
    dir: baseDir,
    jsonPath,
    txtPath,
  };
}

module.exports = {
  ensureCloudinaryFallbackVideo,
  getManualPublishDir,
  writeManualPublishFallback,
};
