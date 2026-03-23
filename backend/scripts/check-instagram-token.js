require("dotenv").config();

const fetch = global.fetch || require("node-fetch");

function fail(message) {
  console.error(`[check-instagram-token][error] ${message}`);
  process.exit(1);
}

async function main() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const expectedUserId = process.env.INSTAGRAM_IG_USER_ID || null;
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";

  if (!accessToken) {
    fail("Missing INSTAGRAM_ACCESS_TOKEN");
  }

  const response = await fetch(
    `https://graph.instagram.com/${apiVersion}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
  );
  const raw = await response.text();

  if (!response.ok) {
    fail(`Instagram token check failed with status ${response.status}: ${raw}`);
  }

  const payload = raw ? JSON.parse(raw) : {};
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
