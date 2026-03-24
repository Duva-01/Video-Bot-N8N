require("dotenv").config();

const crypto = require("crypto");
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

function getTikTokStatePath() {
  return path.resolve(process.env.TIKTOK_STATE_PATH || "tmp/tiktok-auth-state.json");
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sha256Base64Url(value) {
  return base64Url(crypto.createHash("sha256").update(value).digest());
}

function randomBase64Url(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getTikTokTokenStateFromEnv() {
  return {
    clientKey: process.env.TIKTOK_CLIENT_KEY || null,
    redirectUri: process.env.TIKTOK_REDIRECT_URI || null,
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || null,
    refreshToken: process.env.TIKTOK_REFRESH_TOKEN || null,
    openId: process.env.TIKTOK_OPEN_ID || null,
    expiresAt: process.env.TIKTOK_ACCESS_TOKEN_EXPIRES_AT || null,
    refreshExpiresAt: process.env.TIKTOK_REFRESH_TOKEN_EXPIRES_AT || null,
    scope: process.env.TIKTOK_AUTH_SCOPE || null,
  };
}

function getTikTokTokenState() {
  const statePath = getTikTokStatePath();
  const fileState = readJson(statePath) || {};
  const envState = getTikTokTokenStateFromEnv();
  return {
    ...fileState,
    ...Object.fromEntries(Object.entries(envState).filter(([, value]) => value)),
  };
}

function saveTikTokTokenState(payload) {
  const statePath = getTikTokStatePath();
  writeJson(statePath, payload);
  return statePath;
}

function createTikTokAuthorizationRequest() {
  const clientKey = getRequiredEnv("TIKTOK_CLIENT_KEY");
  const redirectUri = getRequiredEnv("TIKTOK_REDIRECT_URI");
  const scope = String(process.env.TIKTOK_AUTH_SCOPE || "user.info.basic,video.publish")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = sha256Base64Url(codeVerifier);
  const state = randomBase64Url(24);
  const statePath = getTikTokStatePath();
  const payload = {
    createdAt: new Date().toISOString(),
    clientKey,
    redirectUri,
    scope,
    codeVerifier,
    codeChallenge,
    state,
  };

  writeJson(statePath, payload);

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    ...payload,
    statePath,
    url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`,
  };
}

async function exchangeTikTokCodeForToken(code) {
  const clientKey = getRequiredEnv("TIKTOK_CLIENT_KEY");
  const clientSecret = getRequiredEnv("TIKTOK_CLIENT_SECRET");
  const redirectUri = getRequiredEnv("TIKTOK_REDIRECT_URI");
  const statePath = getTikTokStatePath();
  const state = readJson(statePath);

  if (!state?.codeVerifier) {
    throw new Error(`TikTok PKCE state not found at ${statePath}. Generate auth URL first.`);
  }

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: state.codeVerifier,
  });

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  if (!response.ok || payload.error) {
    throw new Error(`TikTok token exchange failed with status ${response.status}: ${raw}`);
  }

  const expiresAt = payload.expires_in
    ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
    : null;
  const refreshExpiresAt = payload.refresh_expires_in
    ? new Date(Date.now() + Number(payload.refresh_expires_in) * 1000).toISOString()
    : null;
  const merged = {
    ...state,
    exchangedAt: new Date().toISOString(),
    accessToken: payload.access_token || null,
    refreshToken: payload.refresh_token || null,
    openId: payload.open_id || null,
    scope: payload.scope || state.scope,
    expiresIn: payload.expires_in || null,
    refreshExpiresIn: payload.refresh_expires_in || null,
    expiresAt,
    refreshExpiresAt,
    raw: payload,
  };

  writeJson(statePath, merged);
  return merged;
}

async function refreshTikTokAccessToken({ refreshToken } = {}) {
  const clientKey = getRequiredEnv("TIKTOK_CLIENT_KEY");
  const clientSecret = getRequiredEnv("TIKTOK_CLIENT_SECRET");
  const currentState = getTikTokTokenState();
  const tokenToUse = refreshToken || currentState.refreshToken;

  if (!tokenToUse) {
    throw new Error("TikTok refresh token is missing");
  }

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokenToUse,
  });

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  if (!response.ok || payload.error) {
    throw new Error(`TikTok token refresh failed with status ${response.status}: ${raw}`);
  }

  const expiresAt = payload.expires_in
    ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
    : null;
  const refreshExpiresAt = payload.refresh_expires_in
    ? new Date(Date.now() + Number(payload.refresh_expires_in) * 1000).toISOString()
    : currentState.refreshExpiresAt || null;

  const merged = {
    ...currentState,
    refreshedAt: new Date().toISOString(),
    accessToken: payload.access_token || currentState.accessToken || null,
    refreshToken: payload.refresh_token || tokenToUse,
    openId: payload.open_id || currentState.openId || null,
    scope: payload.scope || currentState.scope || null,
    expiresIn: payload.expires_in || null,
    refreshExpiresIn: payload.refresh_expires_in || null,
    expiresAt,
    refreshExpiresAt,
    raw: payload,
  };

  saveTikTokTokenState(merged);
  return merged;
}

async function ensureFreshTikTokAccessToken({ logger = () => {}, forceRefresh = false } = {}) {
  const minValiditySeconds = Number(process.env.TIKTOK_TOKEN_MIN_VALIDITY_SECONDS || 3600);
  const currentState = getTikTokTokenState();
  const expiresAtMs = currentState.expiresAt ? Date.parse(currentState.expiresAt) : 0;
  const remainingSeconds = Number.isFinite(expiresAtMs) && expiresAtMs > 0 ? Math.floor((expiresAtMs - Date.now()) / 1000) : null;
  const shouldRefresh =
    forceRefresh ||
    !currentState.accessToken ||
    remainingSeconds === null ||
    remainingSeconds <= minValiditySeconds;

  if (!shouldRefresh) {
    return currentState;
  }

  logger("refreshing tiktok access token", {
    forceRefresh,
    remainingSeconds,
  });
  return refreshTikTokAccessToken();
}

module.exports = {
  createTikTokAuthorizationRequest,
  ensureFreshTikTokAccessToken,
  exchangeTikTokCodeForToken,
  getTikTokStatePath,
  getTikTokTokenState,
  refreshTikTokAccessToken,
  saveTikTokTokenState,
};
