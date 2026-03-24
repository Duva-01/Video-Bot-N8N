require("dotenv").config();

const { exchangeTikTokCodeForToken, getTikTokStatePath } = require("./lib/tiktok-auth");

function fail(message) {
  console.error(`[exchange-tiktok-code][error] ${message}`);
  process.exit(1);
}

const code = process.argv[2];
if (!code) {
  fail("Usage: node backend/scripts/exchange-tiktok-code.js <code>");
}

exchangeTikTokCodeForToken(code)
  .then((payload) => {
    console.log(JSON.stringify({
      statePath: getTikTokStatePath(),
      openId: payload.openId,
      expiresAt: payload.expiresAt,
      refreshExpiresAt: payload.refreshExpiresAt,
    }, null, 2));
  })
  .catch((error) => fail(error.message));
