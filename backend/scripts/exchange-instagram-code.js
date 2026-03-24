require("dotenv").config();

const {
  buildTokenState,
  exchangeInstagramCodeForShortLivedToken,
  exchangeShortLivedForLongLivedToken,
  getInstagramTokenStatePath,
  saveInstagramTokenState,
} = require("./lib/instagram-token");

function fail(message) {
  console.error(`[exchange-instagram-code][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

async function main() {
  const code = process.argv[2];
  if (!code) {
    fail("Usage: node backend/scripts/exchange-instagram-code.js <code>");
  }

  log("instagram code exchange starting");
  const shortLived = await exchangeInstagramCodeForShortLivedToken(code);
  const longLived = await exchangeShortLivedForLongLivedToken(shortLived.access_token);
  const state = buildTokenState({
    accessToken: longLived.access_token,
    expiresIn: longLived.expires_in,
    source: "code-exchange",
    tokenType: longLived.token_type || shortLived.token_type || null,
  });
  const statePath = saveInstagramTokenState(state);

  console.log(
    JSON.stringify(
      {
        ok: true,
        tokenStatePath: statePath,
        accessToken: state.accessToken,
        expiresAt: state.expiresAt,
        expiresIn: state.expiresIn,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  fail(error.message);
});
