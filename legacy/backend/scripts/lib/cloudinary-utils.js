require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const FormData = require("form-data");

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
  );
}

function buildCloudinarySignature(params, apiSecret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

function buildMultipartBody(fields, fileField) {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields || {})) {
    form.append(name, String(value));
  }

  if (fileField) {
    form.append(fileField.name, fileField.data, {
      filename: fileField.filename,
      contentType: fileField.contentType || "application/octet-stream",
      knownLength: fileField.knownLength || undefined,
    });
  }

  return form;
}

function inferContentType(filePath, fallback = "application/octet-stream") {
  const extension = String(path.extname(filePath || "")).toLowerCase();
  const byExtension = {
    ".json": "application/json",
    ".txt": "text/plain",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
  };

  return byExtension[extension] || fallback;
}

async function readJsonResponse(response, errorPrefix) {
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(`${errorPrefix} failed with status ${response.status}: ${raw}`);
  }
  return payload;
}

function sanitizePublicId(value) {
  return String(value || `short-${Date.now()}`)
    .trim()
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uploadVideoToCloudinary(videoPath, options = {}) {
  const cloudName = getRequiredEnv("CLOUDINARY_CLOUD_NAME");
  const apiKey = getRequiredEnv("CLOUDINARY_API_KEY");
  const apiSecret = getRequiredEnv("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = options.folder || process.env.CLOUDINARY_FOLDER || "bot-videos";
  const publicId = sanitizePublicId(options.publicId || options.topicKey || path.basename(videoPath, path.extname(videoPath)));
  const paramsToSign = {
    folder,
    public_id: publicId,
    timestamp,
  };
  const signature = buildCloudinarySignature(paramsToSign, apiSecret);
  const multipart = buildMultipartBody(
    {
      api_key: apiKey,
      folder,
      public_id: publicId,
      signature,
      timestamp,
    },
    {
      name: "file",
      filename: path.basename(videoPath),
      contentType: "video/mp4",
      knownLength: fs.statSync(videoPath).size,
      data: fs.createReadStream(videoPath),
    },
  );

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
    method: "POST",
    headers: multipart.getHeaders(),
    body: multipart,
  });
  const payload = await readJsonResponse(response, "Cloudinary upload");

  return {
    publicId: payload.public_id,
    resourceType: payload.resource_type || "video",
    url: payload.secure_url || payload.url || null,
    bytes: payload.bytes || null,
    duration: payload.duration || null,
  };
}

async function uploadFileToCloudinary(filePath, options = {}) {
  const cloudName = getRequiredEnv("CLOUDINARY_CLOUD_NAME");
  const apiKey = getRequiredEnv("CLOUDINARY_API_KEY");
  const apiSecret = getRequiredEnv("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const resourceType = options.resourceType || "raw";
  const folder = options.folder || process.env.CLOUDINARY_FOLDER || "bot-videos";
  const publicId = sanitizePublicId(options.publicId || path.basename(filePath, path.extname(filePath)));
  const paramsToSign = {
    folder,
    public_id: publicId,
    timestamp,
  };
  const signature = buildCloudinarySignature(paramsToSign, apiSecret);
  const multipart = buildMultipartBody(
    {
      api_key: apiKey,
      folder,
      public_id: publicId,
      signature,
      timestamp,
    },
    {
      name: "file",
      filename: path.basename(filePath),
      contentType: options.contentType || inferContentType(filePath),
      knownLength: fs.statSync(filePath).size,
      data: fs.createReadStream(filePath),
    },
  );

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
    method: "POST",
    headers: multipart.getHeaders(),
    body: multipart,
  });
  const payload = await readJsonResponse(response, "Cloudinary file upload");

  return {
    publicId: payload.public_id,
    resourceType: payload.resource_type || resourceType,
    url: payload.secure_url || payload.url || null,
    bytes: payload.bytes || null,
    format: payload.format || null,
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

module.exports = {
  buildCloudinarySignature,
  buildMultipartBody,
  deleteCloudinaryAsset,
  hasCloudinaryConfig,
  inferContentType,
  readJsonResponse,
  uploadFileToCloudinary,
  uploadVideoToCloudinary,
};
