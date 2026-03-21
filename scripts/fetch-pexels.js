require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const { pipeline } = require("stream");
const { promisify } = require("util");

const streamPipeline = promisify(pipeline);

function fail(message) {
  console.error(`[fetch-pexels][error] ${message}`);
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

function buildQueries(scriptData) {
  const queries = [];

  if (scriptData.search_query) {
    queries.push(scriptData.search_query);
  }

  if (Array.isArray(scriptData.visual_keywords)) {
    for (const keyword of scriptData.visual_keywords) {
      if (keyword) {
        queries.push(keyword);
      }
    }
  }

  if (scriptData.topic) {
    queries.push(scriptData.topic);
  }

  return [...new Set(queries.map((item) => item.trim()).filter(Boolean))];
}

function pickVideoFile(video, targetWidth) {
  const candidates = (video.video_files || [])
    .filter((file) => {
      if (!file.link || file.file_type !== "video/mp4") {
        return false;
      }

      const width = Number(file.width || 0);
      const height = Number(file.height || 0);
      return width > 0 && height > 0;
    })
    .sort((a, b) => {
      const aWidth = Number(a.width || 0);
      const bWidth = Number(b.width || 0);
      const aHeight = Number(a.height || 0);
      const bHeight = Number(b.height || 0);
      const aPortraitPenalty = aHeight >= aWidth ? 0 : 10000;
      const bPortraitPenalty = bHeight >= bWidth ? 0 : 10000;
      const aTargetPenalty = Math.abs(aWidth - targetWidth) + (aWidth > targetWidth ? aWidth - targetWidth : 0);
      const bTargetPenalty = Math.abs(bWidth - targetWidth) + (bWidth > targetWidth ? bWidth - targetWidth : 0);

      return aPortraitPenalty + aTargetPenalty - (bPortraitPenalty + bTargetPenalty);
    });

  return candidates[0] || null;
}

async function downloadFile(url, outputPath, apiKey, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
    timeout: timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Pexels download failed with status ${response.status}`);
  }

  await streamPipeline(response.body, fs.createWriteStream(outputPath));

  return {
    bytes: Number(response.headers.get("content-length") || fs.statSync(outputPath).size || 0),
    contentType: response.headers.get("content-type") || null,
  };
}

async function main() {
  const scriptPath = process.argv[2] || "/tmp/bot-videos/script.json";
  const clipsDir = process.argv[3] || "/tmp/bot-videos/clips";

  if (!fs.existsSync(scriptPath)) {
    fail(`Script file not found: ${scriptPath}`);
  }

  const scriptData = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  const apiKey = getRequiredEnv("PEXELS_API_KEY");
  const maxClips = Number(process.env.PEXELS_CLIPS_COUNT || 3);
  const queryLimit = Number(process.env.PEXELS_QUERY_LIMIT || 3);
  const perPage = Number(process.env.PEXELS_PER_PAGE || 3);
  const searchTimeoutMs = Number(process.env.PEXELS_SEARCH_TIMEOUT_MS || 15000);
  const downloadTimeoutMs = Number(process.env.PEXELS_DOWNLOAD_TIMEOUT_MS || 45000);
  const targetWidth = Number(process.env.PEXELS_TARGET_WIDTH || process.env.SHORTS_WIDTH || 540);
  const queries = buildQueries(scriptData).slice(0, queryLimit);

  if (queries.length === 0) {
    fail("No search queries available for Pexels");
  }

  fs.mkdirSync(clipsDir, { recursive: true });
  const downloads = [];
  const usedLinks = new Set();
  const queryErrors = [];

  log("pexels search starting", {
    scriptPath,
    clipsDir,
    queries,
    maxClips,
    queryLimit,
    perPage,
    targetWidth,
  });

  for (const query of queries) {
    if (downloads.length >= maxClips) {
      break;
    }

    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${perPage}`;
    let payload;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: apiKey,
        },
        timeout: searchTimeoutMs,
      });

      if (!response.ok) {
        throw new Error(`Pexels search failed with status ${response.status}: ${await response.text()}`);
      }

      payload = await response.json();
    } catch (error) {
      queryErrors.push({ query, error: error.message });
      log("pexels query failed", {
        query,
        error: error.message,
      });
      continue;
    }

    const videos = Array.isArray(payload.videos) ? payload.videos : [];

    log("pexels query completed", {
      query,
      videosFound: videos.length,
    });

    for (const video of videos) {
      if (downloads.length >= maxClips) {
        break;
      }

      const selectedFile = pickVideoFile(video, targetWidth);
      if (!selectedFile || usedLinks.has(selectedFile.link)) {
        continue;
      }

      const outputPath = path.join(clipsDir, `clip-${String(downloads.length + 1).padStart(2, "0")}.mp4`);

      try {
        const downloadMeta = await downloadFile(selectedFile.link, outputPath, apiKey, downloadTimeoutMs);
        usedLinks.add(selectedFile.link);
        downloads.push({
          query,
          pexels_video_id: video.id,
          outputPath,
          width: selectedFile.width || null,
          height: selectedFile.height || null,
        });
        log("pexels clip downloaded", {
          query,
          outputPath,
          pexelsVideoId: video.id,
          width: selectedFile.width || null,
          height: selectedFile.height || null,
          bytes: downloadMeta.bytes,
          contentType: downloadMeta.contentType,
        });
      } catch (error) {
        log("pexels clip download failed", {
          query,
          pexelsVideoId: video.id,
          error: error.message,
        });
      }
    }
  }

  if (downloads.length === 0) {
    fail(`No clips were downloaded from Pexels. Query errors: ${JSON.stringify(queryErrors)}`);
  }

  const manifestPath = path.join(clipsDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(downloads, null, 2));

  log("pexels search completed", {
    clipsDir,
    clipsDownloaded: downloads.length,
    manifestPath,
    queryErrors: queryErrors.length,
  });
}

main().catch((error) => {
  fail(error.message);
});

