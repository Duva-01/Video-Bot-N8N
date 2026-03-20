require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

function fail(message) {
  console.error(`[youtube-upload][error] ${message}`);
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

function sanitizeTags(tagsValue) {
  return tagsValue
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 15);
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

  const clientId = getRequiredEnv("YOUTUBE_CLIENT_ID");
  const clientSecret = getRequiredEnv("YOUTUBE_CLIENT_SECRET");
  const refreshToken = getRequiredEnv("YOUTUBE_REFRESH_TOKEN");
  const scriptData = fs.existsSync(scriptPath) ? JSON.parse(fs.readFileSync(scriptPath, "utf8")) : {};
  const defaultTitle = scriptData.title || process.env.YOUTUBE_DEFAULT_TITLE || `Short IA ${new Date().toISOString().slice(0, 10)}`;
  const defaultDescription = scriptData.description || process.env.YOUTUBE_DEFAULT_DESCRIPTION || "Video generado automaticamente con n8n.";
  const defaultTags = (scriptData.tags || []).join(",") || process.env.YOUTUBE_DEFAULT_TAGS || "ia,automatizacion,shorts";
  const privacyStatus = process.env.YOUTUBE_PRIVACY_STATUS || "private";
  const categoryId = process.env.YOUTUBE_CATEGORY_ID || "28";

  const title = defaultTitle.slice(0, 100);
  const description = defaultDescription.slice(0, 5000);
  const tags = sanitizeTags(defaultTags);

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  const youtube = google.youtube({
    version: "v3",
    auth,
  });

  log("youtube upload starting", {
    videoPath: resolvedVideoPath,
    title,
    privacyStatus,
  });

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    notifySubscribers: false,
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId,
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(resolvedVideoPath),
    },
  });

  const videoId = response.data.id;
  const result = {
    videoId,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
  };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));

  log("youtube upload completed", result);
}

main().catch((error) => {
  fail(error.message);
});

