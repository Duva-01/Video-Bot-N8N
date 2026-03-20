require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");

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

function pickVideoFile(video) {
  const candidates = (video.video_files || [])
    .filter((file) => file.link && file.file_type === "video/mp4")
    .sort((a, b) => (b.width || 0) - (a.width || 0));

  return candidates[0] || null;
}

async function downloadFile(url, outputPath, apiKey) {
  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Pexels download failed with status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function main() {
  const scriptPath = process.argv[2] || "/tmp-output/script.json";
  const clipsDir = process.argv[3] || "/tmp-output/clips";

  if (!fs.existsSync(scriptPath)) {
    fail(`Script file not found: ${scriptPath}`);
  }

  const scriptData = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  const apiKey = getRequiredEnv("PEXELS_API_KEY");
  const maxClips = Number(process.env.PEXELS_CLIPS_COUNT || 3);
  const queries = buildQueries(scriptData);

  if (queries.length === 0) {
    fail("No search queries available for Pexels");
  }

  fs.mkdirSync(clipsDir, { recursive: true });
  const downloads = [];
  const usedLinks = new Set();

  log("pexels search starting", {
    scriptPath,
    clipsDir,
    queries,
    maxClips,
  });

  for (const query of queries) {
    if (downloads.length >= maxClips) {
      break;
    }

    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5`;
    const response = await fetch(url, {
      headers: {
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      fail(`Pexels search failed with status ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    const videos = Array.isArray(payload.videos) ? payload.videos : [];

    for (const video of videos) {
      if (downloads.length >= maxClips) {
        break;
      }

      const selectedFile = pickVideoFile(video);
      if (!selectedFile || usedLinks.has(selectedFile.link)) {
        continue;
      }

      const outputPath = path.join(clipsDir, `clip-${String(downloads.length + 1).padStart(2, "0")}.mp4`);
      await downloadFile(selectedFile.link, outputPath, apiKey);
      usedLinks.add(selectedFile.link);
      downloads.push({
        query,
        pexels_video_id: video.id,
        outputPath,
      });
      log("pexels clip downloaded", {
        query,
        outputPath,
        pexelsVideoId: video.id,
      });
    }
  }

  if (downloads.length === 0) {
    fail("No clips were downloaded from Pexels");
  }

  const manifestPath = path.join(clipsDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(downloads, null, 2));

  log("pexels search completed", {
    clipsDir,
    clipsDownloaded: downloads.length,
    manifestPath,
  });
}

main().catch((error) => {
  fail(error.message);
});
