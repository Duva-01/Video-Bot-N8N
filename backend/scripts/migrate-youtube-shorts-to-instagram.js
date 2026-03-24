require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { google } = require("googleapis");
const fetch = global.fetch || require("node-fetch");
const { createPool, ensureSchema, hasDatabase } = require("./lib/content-db");

function fail(message) {
  console.error(`[migrate-youtube-shorts][error] ${message}`);
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

function parseArgs(argv) {
  const options = {
    outputDir: path.resolve(process.cwd(), "migration-output", "youtube-to-instagram"),
    limit: null,
    browser: process.env.YTDLP_COOKIES_BROWSER || "chrome",
    dryRun: false,
    force: false,
    cleanupBinary: false,
  };

  for (const raw of argv) {
    if (raw === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (raw === "--force") {
      options.force = true;
      continue;
    }
    if (raw === "--cleanup-binary") {
      options.cleanupBinary = true;
      continue;
    }
    if (raw.startsWith("--limit=")) {
      options.limit = Number(raw.split("=")[1] || 0) || null;
      continue;
    }
    if (raw.startsWith("--browser=")) {
      options.browser = raw.split("=")[1] || options.browser;
      continue;
    }
    if (raw.startsWith("--output-dir=")) {
      options.outputDir = path.resolve(process.cwd(), raw.split("=")[1] || options.outputDir);
    }
  }

  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

function toDatePrefix(value) {
  if (!value) {
    return "unknown";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toISOString().slice(0, 10);
}

function parseIsoDurationToSeconds(value) {
  const match =
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(value || "").trim()) || [];
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function isLikelyShort(video) {
  const durationSeconds = parseIsoDurationToSeconds(video?.contentDetails?.duration);
  const publishedAt = Date.parse(video?.snippet?.publishedAt || "") || 0;
  const title = String(video?.snippet?.title || "");
  const description = String(video?.snippet?.description || "");
  const combined = `${title}\n${description}`.toLowerCase();

  if (combined.includes("#shorts")) {
    return true;
  }

  if (publishedAt >= Date.parse("2024-10-15T00:00:00Z")) {
    return durationSeconds > 0 && durationSeconds <= 180;
  }

  return durationSeconds > 0 && durationSeconds <= 60;
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}: ${await response.text()}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, buffer);
}

async function ensureYtDlpBinary(cacheDir) {
  const platform = process.platform;
  const isWindows = platform === "win32";
  const binaryName = isWindows ? "yt-dlp.exe" : "yt-dlp";
  const binaryPath = path.join(cacheDir, binaryName);

  if (!fs.existsSync(binaryPath)) {
    ensureDir(cacheDir);
    const url = isWindows
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
      : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
    log("downloading yt-dlp binary", { url, binaryPath });
    await downloadFile(url, binaryPath);
    if (!isWindows) {
      fs.chmodSync(binaryPath, 0o755);
    }
  }

  return binaryPath;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result;
}

function buildInstagramScriptData(video) {
  const videoId = video.id;
  const snippet = video.snippet || {};
  return {
    topic_key: `youtube-migrate-${videoId}`,
    topic: snippet.title || videoId,
    category: "youtube-migration",
    title: snippet.title || "Short migrado desde YouTube",
    description: snippet.description || "",
    tags: Array.isArray(snippet.tags) ? snippet.tags : [],
    language: snippet.defaultAudioLanguage || snippet.defaultLanguage || process.env.VIDEO_DEFAULT_LANGUAGE || "es",
  };
}

async function createYouTubeClient() {
  const clientId = getRequiredEnv("YOUTUBE_CLIENT_ID");
  const clientSecret = getRequiredEnv("YOUTUBE_CLIENT_SECRET");
  const refreshToken = getRequiredEnv("YOUTUBE_REFRESH_TOKEN");
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.youtube({ version: "v3", auth });
}

async function getUploadsPlaylistId(youtube) {
  const response = await youtube.channels.list({
    part: ["contentDetails", "snippet"],
    mine: true,
    maxResults: 1,
  });
  const item = response.data.items?.[0];
  const uploadsPlaylistId = item?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error("Could not resolve uploads playlist for authenticated channel");
  }
  return {
    uploadsPlaylistId,
    channelTitle: item?.snippet?.title || null,
  };
}

async function listVideosFromDatabase() {
  if (!hasDatabase()) {
    return [];
  }

  const pool = createPool();
  try {
    await ensureSchema(pool);
    const result = await pool.query(`
      SELECT
        topic_key,
        title,
        description,
        youtube_video_id,
        youtube_url,
        published_at,
        updated_at,
        metadata
      FROM content_runs
      WHERE youtube_video_id IS NOT NULL OR youtube_url IS NOT NULL
      ORDER BY COALESCE(published_at, updated_at) ASC
    `);

    return result.rows.map((row) => ({
      id: row.youtube_video_id || extractVideoIdFromUrl(row.youtube_url),
      snippet: {
        title: row.title || row.topic_key,
        description: row.description || "",
        publishedAt: row.published_at || row.updated_at || null,
        defaultAudioLanguage: row.metadata?.language || null,
        tags: Array.isArray(row.metadata?.tags) ? row.metadata.tags : [],
      },
      status: {
        privacyStatus: row.metadata?.privacy_status || null,
      },
      contentDetails: {
        duration: row.metadata?.duration || null,
      },
      sourceRecord: {
        topicKey: row.topic_key,
        youtubeUrl: row.youtube_url || null,
      },
    }));
  } finally {
    await pool.end();
  }
}

function extractVideoIdFromUrl(value) {
  const match = /[?&]v=([^&]+)/.exec(String(value || ""));
  return match?.[1] || null;
}

async function listUploadVideoIds(youtube, uploadsPlaylistId) {
  const ids = [];
  let pageToken = null;

  do {
    const response = await youtube.playlistItems.list({
      part: ["contentDetails"],
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken: pageToken || undefined,
    });

    for (const item of response.data.items || []) {
      const videoId = item?.contentDetails?.videoId;
      if (videoId) {
        ids.push(videoId);
      }
    }

    pageToken = response.data.nextPageToken || null;
  } while (pageToken);

  return ids;
}

async function listVideosByIds(youtube, ids) {
  const results = [];
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const response = await youtube.videos.list({
      part: ["snippet", "status", "contentDetails"],
      id: batch,
      maxResults: 50,
    });
    results.push(...(response.data.items || []));
  }
  return results;
}

function findDownloadedVideo(downloadDir) {
  const candidates = fs
    .readdirSync(downloadDir)
    .filter((name) => /\.(mp4|mkv|webm|mov)$/i.test(name))
    .sort();
  if (!candidates.length) {
    throw new Error(`No downloaded video found in ${downloadDir}`);
  }
  return path.join(downloadDir, candidates[0]);
}

async function downloadVideo(ytDlpPath, browser, videoUrl, downloadDir) {
  ensureDir(downloadDir);
  const outputTemplate = path.join(downloadDir, "video.%(ext)s");
  const commonArgs = [
    "--no-progress",
    "--no-warnings",
    "--restrict-filenames",
    "--output",
    outputTemplate,
    "--format",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
    "--merge-output-format",
    "mp4",
  ];

  try {
    runCommand(ytDlpPath, [...commonArgs, videoUrl]);
  } catch (publicError) {
    runCommand(ytDlpPath, ["--cookies-from-browser", browser, ...commonArgs, videoUrl]);
  }

  return findDownloadedVideo(downloadDir);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadManifest(manifestPath) {
  const payload = readJsonIfExists(manifestPath, { items: [] }) || { items: [] };
  const items = Array.isArray(payload.items) ? payload.items : [];
  const byVideoId = new Map(items.map((item) => [item.videoId, item]));
  return { items, byVideoId };
}

function upsertManifestEntry(manifest, entry) {
  const existingIndex = manifest.items.findIndex((item) => item.videoId === entry.videoId);
  if (existingIndex >= 0) {
    manifest.items[existingIndex] = { ...manifest.items[existingIndex], ...entry };
  } else {
    manifest.items.push(entry);
  }
  manifest.byVideoId.set(entry.videoId, entry);
}

async function migrateVideo({ ytDlpPath, browser, outputDir, video, delayMs, dryRun }) {
  const videoId = video.id;
  const snippet = video.snippet || {};
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const slug = slugify(snippet.title || videoId) || videoId;
  const itemDir = path.join(outputDir, `${toDatePrefix(snippet.publishedAt)}-${slug}-${videoId}`);
  const downloadDir = path.join(itemDir, "download");
  const scriptPath = path.join(itemDir, "script.json");
  const youtubeResultPath = path.join(itemDir, "youtube-result.json");
  const socialResultPath = path.join(itemDir, "social-result.json");

  ensureDir(itemDir);

  const scriptData = buildInstagramScriptData(video);
  const youtubeResult = {
    videoId,
    url: videoUrl,
    privacyStatus: video.status?.privacyStatus || null,
  };

  writeJson(scriptPath, scriptData);
  writeJson(youtubeResultPath, youtubeResult);

  log("migrating youtube short", {
    videoId,
    title: snippet.title || null,
    privacyStatus: video.status?.privacyStatus || null,
    duration: video.contentDetails?.duration || null,
  });

  if (dryRun) {
    return {
      status: "dry-run",
      itemDir,
      videoId,
      videoUrl,
    };
  }

  const downloadedVideoPath = await downloadVideo(ytDlpPath, browser, videoUrl, downloadDir);
  log("youtube short downloaded", { videoId, downloadedVideoPath });

  runCommand(
    "node",
    [
      path.join(process.cwd(), "backend", "scripts", "upload-socials.js"),
      downloadedVideoPath,
      scriptPath,
      youtubeResultPath,
      socialResultPath,
    ],
    {
      env: {
        ...process.env,
        INSTAGRAM_PUBLISH_ENABLED: "true",
      },
      stdio: "inherit",
    },
  );

  const socialResult = readJsonIfExists(socialResultPath, {});
  const instagram = socialResult.instagram || {};

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  return {
    status: instagram.status || "unknown",
    itemDir,
    videoId,
    videoUrl,
    instagramUrl: instagram.url || null,
    error: instagram.error || null,
    downloadedVideoPath,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let channelTitle = null;
  let uploadsPlaylistId = null;
  let allVideos = await listVideosFromDatabase();

  if (!allVideos.length) {
    const youtube = await createYouTubeClient();
    const uploadsInfo = await getUploadsPlaylistId(youtube);
    uploadsPlaylistId = uploadsInfo.uploadsPlaylistId;
    channelTitle = uploadsInfo.channelTitle;
    const allVideoIds = await listUploadVideoIds(youtube, uploadsPlaylistId);
    allVideos = await listVideosByIds(youtube, allVideoIds);
  } else {
    channelTitle = "database-import";
  }

  const shorts = allVideos
    .filter((video) => video?.id)
    .filter((video) => (channelTitle === "database-import" ? true : isLikelyShort(video)))
    .sort((left, right) => Date.parse(left?.snippet?.publishedAt || 0) - Date.parse(right?.snippet?.publishedAt || 0));
  const selectedShorts = options.limit ? shorts.slice(0, options.limit) : shorts;
  const manifestPath = path.join(options.outputDir, "manifest.json");
  const manifest = loadManifest(manifestPath);
  const ytDlpPath = await ensureYtDlpBinary(path.join(options.outputDir, ".cache", "yt-dlp"));
  const delayMs = Number(process.env.INSTAGRAM_MIGRATION_DELAY_MS || 15000);

  ensureDir(options.outputDir);

  log("youtube shorts migration starting", {
    channelTitle,
    uploadsPlaylistId,
    totalUploads: allVideos.length,
    totalShorts: shorts.length,
    selected: selectedShorts.length,
    outputDir: options.outputDir,
    browser: options.browser,
    dryRun: options.dryRun,
  });

  for (const video of selectedShorts) {
    const existing = manifest.byVideoId.get(video.id);
    if (!options.force && existing?.status === "published" && existing.instagramUrl) {
      log("skipping already migrated short", { videoId: video.id, instagramUrl: existing.instagramUrl });
      continue;
    }

    try {
      const result = await migrateVideo({
        ytDlpPath,
        browser: options.browser,
        outputDir: options.outputDir,
        video,
        delayMs,
        dryRun: options.dryRun,
      });

      upsertManifestEntry(manifest, {
        videoId: video.id,
        title: video?.snippet?.title || null,
        videoUrl: `https://www.youtube.com/watch?v=${video.id}`,
        publishedAt: video?.snippet?.publishedAt || null,
        privacyStatus: video?.status?.privacyStatus || null,
        duration: video?.contentDetails?.duration || null,
        ...result,
      });
      writeJson(manifestPath, { channelTitle, items: manifest.items });
    } catch (error) {
      upsertManifestEntry(manifest, {
        videoId: video.id,
        title: video?.snippet?.title || null,
        videoUrl: `https://www.youtube.com/watch?v=${video.id}`,
        publishedAt: video?.snippet?.publishedAt || null,
        privacyStatus: video?.status?.privacyStatus || null,
        duration: video?.contentDetails?.duration || null,
        status: "failed",
        error: error.message,
      });
      writeJson(manifestPath, { channelTitle, items: manifest.items });
      log("youtube short migration failed", { videoId: video.id, error: error.message });
    }
  }

  if (options.cleanupBinary && fs.existsSync(ytDlpPath)) {
    fs.rmSync(path.dirname(ytDlpPath), { recursive: true, force: true });
  }

  log("youtube shorts migration finished", {
    manifestPath,
    totalItems: manifest.items.length,
    published: manifest.items.filter((item) => item.status === "published").length,
    failed: manifest.items.filter((item) => item.status === "failed").length,
    skipped: manifest.items.filter((item) => item.status === "skipped").length,
  });
}

main().catch((error) => {
  fail(error.message);
});
