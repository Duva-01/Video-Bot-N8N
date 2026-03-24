require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const { ensureFreshTikTokAccessToken } = require("./lib/tiktok-auth");

function fail(message) {
  console.error(`[tiktok-upload][error] ${message}`);
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

function writeResult(resultPath, payload) {
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2));
}

function chunkRanges(totalBytes) {
  const maxChunkSize = 64 * 1024 * 1024;
  const ranges = [];
  let start = 0;

  while (start < totalBytes) {
    const end = Math.min(start + maxChunkSize, totalBytes);
    ranges.push([start, end]);
    start = end;
  }

  return ranges;
}

async function putChunk(uploadUrl, chunk, start, end, totalSize) {
  const maxAttempts = Number(process.env.TIKTOK_UPLOAD_MAX_ATTEMPTS || 4);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end - 1}/${totalSize}`,
      },
      body: chunk,
    });

    if (response.ok || response.status === 201 || response.status === 206) {
      return;
    }

    const raw = await response.text();
    lastError = new Error(`TikTok chunk upload failed with status ${response.status}: ${raw}`);
    if (attempt === maxAttempts || (response.status < 500 && response.status !== 429)) {
      throw lastError;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }

  throw lastError;
}

async function fetchPublishStatus(token, publishId) {
  const maxAttempts = Number(process.env.TIKTOK_STATUS_MAX_ATTEMPTS || 4);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        publish_id: publishId,
      }),
    });

    if (response.ok) {
      return response.json();
    }

    const raw = await response.text();
    lastError = new Error(`TikTok status fetch failed with status ${response.status}: ${raw}`);
    if (attempt === maxAttempts || (response.status < 500 && response.status !== 429)) {
      throw lastError;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }

  throw lastError;
}

async function fetchCreatorInfo(token) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`TikTok creator info fetch failed with status ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function resolvePrivacyLevel(creatorInfoPayload, preferredPrivacyLevel) {
  const options = creatorInfoPayload?.data?.privacy_level_options || [];
  if (options.includes(preferredPrivacyLevel)) {
    return preferredPrivacyLevel;
  }

  if (options.includes("SELF_ONLY")) {
    return "SELF_ONLY";
  }

  return options[0] || preferredPrivacyLevel || "SELF_ONLY";
}

async function uploadToTikTok(videoPath, scriptData = {}, options = {}) {
  let accessToken = options.accessToken || null;
  if (!accessToken) {
    const tokenInfo = await ensureFreshTikTokAccessToken({
      logger: options.logger || log,
    });
    accessToken = tokenInfo.accessToken;
  } else if (options.refreshAccessToken !== false) {
    const tokenInfo = await ensureFreshTikTokAccessToken({
      logger: options.logger || log,
    });
    accessToken = tokenInfo.accessToken || accessToken;
  }

  if (!accessToken) {
    return {
      skipped: true,
      reason: "missing_access_token",
    };
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${path.resolve(videoPath)}`);
  }

  const preferredPrivacyLevel = options.privacyLevel || process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY";
  const title = String(scriptData.title || process.env.TIKTOK_DEFAULT_TITLE || "Curious fact")
    .trim()
    .slice(0, 150);
  const buffer = fs.readFileSync(videoPath);
  const size = buffer.length;
  const ranges = chunkRanges(size);
  const chunkSize = ranges[0][1] - ranges[0][0];
  const creatorInfoPayload = await fetchCreatorInfo(accessToken);
  const privacyLevel = resolvePrivacyLevel(creatorInfoPayload, preferredPrivacyLevel);

  const logger = options.logger || log;
  logger("tiktok upload initializing", {
    videoPath,
    size,
    chunks: ranges.length,
    privacyLevel,
  });

  const maxInitAttempts = Number(process.env.TIKTOK_INIT_MAX_ATTEMPTS || 4);
  let initData = null;
  let initError = null;

  for (let attempt = 1; attempt <= maxInitAttempts; attempt += 1) {
    const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title,
          privacy_level: privacyLevel,
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: size,
          chunk_size: chunkSize,
          total_chunk_count: ranges.length,
        },
      }),
    });

    if (initResponse.ok) {
      initData = await initResponse.json();
      break;
    }

    const raw = await initResponse.text();
    initError = new Error(`TikTok init failed with status ${initResponse.status}: ${raw}`);
    if (attempt === maxInitAttempts || (initResponse.status < 500 && initResponse.status !== 429)) {
      throw initError;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }

  const uploadUrl = initData?.data?.upload_url;
  const publishId = initData?.data?.publish_id;

  if (!uploadUrl || !publishId) {
    throw new Error("TikTok init response missing upload_url or publish_id");
  }

  for (const [start, end] of ranges) {
    await putChunk(uploadUrl, buffer.slice(start, end), start, end, size);
  }

  let statusPayload = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    statusPayload = await fetchPublishStatus(accessToken, publishId);
    const status = statusPayload?.data?.status;
    if (status && status !== "PROCESSING_UPLOAD") {
      break;
    }
  }

  return {
    publish_id: publishId,
    status: statusPayload?.data?.status || "PROCESSING_UPLOAD",
    privacyLevel,
    creatorInfo: creatorInfoPayload?.data || null,
    raw: statusPayload,
  };
}

async function main() {
  const videoPath = process.argv[2] || "/tmp/bot-videos/final.mp4";
  const scriptPath = process.argv[3] || "/tmp/bot-videos/script.json";
  const resultPath = process.argv[4] || "/tmp/bot-videos/tiktok-result.json";
  if (!fs.existsSync(videoPath)) {
    fail(`Video file not found: ${path.resolve(videoPath)}`);
  }

  const scriptData = fs.existsSync(scriptPath) ? JSON.parse(fs.readFileSync(scriptPath, "utf8")) : {};
  const result = await uploadToTikTok(videoPath, scriptData, {
    logger: log,
  });

  writeResult(resultPath, result);
  log("tiktok upload completed", result);
}

if (require.main === module) {
  main().catch((error) => {
    fail(error.message);
  });
}

module.exports = {
  uploadToTikTok,
};

