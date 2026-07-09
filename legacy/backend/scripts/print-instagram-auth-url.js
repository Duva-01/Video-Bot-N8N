require("dotenv").config();

const { getInstagramAppConfig } = require("./lib/instagram-token");

function fail(message) {
  console.error(`[print-instagram-auth-url][error] ${message}`);
  process.exit(1);
}

function main() {
  const { appId, redirectUri } = getInstagramAppConfig();
  if (!appId || !redirectUri) {
    fail("Missing INSTAGRAM_APP_ID or INSTAGRAM_REDIRECT_URI");
  }

  const scopes = [
    "instagram_business_basic",
    "instagram_business_content_publish",
  ].join(",");

  const url =
    `https://www.instagram.com/oauth/authorize?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    "&response_type=code";

  console.log(url);
}

main();
