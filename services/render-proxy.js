require("dotenv").config();

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const httpProxy = require("http-proxy");
const { loadDashboardData } = require("./dashboard-data");

const publicHost = process.env.N8N_HOST || "0.0.0.0";
const publicPort = Number(process.env.N8N_PORT || process.env.PORT || 10000);
const internalHost = process.env.N8N_INTERNAL_HOST || "127.0.0.1";
const internalPort = Number(process.env.N8N_INTERNAL_PORT || 5678);
const keepAliveEnabled = (process.env.KEEP_ALIVE_ENABLED || "true") === "true";
const keepAliveIntervalMs = Number(process.env.KEEP_ALIVE_INTERVAL_MS || 300000);
const webhookUrl = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");
const authEnabled = (process.env.APP_AUTH_ENABLED || "true") === "true";
const authUser = process.env.APP_AUTH_USER || process.env.N8N_BASIC_AUTH_USER || "admin";
const authPassword = process.env.APP_AUTH_PASSWORD || process.env.N8N_BASIC_AUTH_PASSWORD || "securepassword";
const authCookieName = process.env.APP_AUTH_COOKIE_NAME || "bot_videos_session";
const authSecret =
  process.env.APP_SESSION_SECRET ||
  process.env.N8N_ENCRYPTION_KEY ||
  process.env.N8N_BASIC_AUTH_PASSWORD ||
  "change-me-in-render";
const cookieSecure =
  process.env.APP_AUTH_COOKIE_SECURE === "true"
    ? true
    : process.env.APP_AUTH_COOKIE_SECURE === "false"
      ? false
      : webhookUrl.startsWith("https://");

const proxy = httpProxy.createProxyServer({
  target: `http://${internalHost}:${internalPort}`,
  ws: true,
  xfwd: true,
});

let shuttingDown = false;
const dashboardRoot = path.join(__dirname, "..", "public", "dashboard");
const staticFiles = {
  "/dashboard": "index.html",
  "/dashboard/": "index.html",
  "/dashboard/styles.css": "styles.css",
  "/dashboard/app.js": "app.js",
  "/login": path.join("..", "auth", "login.html"),
  "/auth/login.css": path.join("..", "auth", "login.css"),
  "/auth/login.js": path.join("..", "auth", "login.js"),
  "/ui/chrome.css": path.join("..", "ui", "chrome.css"),
  "/ui/chrome.js": path.join("..", "ui", "chrome.js"),
};

function getN8nDatabaseUrl() {
  return process.env.N8N_DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "";
}

function parsePostgresConnectionString(connectionString) {
  const parsed = new URL(connectionString);

  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "") || "neondb"),
  };
}

async function ensureN8nDatabaseSchema(connectionString, schema) {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  const safeSchema = String(schema || "n8n").replace(/"/g, "\"\"");

  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${safeSchema}"`);
  } finally {
    await pool.end();
  }
}

function log(message, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    message,
    ...meta,
  };
  console.log(JSON.stringify(payload));
}

async function buildN8nEnv() {
  const env = {
    ...process.env,
    N8N_HOST: internalHost,
    N8N_PORT: String(internalPort),
    PORT: String(internalPort),
    N8N_BASIC_AUTH_ACTIVE: "false",
    N8N_ENCRYPTION_KEY:
      process.env.N8N_ENCRYPTION_KEY ||
      process.env.APP_SESSION_SECRET ||
      process.env.N8N_BASIC_AUTH_PASSWORD ||
      authSecret,
  };

  const connectionString = getN8nDatabaseUrl();

  if (!connectionString) {
    log("n8n persistence using local sqlite", {
      reason: "database url not configured",
    });
    return env;
  }

  const parsed = parsePostgresConnectionString(connectionString);
  const schema = process.env.N8N_DB_SCHEMA || process.env.DB_POSTGRESDB_SCHEMA || "n8n";

  await ensureN8nDatabaseSchema(connectionString, schema);

  env.DB_TYPE = "postgresdb";
  env.DB_POSTGRESDB_HOST = parsed.host;
  env.DB_POSTGRESDB_PORT = String(parsed.port);
  env.DB_POSTGRESDB_DATABASE = parsed.database;
  env.DB_POSTGRESDB_USER = parsed.user;
  env.DB_POSTGRESDB_PASSWORD = parsed.password;
  env.DB_POSTGRESDB_SCHEMA = schema;
  env.DB_POSTGRESDB_SSL_ENABLED = "true";
  env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED = "false";
  env.DB_POSTGRESDB_POOL_SIZE = process.env.DB_POSTGRESDB_POOL_SIZE || "1";
  env.DB_POSTGRESDB_CONNECTION_TIMEOUT = process.env.DB_POSTGRESDB_CONNECTION_TIMEOUT || "20000";
  env.DB_POSTGRESDB_IDLE_CONNECTION_TIMEOUT = process.env.DB_POSTGRESDB_IDLE_CONNECTION_TIMEOUT || "30000";

  log("n8n persistence configured", {
    databaseHost: parsed.host,
    databaseName: parsed.database,
    schema,
  });

  return env;
}

function startN8n(env) {
  log("starting n8n child process", {
    internalHost,
    internalPort,
    databaseBacked: env.DB_TYPE === "postgresdb",
    dbSchema: env.DB_POSTGRESDB_SCHEMA || "sqlite",
  });

  const child = spawn("n8n", ["start"], {
    env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    log("n8n process exited", { code, signal });
    if (!shuttingDown) {
      process.exit(code ?? 1);
    }
  });

  child.on("error", (error) => {
    log("failed to start n8n", { error: error.message });
    process.exit(1);
  });

  return child;
}

function getHealthPayload() {
  return JSON.stringify({
    status: "ok",
    service: "bot-de-videos",
    n8nTarget: `http://${internalHost}:${internalPort}`,
    persistence: {
      n8nDatabase: Boolean(getN8nDatabaseUrl()),
      n8nSchema: process.env.N8N_DB_SCHEMA || process.env.DB_POSTGRESDB_SCHEMA || "n8n",
    },
    performance: {
      lowMemoryMode: (process.env.RENDER_LOW_MEMORY_MODE || "false") === "true",
      shortsWidth: Number(process.env.SHORTS_WIDTH || 540),
      shortsHeight: Number(process.env.SHORTS_HEIGHT || 960),
      shortsFps: Number(process.env.SHORTS_FPS || 20),
      ffmpegThreads: Number(process.env.FFMPEG_THREADS || 1),
    },
    timestamp: new Date().toISOString(),
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendStaticFile(res, fileName) {
  const fullPath = path.join(dashboardRoot, fileName);
  if (!fs.existsSync(fullPath)) {
    sendJson(res, 404, { error: "file not found" });
    return;
  }

  const contentType =
    fileName.endsWith(".css") ? "text/css; charset=utf-8" : fileName.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8";

  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": fileName.endsWith(".html") ? "no-store" : "public, max-age=300",
  });
  res.end(fs.readFileSync(fullPath));
}

function shouldDecorateHtml(req, pathname) {
  if (req.method !== "GET") {
    return false;
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/auth") || pathname === "/login") {
    return false;
  }

  const accept = String(req.headers.accept || "");
  return accept.includes("text/html") || pathname === "/";
}

function injectChrome(html) {
  const assets = [
    '<link rel="stylesheet" href="/ui/chrome.css" />',
    '<script src="/ui/chrome.js" defer></script>',
  ].join("");

  if (html.includes("/ui/chrome.js")) {
    return html;
  }

  if (html.includes("</head>")) {
    return html.replace("</head>", `${assets}</head>`);
  }

  return `${assets}${html}`;
}

function proxyDecoratedHtml(req, res) {
  const headers = {
    ...req.headers,
    host: `${internalHost}:${internalPort}`,
  };

  delete headers["accept-encoding"];

  const upstream = http.request(
    {
      hostname: internalHost,
      port: internalPort,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        const bodyBuffer = Buffer.concat(chunks);
        const contentType = String(upstreamRes.headers["content-type"] || "");
        const responseHeaders = { ...upstreamRes.headers };

        if (contentType.includes("text/html")) {
          const html = injectChrome(bodyBuffer.toString("utf8"));
          responseHeaders["content-length"] = Buffer.byteLength(html);
          delete responseHeaders["content-encoding"];
          res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
          res.end(html);
          return;
        }

        res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
        res.end(bodyBuffer);
      });
    },
  );

  upstream.on("error", (error) => {
    log("decorated proxy error", {
      error: error.message,
      method: req.method,
      url: req.url,
    });
    if (!res.headersSent) {
      sendJson(res, 502, { error: "n8n upstream unavailable" });
    }
  });

  req.pipe(upstream);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) {
        return acc;
      }

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", authSecret).update(value).digest("hex");
}

function createSessionToken(username) {
  const payload = {
    username,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 14,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function readSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[authCookieName];
  if (!token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.username || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function setSessionCookie(res, username) {
  const token = createSessionToken(username);
  const cookieParts = [
    `${authCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=1209600",
  ];

  if (cookieSecure) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearSessionCookie(res) {
  const cookieParts = [`${authCookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (cookieSecure) {
    cookieParts.push("Secure");
  }
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function isPublicPath(urlPath) {
  return (
    urlPath === "/health" ||
    urlPath === "/login" ||
    urlPath === "/auth/login" ||
    urlPath === "/auth/logout" ||
    urlPath === "/auth/login.css" ||
    urlPath === "/auth/login.js"
  );
}

function getRedirectTarget(rawUrl) {
  const candidate = rawUrl && rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl : "/";
  return candidate;
}

function redirectToLogin(req, res) {
  const next = encodeURIComponent(getRedirectTarget(req.url));
  res.writeHead(302, {
    Location: `/login?next=${next}`,
    "cache-control": "no-store",
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function requestUrl(target) {
  const client = target.startsWith("https://") ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      {
        method: "GET",
        headers: {
          "user-agent": "render-keepalive/1.0",
        },
      },
      (res) => {
        res.resume();
        resolve({ statusCode: res.statusCode || 0 });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

function startKeepAlive() {
  if (!keepAliveEnabled) {
    log("keep-alive disabled");
    return;
  }

  if (!webhookUrl) {
    log("keep-alive skipped because WEBHOOK_URL is empty");
    return;
  }

  const target = `${webhookUrl}/health`;
  log("keep-alive configured", { target, everyMs: keepAliveIntervalMs });

  setInterval(async () => {
    try {
      const response = await requestUrl(target);

      log("keep-alive ping completed", {
        target,
        statusCode: response.statusCode,
      });
    } catch (error) {
      log("keep-alive ping failed", {
        target,
        error: error.message,
      });
    }
  }, keepAliveIntervalMs).unref();
}

let n8nProcess = null;

proxy.on("error", (error, req, res) => {
  log("proxy error", {
    error: error.message,
    method: req?.method,
    url: req?.url,
  });

  if (res && !res.headersSent) {
    res.writeHead(502, { "content-type": "application/json" });
  }

  if (res && !res.writableEnded) {
    res.end(
      JSON.stringify({
        error: "n8n upstream unavailable",
      }),
    );
  }
});

const server = http.createServer((req, res) => {
  const hostHeader = req.headers.host || `${publicHost}:${publicPort}`;
  const parsedUrl = new URL(req.url, `http://${hostHeader}`);
  const pathname = parsedUrl.pathname;

  if (pathname === "/health") {
    const body = getHealthPayload();
    sendJson(res, 200, JSON.parse(body));
    return;
  }

  if (pathname === "/auth/logout") {
    clearSessionCookie(res);
    res.writeHead(302, {
      Location: "/login",
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  if (pathname === "/auth/login" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        const parsed = JSON.parse(body || "{}");
        const username = String(parsed.username || "");
        const password = String(parsed.password || "");
        const next = getRedirectTarget(parsed.next);

        if (!safeEqual(username, authUser) || !safeEqual(password, authPassword)) {
          sendJson(res, 401, { error: "Usuario o contraseña incorrectos" });
          return;
        }

        setSessionCookie(res, username);
        sendJson(res, 200, { ok: true, redirect: next });
      })
      .catch((error) => {
        sendJson(res, 400, { error: error.message });
      });
    return;
  }

  if (pathname === "/api/dashboard") {
    if (authEnabled && !readSession(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    loadDashboardData()
      .then((payload) => sendJson(res, 200, payload))
      .catch((error) => {
        log("dashboard api error", { error: error.message });
        sendJson(res, 500, { error: error.message });
      });
    return;
  }

  if (pathname === "/login" && authEnabled && readSession(req)) {
    res.writeHead(302, {
      Location: "/",
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  if (staticFiles[pathname]) {
    sendStaticFile(res, staticFiles[pathname]);
    return;
  }

  if (authEnabled && !isPublicPath(pathname)) {
    const session = readSession(req);
    if (!session) {
      redirectToLogin(req, res);
      return;
    }
  }

  if (shouldDecorateHtml(req, pathname)) {
    proxyDecoratedHtml(req, res);
    return;
  }

  proxy.web(req, res);
});

server.on("upgrade", (req, socket, head) => {
  if (authEnabled && !readSession(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head);
});

async function main() {
  const n8nEnv = await buildN8nEnv();
  n8nProcess = startN8n(n8nEnv);

  server.listen(publicPort, publicHost, () => {
    log("proxy listening", {
      publicHost,
      publicPort,
      internalHost,
      internalPort,
    });
    startKeepAlive();
  });
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  log("shutdown requested", { signal });
  server.close(() => {
    if (n8nProcess && !n8nProcess.killed) {
      n8nProcess.kill(signal);
    }
  });

  setTimeout(() => {
    process.exit(0);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  log("startup failed", {
    error: error.message,
  });
  process.exit(1);
});
