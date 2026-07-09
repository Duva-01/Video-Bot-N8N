require("dotenv").config();

const {
  ensureFreshInstagramAccessToken,
  getConfiguredInstagramToken,
  loadInstagramTokenState,
  verifyInstagramAccessToken,
} = require("./lib/instagram-token");

function fail(message) {
  console.error(`[check-instagram-token][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

async function main() {
  const expectedUserId = process.env.INSTAGRAM_IG_USER_ID || null;
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";

  let tokenInfo = await ensureFreshInstagramAccessToken({
    logger: log,
  });

  try {
    const payload = await verifyInstagramAccessToken(tokenInfo.accessToken, apiVersion, expectedUserId);
    const state = loadInstagramTokenState();
    console.log(
      JSON.stringify(
        {
          ok: true,
          apiVersion,
          instagramUser: payload,
          expectedUserId,
          idMatches: expectedUserId ? String(payload.id || "") === String(expectedUserId) : null,
          tokenSource: tokenInfo.source,
          tokenExpiresAt: tokenInfo.expiresAt ? tokenInfo.expiresAt.toISOString() : state?.expiresAt || null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (!String(error.message || "").includes('"code":190')) {
      throw error;
    }

    log("instagram token verification failed, trying forced refresh", { error: error.message });
    tokenInfo = await ensureFreshInstagramAccessToken({
      logger: log,
      forceRefresh: true,
    });
    const payload = await verifyInstagramAccessToken(tokenInfo.accessToken, apiVersion, expectedUserId);
    console.log(
      JSON.stringify(
        {
          ok: true,
          apiVersion,
          instagramUser: payload,
          expectedUserId,
          idMatches: expectedUserId ? String(payload.id || "") === String(expectedUserId) : null,
          tokenSource: tokenInfo.source,
          tokenExpiresAt: tokenInfo.expiresAt ? tokenInfo.expiresAt.toISOString() : null,
          refreshedAfterFailure: true,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  const current = getConfiguredInstagramToken();
  fail(`${error.message} (tokenSource=${current.source})`);
});
