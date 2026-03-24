require("dotenv").config();

const { ensureFreshTikTokAccessToken, getTikTokStatePath } = require("./lib/tiktok-auth");

function fail(message) {
  console.error(`[refresh-tiktok-token][error] ${message}`);
  process.exit(1);
}

ensureFreshTikTokAccessToken({
  logger: (message, meta = {}) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
  },
  forceRefresh: true,
})
  .then((payload) => {
    console.log(
      JSON.stringify(
        {
          statePath: getTikTokStatePath(),
          openId: payload.openId || null,
          expiresAt: payload.expiresAt || null,
          refreshExpiresAt: payload.refreshExpiresAt || null,
        },
        null,
        2,
      ),
    );
  })
  .catch((error) => fail(error.message));
