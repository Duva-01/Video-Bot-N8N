require("dotenv").config();

const fetch = global.fetch || require("node-fetch");

function fail(message) {
  console.error(`[check-instagram-token][error] ${message}`);
  process.exit(1);
}

function shouldRetryInstagramRequest(status, raw) {
  if (status >= 500) {
    return true;
  }

  try {
    const payload = raw ? JSON.parse(raw) : {};
    return Number(payload?.error?.code) === 1;
  } catch {
    return false;
  }
}

async function fetchInstagramTokenInfo(accessToken, apiVersion) {
  const maxAttempts = Number(process.env.INSTAGRAM_REQUEST_MAX_ATTEMPTS || 4);
  const baseDelayMs = Number(process.env.INSTAGRAM_REQUEST_RETRY_DELAY_MS || 1500);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(
      `https://graph.instagram.com/${apiVersion}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
    );
    const raw = await response.text();

    if (response.ok) {
      return raw ? JSON.parse(raw) : {};
    }

    lastError = new Error(`Instagram token check failed with status ${response.status}: ${raw}`);
    if (!shouldRetryInstagramRequest(response.status, raw) || attempt === maxAttempts) {
      throw lastError;
    }

    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
  }

  throw lastError || new Error("Instagram token check failed");
}

async function main() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const expectedUserId = process.env.INSTAGRAM_IG_USER_ID || null;
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";

  if (!accessToken) {
    fail("Missing INSTAGRAM_ACCESS_TOKEN");
  }

  const payload = await fetchInstagramTokenInfo(accessToken, apiVersion);
  const idMatches = expectedUserId ? String(payload.id || "") === String(expectedUserId) : null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiVersion,
        instagramUser: payload,
        expectedUserId,
        idMatches,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  fail(error.message);
});
