require("dotenv").config();

const { ensureFreshInstagramAccessToken, getInstagramTokenStatePath } = require("./lib/instagram-token");

function fail(message) {
  console.error(`[refresh-instagram-token][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

async function main() {
  const tokenInfo = await ensureFreshInstagramAccessToken({
    logger: log,
    forceRefresh: true,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        tokenSource: tokenInfo.source,
        tokenExpiresAt: tokenInfo.expiresAt ? tokenInfo.expiresAt.toISOString() : null,
        tokenStatePath: getInstagramTokenStatePath(),
        accessToken: tokenInfo.accessToken,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  fail(error.message);
});
