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

  if (!videoPath) {
    fail("Usage: node /app/scripts/upload-youtube.js <videoPath> [title] [description] [tagsCsv]");
  }

  const resolvedVideoPath = path.resolve(videoPath);

  if (!fs.existsSync(resolvedVideoPath)) {
    fail(`Video file not found: ${resolvedVideoPath}`);
  }

  const clientId = getRequiredEnv("YOUTUBE_CLIENT_ID");
  const clientSecret = getRequiredEnv("YOUTUBE_CLIENT_SECRET");
  const refreshToken = getRequiredEnv("YOUTUBE_REFRESH_TOKEN");
  const defaultTitle = process.env.YOUTUBE_DEFAULT_TITLE || `Short IA ${new Date().toISOString().slice(0, 10)}`;
  const defaultDescription = process.env.YOUTUBE_DEFAULT_DESCRIPTION || "Video generado automaticamente con n8n.";
  const defaultTags = process.env.YOUTUBE_DEFAULT_TAGS || "ia,automatizacion,shorts";
  const privacyStatus = process.env.YOUTUBE_PRIVACY_STATUS || "private";
  const categoryId = process.env.YOUTUBE_CATEGORY_ID || "28";

  const title = (process.argv[3] || defaultTitle).slice(0, 100);
  const description = (process.argv[4] || defaultDescription).slice(0, 5000);
  const tags = sanitizeTags(process.argv[5] || defaultTags);

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
  log("youtube upload completed", {
    videoId,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
  });
}

main().catch((error) => {
  fail(error.message);
});
