require("dotenv").config();

const { createTikTokAuthorizationRequest } = require("./lib/tiktok-auth");

function fail(message) {
  console.error(`[print-tiktok-auth-url][error] ${message}`);
  process.exit(1);
}

try {
  const request = createTikTokAuthorizationRequest();
  console.log(JSON.stringify({
    redirectUri: request.redirectUri,
    scope: request.scope,
    statePath: request.statePath,
    url: request.url,
  }, null, 2));
} catch (error) {
  fail(error.message);
}
