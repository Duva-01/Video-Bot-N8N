const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getInstagramAppConfig() {
  return {
    appId: process.env.INSTAGRAM_APP_ID || "",
    appSecret: process.env.INSTAGRAM_APP_SECRET || "",
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI || "https://localhost/",
    apiVersion: process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0",
  };
}

function getInstagramTokenStatePath() {
  return path.resolve(process.cwd(), process.env.INSTAGRAM_TOKEN_STATE_PATH || "tmp/instagram-token-state.json");
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadInstagramTokenState() {
  const statePath = getInstagramTokenStatePath();
  if (!fs.existsSync(statePath)) {
    return null;
  }

  const payload = JSON.parse(fs.readFileSync(statePath, "utf8"));
  return {
    accessToken: payload.accessToken || payload.access_token || null,
    expiresAt: parseDateValue(payload.expiresAt || payload.expires_at),
    expiresIn: payload.expiresIn || payload.expires_in || null,
    refreshedAt: parseDateValue(payload.refreshedAt || payload.refreshed_at),
    source: payload.source || "state",
    tokenType: payload.tokenType || payload.token_type || null,
  };
}

function buildTokenState({ accessToken, expiresIn, source, tokenType }) {
  const now = new Date();
  const expiresAt = expiresIn ? new Date(now.getTime() + Number(expiresIn) * 1000) : null;
  return {
    accessToken,
    expiresIn: expiresIn ? Number(expiresIn) : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    refreshedAt: now.toISOString(),
    source: source || "unknown",
    tokenType: tokenType || null,
  };
}

function saveInstagramTokenState(state) {
  const statePath = getInstagramTokenStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

function compareInstagramTokens(left, right) {
  const leftExpiry = left?.expiresAt ? left.expiresAt.getTime() : 0;
  const rightExpiry = right?.expiresAt ? right.expiresAt.getTime() : 0;
  if (leftExpiry !== rightExpiry) {
    return leftExpiry - rightExpiry;
  }

  const leftRefreshed = left?.refreshedAt ? left.refreshedAt.getTime() : 0;
  const rightRefreshed = right?.refreshedAt ? right.refreshedAt.getTime() : 0;
  if (leftRefreshed !== rightRefreshed) {
    return leftRefreshed - rightRefreshed;
  }

  if (left?.source === "env" && right?.source !== "env") {
    return 1;
  }
  if (right?.source === "env" && left?.source !== "env") {
    return -1;
  }

  return 0;
}

function getConfiguredInstagramToken() {
  const envToken = {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || null,
    expiresAt: parseDateValue(process.env.INSTAGRAM_ACCESS_TOKEN_EXPIRES_AT),
    source: "env",
    refreshedAt: null,
  };
  const state = loadInstagramTokenState();
  const stateToken = state?.accessToken
    ? {
        accessToken: state.accessToken,
        expiresAt: state.expiresAt,
        source: "state",
        refreshedAt: state.refreshedAt,
      }
    : null;

  const candidates = [envToken, stateToken].filter((candidate) => candidate?.accessToken);
  if (!candidates.length) {
    return envToken;
  }

  return candidates.sort(compareInstagramTokens).at(-1);
}

async function readJsonResponse(response, errorPrefix) {
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const error = new Error(`${errorPrefix} failed with status ${response.status}: ${raw}`);
    error.status = response.status;
    error.raw = raw;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function exchangeInstagramCodeForShortLivedToken(code) {
  const { appId, appSecret, redirectUri } = getInstagramAppConfig();
  if (!appId || !appSecret) {
    throw new Error("Missing INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET");
  }

  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });

  return readJsonResponse(response, "Instagram code exchange");
}

async function exchangeShortLivedForLongLivedToken(accessToken) {
  const { appSecret } = getInstagramAppConfig();
  if (!appSecret) {
    throw new Error("Missing INSTAGRAM_APP_SECRET");
  }

  const response = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
      appSecret,
    )}&access_token=${encodeURIComponent(accessToken)}`,
  );

  return readJsonResponse(response, "Instagram long-lived token exchange");
}

async function refreshInstagramLongLivedToken(accessToken) {
  const response = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(
      accessToken,
    )}`,
  );

  return readJsonResponse(response, "Instagram token refresh");
}

async function verifyInstagramAccessToken(accessToken, apiVersion, expectedUserId = null) {
  const response = await fetch(
    `https://graph.instagram.com/${apiVersion}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
  );
  const payload = await readJsonResponse(response, "Instagram token verification");

  if (expectedUserId && String(payload.id || "") !== String(expectedUserId)) {
    throw new Error(`Instagram token verification returned unexpected user id ${payload.id || "unknown"}`);
  }

  return payload;
}

function isNearExpiry(expiresAt, minValiditySeconds) {
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() - Date.now() <= Number(minValiditySeconds || 0) * 1000;
}

async function ensureFreshInstagramAccessToken(options = {}) {
  const {
    logger,
    minValiditySeconds = Number(process.env.INSTAGRAM_TOKEN_MIN_VALIDITY_SECONDS || 86400),
    allowRefresh = String(process.env.INSTAGRAM_AUTO_REFRESH_TOKEN || "true").toLowerCase() === "true",
    forceRefresh = false,
  } = options;

  const current = getConfiguredInstagramToken();
  if (!current.accessToken) {
    throw new Error("Missing INSTAGRAM_ACCESS_TOKEN");
  }

  if (!allowRefresh && !forceRefresh) {
    return current;
  }

  if (!forceRefresh && !isNearExpiry(current.expiresAt, minValiditySeconds)) {
    return current;
  }

  if (logger) {
    logger("instagram token refresh starting", {
      source: current.source,
      expiresAt: current.expiresAt ? current.expiresAt.toISOString() : null,
      forceRefresh,
    });
  }

  const refreshed = await refreshInstagramLongLivedToken(current.accessToken);
  const state = buildTokenState({
    accessToken: refreshed.access_token,
    expiresIn: refreshed.expires_in,
    source: "refresh",
    tokenType: refreshed.token_type || null,
  });
  const statePath = saveInstagramTokenState(state);

  if (logger) {
    logger("instagram token refresh completed", {
      statePath,
      expiresAt: state.expiresAt,
      source: state.source,
    });
  }

  return {
    accessToken: state.accessToken,
    expiresAt: parseDateValue(state.expiresAt),
    source: state.source,
    statePath,
  };
}

module.exports = {
  buildTokenState,
  ensureFreshInstagramAccessToken,
  exchangeInstagramCodeForShortLivedToken,
  exchangeShortLivedForLongLivedToken,
  getConfiguredInstagramToken,
  getInstagramAppConfig,
  getInstagramTokenStatePath,
  loadInstagramTokenState,
  refreshInstagramLongLivedToken,
  saveInstagramTokenState,
  verifyInstagramAccessToken,
};
