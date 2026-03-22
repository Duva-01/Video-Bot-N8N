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
const {
  createPool: createContentPool,
  ensureSchema: ensureContentSchema,
  hasDatabase: hasContentDatabase,
  recordApiAudit,
  recordExecutionLog,
  recordSystemSample,
  upsertWorkflowSnapshot,
} = require("../scripts/lib/content-db");

const publicHost = process.env.N8N_HOST || "0.0.0.0";
const publicPort = Number(process.env.N8N_PORT || process.env.PORT || 10000);
const internalHost = process.env.N8N_INTERNAL_HOST || "127.0.0.1";
const internalPort = Number(process.env.N8N_INTERNAL_PORT || 5678);
const triggerWebhookEndpoint = (() => {
  const raw = String(
    process.env.N8N_TRIGGER_WEBHOOK_ENDPOINT ||
      process.env.N8N_TRIGGER_WEBHOOK_PATH ||
      "/webhook/facts-engine-run",
  ).trim();

  if (!raw) {
    return "/webhook/facts-engine-run";
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
})();
const keepAliveEnabled = (process.env.KEEP_ALIVE_ENABLED || "true") === "true";
const keepAliveIntervalMs = Number(process.env.KEEP_ALIVE_INTERVAL_MS || 300000);
const webhookUrl = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");
const authEnabled = (process.env.APP_AUTH_ENABLED || "true") === "true";
const authUser = process.env.APP_AUTH_USER || process.env.N8N_BASIC_AUTH_USER || "admin";
const authPassword = process.env.APP_AUTH_PASSWORD || process.env.N8N_BASIC_AUTH_PASSWORD || "securepassword";
const authCookieName = process.env.APP_AUTH_COOKIE_NAME || "bot_videos_session";
const frontendOrigin = process.env.APP_FRONTEND_ORIGIN || process.env.FRONTEND_ORIGIN || "*";
const authSecret =
  process.env.APP_SESSION_SECRET ||
  process.env.N8N_ENCRYPTION_KEY ||
  process.env.N8N_BASIC_AUTH_PASSWORD ||
  "change-me-in-render";
const n8nPath = (() => {
  const raw = process.env.N8N_PATH || "/";
  if (raw === "/") {
    return "/";
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
})();
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
let currentN8nEnv = null;
let restartingN8n = false;
let restartResolve = null;
let restartReject = null;
let cachedWorkflow = null;
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();
let runnerState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  workflowId: null,
  workflowName: null,
  exitCode: null,
  signal: null,
  stdoutTail: "",
  stderrTail: "",
  lastResult: null,
  lastError: null,
};
const n8nRootPassThroughPrefixes = [
  "/rest",
  "/types",
  "/assets",
  "/icons",
  "/static",
  "/binary-data",
];
const n8nRootAssetPattern =
  /^\/(?:posthog-hooks|manifest|sw|workbox-[^/]+|registerSW|favicon|robots)(?:[-.][^/]+)?\.(?:js|css|json|map|ico|txt)$|^\/[^/]+\.(?:js|css|map|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|json)$/i;

function getN8nDatabaseUrl() {
  return process.env.N8N_DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "";
}

function getN8nSchema() {
  return process.env.N8N_DB_SCHEMA || process.env.DB_POSTGRESDB_SCHEMA || "n8n";
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

async function queryN8nDatabase(queryText, params = []) {
  const connectionString = getN8nDatabaseUrl();
  if (!connectionString) {
    throw new Error("N8N database url is not configured");
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    return await pool.query(queryText, params);
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

async function withObservabilityPool(work) {
  if (!hasContentDatabase()) {
    return null;
  }

  const pool = createContentPool();
  try {
    await ensureContentSchema(pool);
    return await work(pool);
  } finally {
    await pool.end();
  }
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return forwarded[0] || req.socket?.remoteAddress || null;
}

async function writeApiAudit(req, action, statusCode, metadata = {}) {
  await withObservabilityPool(async (pool) => {
    await recordApiAudit(pool, {
      actor: readSession(req)?.username || null,
      action,
      path: req.url || "/",
      status_code: statusCode,
      ip_address: getClientIp(req),
      metadata,
    });
  }).catch(() => null);
}

async function writeExecutionLog(payload) {
  await withObservabilityPool(async (pool) => {
    await recordExecutionLog(pool, payload);
  }).catch(() => null);
}

async function writeWorkflowSnapshot(payload) {
  await withObservabilityPool(async (pool) => {
    await upsertWorkflowSnapshot(pool, payload);
  }).catch(() => null);
}

async function sampleProcessMetrics(reason = "interval") {
  const memory = process.memoryUsage();
  const now = Date.now();
  const cpuUsage = process.cpuUsage();
  const elapsedMicros = Math.max(1, (now - lastCpuTime) * 1000);
  const userDiff = cpuUsage.user - lastCpuUsage.user;
  const systemDiff = cpuUsage.system - lastCpuUsage.system;
  const cpuPercent = ((userDiff + systemDiff) / elapsedMicros) * 100;

  lastCpuUsage = cpuUsage;
  lastCpuTime = now;

  await withObservabilityPool(async (pool) => {
    await Promise.all([
      recordSystemSample(pool, {
        service: "render-backend",
        sample_type: "process",
        metric_name: "rss_mb",
        metric_value: memory.rss / 1024 / 1024,
        unit: "MB",
        metadata: { reason },
      }),
      recordSystemSample(pool, {
        service: "render-backend",
        sample_type: "process",
        metric_name: "heap_used_mb",
        metric_value: memory.heapUsed / 1024 / 1024,
        unit: "MB",
        metadata: { reason },
      }),
      recordSystemSample(pool, {
        service: "render-backend",
        sample_type: "process",
        metric_name: "cpu_percent",
        metric_value: cpuPercent,
        unit: "%",
        metadata: { reason },
      }),
    ]);
  }).catch(() => null);
}

function appendTail(previous, chunk) {
  const next = `${previous}${chunk}`;
  return next.length > 20000 ? next.slice(next.length - 20000) : next;
}

function extractLastJsonBlock(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return null;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    return null;
  }
}

function getRunnerSnapshot() {
  return {
    ...runnerState,
  };
}

function invalidateWorkflowCache() {
  cachedWorkflow = null;
}

function getAllowedOrigin(requestOrigin) {
  const allowedOrigins = String(frontendOrigin || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return "*";
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0];
}

function applyCorsHeaders(req, res) {
  const origin = getAllowedOrigin(req.headers.origin || "");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (origin !== "*") {
    res.setHeader("Vary", "Origin");
  }
}

async function buildN8nEnv() {
  const env = {
    ...process.env,
    N8N_HOST: internalHost,
    N8N_PORT: String(internalPort),
    PORT: String(internalPort),
    N8N_PATH: n8nPath,
    N8N_BASIC_AUTH_ACTIVE: "false",
    N8N_ENCRYPTION_KEY:
      process.env.N8N_ENCRYPTION_KEY ||
      process.env.APP_SESSION_SECRET ||
      process.env.N8N_BASIC_AUTH_PASSWORD ||
      authSecret,
  };

  if (
    webhookUrl &&
    (!process.env.N8N_EDITOR_BASE_URL ||
      process.env.N8N_EDITOR_BASE_URL.replace(/\/+$/, "") === webhookUrl.replace(/\/+$/, ""))
  ) {
    env.N8N_EDITOR_BASE_URL = n8nPath === "/" ? webhookUrl : `${webhookUrl}${n8nPath}`;
  }

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

function runN8nCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("n8n", args, {
      env: currentN8nEnv || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error(stderr || stdout || `n8n ${args.join(" ")} failed`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function resolveShellWorkflow() {
  if (process.env.N8N_SHELL_WORKFLOW_ID || process.env.SHELL_WORKFLOW_ID) {
    return {
      id: String(process.env.N8N_SHELL_WORKFLOW_ID || process.env.SHELL_WORKFLOW_ID),
      name: process.env.N8N_SHELL_WORKFLOW_NAME || process.env.SHELL_WORKFLOW_NAME || "workflow",
    };
  }

  if (cachedWorkflow && Date.now() - cachedWorkflow.cachedAt < 60 * 1000) {
    return cachedWorkflow.value;
  }

  const targetName = process.env.N8N_SHELL_WORKFLOW_NAME || process.env.SHELL_WORKFLOW_NAME || "";
  const schema = getN8nSchema();
  const result = await queryN8nDatabase(
    `select id, name, active, nodes
       from "${schema}".workflow_entity
      order by active desc, "updatedAt" desc, id desc`,
  );

  if (!Array.isArray(result.rows) || result.rows.length === 0) {
    throw new Error("No workflows found in n8n database");
  }

  const workflows = result.rows.map((row) => {
    let nodes = row.nodes;
    if (typeof nodes === "string") {
      try {
        nodes = JSON.parse(nodes);
      } catch (error) {
        nodes = [];
      }
    }

    return {
      id: String(row.id),
      name: row.name || "workflow",
      active: Boolean(row.active),
      nodes: Array.isArray(nodes) ? nodes : [],
    };
  });

  const chosen =
    workflows.find((item) => targetName && item.name === targetName) ||
    workflows.find((item) => item.active) ||
    workflows.find((item) => item.nodes.some((node) => node.name === "YouTube Upload")) ||
    workflows[0];

  if (!chosen?.id) {
    throw new Error("Unable to resolve workflow id");
  }

  const resolved = {
    id: String(chosen.id),
    name: chosen.name || "workflow",
  };

  cachedWorkflow = {
    cachedAt: Date.now(),
    value: resolved,
  };

  return resolved;
}

async function getWorkflowAutomationState() {
  const workflow = await resolveShellWorkflow();
  const schema = getN8nSchema();
  const result = await queryN8nDatabase(
    `select id, name, active, "createdAt", "updatedAt", "triggerCount"
       from "${schema}".workflow_entity
      where id = $1
      limit 1`,
    [workflow.id],
  );

  if (!result.rows[0]) {
    throw new Error(`Workflow ${workflow.id} not found`);
  }

  return {
    id: String(result.rows[0].id),
    name: result.rows[0].name || workflow.name || "workflow",
    active: Boolean(result.rows[0].active),
    createdAt: result.rows[0].createdAt,
    updatedAt: result.rows[0].updatedAt,
    triggerCount: Number(result.rows[0].triggerCount || 0),
  };
}

async function getRecentWorkflowExecutions(limit = 12, workflowId = null) {
  const workflow = workflowId ? { id: String(workflowId) } : await resolveShellWorkflow();
  const schema = getN8nSchema();
  const result = await queryN8nDatabase(
    `select id, status, finished, mode, "startedAt", "stoppedAt", "workflowId"
       from "${schema}".execution_entity
      where "workflowId" = $1
      order by "startedAt" desc
      limit $2`,
    [workflow.id, limit],
  );

  return result.rows.map((row) => {
    const startedAt = row.startedAt ? new Date(row.startedAt) : null;
    const stoppedAt = row.stoppedAt ? new Date(row.stoppedAt) : null;
    const durationMs =
      startedAt && stoppedAt && !Number.isNaN(startedAt.getTime()) && !Number.isNaN(stoppedAt.getTime())
        ? Math.max(0, stoppedAt.getTime() - startedAt.getTime())
        : null;

    return {
      id: Number(row.id),
      workflowId: String(row.workflowId),
      status: row.status || (row.finished ? "success" : "running"),
      finished: Boolean(row.finished),
      mode: row.mode || "unknown",
      startedAt: row.startedAt,
      stoppedAt: row.stoppedAt,
      durationMs,
      staleRunning:
        !row.finished &&
        startedAt &&
        !Number.isNaN(startedAt.getTime()) &&
        Date.now() - startedAt.getTime() > 1000 * 60 * 10,
    };
  });
}

async function waitForInternalN8nReady(timeoutMs = 30000) {
  const startedAt = Date.now();
  const target = `http://${internalHost}:${internalPort}/rest/settings`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await requestUrl(target);
      if (response.statusCode === 200) {
        return;
      }
    } catch (error) {
      // keep polling until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for n8n to become ready after restart");
}

async function restartN8nChild() {
  if (!n8nProcess) {
    n8nProcess = startN8n(currentN8nEnv || process.env);
    await waitForInternalN8nReady();
    return;
  }

  if (restartingN8n) {
    throw new Error("n8n restart already in progress");
  }

  await new Promise((resolve, reject) => {
    restartingN8n = true;
    restartResolve = resolve;
    restartReject = reject;

    try {
      n8nProcess.kill("SIGTERM");
    } catch (error) {
      restartingN8n = false;
      restartResolve = null;
      restartReject = null;
      reject(error);
    }
  });

  await waitForInternalN8nReady();
}

async function setWorkflowAutomation(active) {
  const workflow = await resolveShellWorkflow();
  await runN8nCli(["update:workflow", `--id=${workflow.id}`, `--active=${active ? "true" : "false"}`]);
  invalidateWorkflowCache();

  log("workflow automation updated", {
    workflowId: workflow.id,
    active,
  });

  await restartN8nChild();
  return getWorkflowAutomationState();
}

async function ensureWorkflowAutoActivation() {
  const workflowId =
    process.env.N8N_AUTO_ACTIVATE_WORKFLOW_ID ||
    process.env.N8N_SHELL_WORKFLOW_ID ||
    process.env.SHELL_WORKFLOW_ID ||
    "";

  if (!workflowId) {
    return;
  }

  const schema = getN8nSchema();
  await queryN8nDatabase(
    `update "${schema}".workflow_entity
        set active = true
      where id = $1 and active = false`,
    [workflowId],
  );

  invalidateWorkflowCache();
  log("workflow auto-activation ensured", {
    workflowId,
  });
}

async function triggerWorkflowExecution() {
  if (runnerState.running) {
    const error = new Error("A workflow execution is already running");
    error.statusCode = 409;
    throw error;
  }

  const workflow = await resolveShellWorkflow();
  runnerState = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    workflowId: workflow.id,
    workflowName: workflow.name,
    exitCode: null,
    signal: null,
    stdoutTail: "",
    stderrTail: "",
    lastResult: null,
    lastError: null,
  };

  log("shell run requested", {
    workflowId: workflow.id,
    workflowName: workflow.name,
  });

  await writeExecutionLog({
    workflow_id: workflow.id,
    topic_key: null,
    source: "shell-runner",
      level: "info",
    message: "Workflow execution requested from frontend",
    context: {
      workflowName: workflow.name,
      triggerMode: "webhook",
      webhookEndpoint: triggerWebhookEndpoint,
    },
  });

  await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: internalHost,
        port: internalPort,
        path: triggerWebhookEndpoint,
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          runnerState.running = false;
          runnerState.finishedAt = new Date().toISOString();
          runnerState.exitCode = response.statusCode || 0;
          runnerState.signal = null;
          runnerState.stdoutTail = appendTail(runnerState.stdoutTail, body);
          runnerState.lastResult = extractLastJsonBlock(body) || body || null;

          if ((response.statusCode || 500) >= 400) {
            runnerState.lastError = body || `Webhook trigger failed with status ${response.statusCode}`;
            void writeExecutionLog({
              workflow_id: workflow.id,
              source: "shell-runner",
              level: "error",
              message: "Workflow webhook trigger failed",
              context: {
                workflowName: workflow.name,
                statusCode: response.statusCode,
                responseBody: body,
              },
            });
            const error = new Error(runnerState.lastError);
            error.statusCode = response.statusCode || 500;
            reject(error);
            return;
          }

          runnerState.lastError = null;
          void writeExecutionLog({
            workflow_id: workflow.id,
            source: "shell-runner",
            level: "info",
            message: "Workflow webhook trigger accepted",
            context: {
              workflowName: workflow.name,
              statusCode: response.statusCode,
              responseBody: body,
            },
          });
          resolve();
        });
      },
    );

    request.on("error", (error) => {
      runnerState.running = false;
      runnerState.finishedAt = new Date().toISOString();
      runnerState.lastError = error.message;
      void writeExecutionLog({
        workflow_id: workflow.id,
        source: "shell-runner",
        level: "error",
        message: "Workflow webhook trigger failed to start",
        context: {
          workflowName: workflow.name,
          error: error.message,
        },
      });
      reject(error);
    });

    request.end("{}");
  });

  return getRunnerSnapshot();
}

async function loadShellData() {
  const workflow = await getWorkflowAutomationState().catch(() => null);
  const [dashboard, executions] = await Promise.all([
    loadDashboardData(),
    workflow ? getRecentWorkflowExecutions(12, workflow.id).catch(() => []) : [],
  ]);

  if (workflow) {
    const latestExecution = executions[0] || null;
    await writeWorkflowSnapshot({
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      active: workflow.active,
      trigger_count: workflow.triggerCount,
      last_execution_id: latestExecution?.id || null,
      last_status: latestExecution?.status || null,
      last_started_at: latestExecution?.startedAt || null,
      last_finished_at: latestExecution?.stoppedAt || null,
      metadata: {
        execution_count_visible: executions.length,
      },
    });
  }

  return {
    dashboard,
    health: JSON.parse(getHealthPayload()),
    runner: getRunnerSnapshot(),
    workflow,
    executions,
  };
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
    n8nProcess = null;

    if (restartingN8n) {
      restartingN8n = false;

      try {
        n8nProcess = startN8n(currentN8nEnv || env);
        if (restartResolve) {
          restartResolve();
        }
      } catch (error) {
        if (restartReject) {
          restartReject(error);
        }
      } finally {
        restartResolve = null;
        restartReject = null;
      }
      return;
    }

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
    routing: {
      adminLogin: null,
      n8nPath,
      apiBase: "/api",
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

function sendApiJson(req, res, statusCode, payload) {
  applyCorsHeaders(req, res);
  sendJson(res, statusCode, payload);
}

function isN8nRootPassThrough(pathname) {
  return n8nRootPassThroughPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`),
  );
}

function isN8nRootAsset(pathname) {
  return n8nRootAssetPattern.test(pathname);
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

function readSessionToken(token) {
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

function readBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length).trim();
}

function readSession(req) {
  const bearerPayload = readSessionToken(readBearerToken(req));
  if (bearerPayload) {
    return bearerPayload;
  }

  const cookies = parseCookies(req.headers.cookie);
  return readSessionToken(cookies[authCookieName]);
}

function readBasicAuth(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(authHeader.slice("Basic ".length).trim(), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch (error) {
    return null;
  }
}

function hasN8nAccess(req) {
  if (!authEnabled) {
    return true;
  }

  if (readSession(req)) {
    return true;
  }

  const basicAuth = readBasicAuth(req);
  if (!basicAuth) {
    return false;
  }

  return safeEqual(basicAuth.username, authUser) && safeEqual(basicAuth.password, authPassword);
}

function requestN8nBasicAuth(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Facts Engine n8n", charset="UTF-8"',
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  res.end("Authentication required");
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

function startTelemetrySampling() {
  sampleProcessMetrics("startup").catch(() => null);
  setInterval(() => {
    sampleProcessMetrics("interval").catch(() => null);
  }, Number(process.env.SYSTEM_SAMPLE_INTERVAL_MS || 60000)).unref();
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
  const isApiRequest = pathname.startsWith("/api/") || pathname === "/health";

  if (req.method === "OPTIONS" && isApiRequest) {
    applyCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/health") {
    const body = getHealthPayload();
    sendApiJson(req, res, 200, JSON.parse(body));
    return;
  }


  if (pathname === "/api/auth/login" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        const parsed = JSON.parse(body || "{}");
        const username = String(parsed.username || "");
        const password = String(parsed.password || "");

        if (!safeEqual(username, authUser) || !safeEqual(password, authPassword)) {
          void writeApiAudit(req, "api_login_failed", 401, { username });
          sendApiJson(req, res, 401, { error: "Usuario o contraseña incorrectos" });
          return;
        }

        void writeApiAudit(req, "api_login_success", 200, { username });
        sendApiJson(req, res, 200, {
          ok: true,
          token: createSessionToken(username),
          backendUrl: webhookUrl || "",
          healthUrl: `${webhookUrl}/health`,
          n8nUrl: `${webhookUrl}${n8nPath}`,
        });
      })
      .catch((error) => {
        sendApiJson(req, res, 400, { error: error.message });
      });
    return;
  }

  if (pathname === "/api/auth/logout") {
    sendApiJson(req, res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/dashboard") {
    if (authEnabled && !readSession(req)) {
      sendApiJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    loadDashboardData()
      .then((payload) => sendApiJson(req, res, 200, payload))
      .catch((error) => {
        log("dashboard api error", { error: error.message });
        sendApiJson(req, res, 500, { error: error.message });
      });
    return;
  }

  if (pathname === "/api/control-center") {
    if (authEnabled && !readSession(req)) {
      sendApiJson(req, res, 401, { error: "Unauthorized" });
      return;
    }

    loadShellData()
      .then((payload) => sendApiJson(req, res, 200, payload))
      .catch((error) => {
        log("control center api error", { error: error.message });
        sendApiJson(req, res, 500, { error: error.message });
      });
    return;
  }

  if (pathname === "/api/logs") {
    if (authEnabled && !readSession(req)) {
      sendApiJson(req, res, 401, { error: "Unauthorized" });
      return;
    }

    loadShellData()
      .then((payload) => sendApiJson(req, res, 200, payload))
      .catch((error) => {
        log("logs api error", { error: error.message });
        sendApiJson(req, res, 500, { error: error.message });
      });
    return;
  }

  if (pathname === "/api/run-now") {
    if (authEnabled && !readSession(req)) {
      sendApiJson(req, res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET") {
      sendApiJson(req, res, 200, getRunnerSnapshot());
      return;
    }

    if (req.method !== "POST") {
      sendApiJson(req, res, 405, { error: "Method not allowed" });
      return;
    }

    triggerWorkflowExecution()
      .then((payload) => {
        void writeApiAudit(req, "run_now_requested", 202, { workflowId: payload.workflowId, workflowName: payload.workflowName });
        sendApiJson(req, res, 202, payload);
      })
      .catch((error) => {
        void writeApiAudit(req, "run_now_failed", error.statusCode || 500, { error: error.message });
        sendApiJson(req, res, error.statusCode || 500, { error: error.message, runner: getRunnerSnapshot() });
      });
    return;
  }

  if (pathname === "/api/workflow-automation") {
    if (authEnabled && !readSession(req)) {
      sendApiJson(req, res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET") {
      getWorkflowAutomationState()
        .then((payload) => sendApiJson(req, res, 200, payload))
        .catch((error) => sendApiJson(req, res, 500, { error: error.message }));
      return;
    }

    if (req.method !== "POST") {
      sendApiJson(req, res, 405, { error: "Method not allowed" });
      return;
    }

    readBody(req)
      .then((body) => JSON.parse(body || "{}"))
      .then((payload) => setWorkflowAutomation(Boolean(payload.active)))
      .then((payload) => {
        void writeApiAudit(req, "workflow_automation_updated", 200, { workflowId: payload.id, active: payload.active });
        sendApiJson(req, res, 200, payload);
      })
      .catch((error) => {
        log("workflow automation api error", { error: error.message });
        void writeApiAudit(req, "workflow_automation_failed", 500, { error: error.message });
        sendApiJson(req, res, 500, { error: error.message });
      });
    return;
  }


  if (pathname === "/") {
    if (!hasN8nAccess(req)) {
      requestN8nBasicAuth(res);
      return;
    }
    proxy.web(req, res);
    return;
  }

  if (n8nPath !== "/" && pathname === n8nPath.slice(0, -1)) {
    res.writeHead(302, {
      Location: n8nPath,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }

  if (isN8nRootPassThrough(pathname)) {
    if (!hasN8nAccess(req)) {
      requestN8nBasicAuth(res);
      return;
    }
    proxy.web(req, res);
    return;
  }

  if (isN8nRootAsset(pathname)) {
    if (!hasN8nAccess(req)) {
      requestN8nBasicAuth(res);
      return;
    }
    proxy.web(req, res);
    return;
  }

  if (n8nPath === "/" || pathname.startsWith(n8nPath)) {
    if (!hasN8nAccess(req)) {
      requestN8nBasicAuth(res);
      return;
    }
    proxy.web(req, res);
    return;
  }

  proxy.web(req, res);
});

server.on("upgrade", (req, socket, head) => {
  if (!hasN8nAccess(req)) {
    socket.destroy();
    return;
  }

  if (n8nPath !== "/" && !req.url.startsWith(n8nPath)) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || `${publicHost}:${publicPort}`}`);
    if (isN8nRootPassThrough(parsedUrl.pathname) || isN8nRootAsset(parsedUrl.pathname)) {
      proxy.ws(req, socket, head);
      return;
    }
    socket.destroy();
    return;
  }

  proxy.ws(req, socket, head);
});

async function main() {
  const n8nEnv = await buildN8nEnv();
  currentN8nEnv = n8nEnv;
  await ensureWorkflowAutoActivation().catch((error) => {
    log("workflow auto-activation skipped", {
      error: error.message,
    });
  });
  n8nProcess = startN8n(n8nEnv);

  server.listen(publicPort, publicHost, () => {
    log("proxy listening", {
      publicHost,
      publicPort,
      internalHost,
      internalPort,
    });
    startKeepAlive();
    startTelemetrySampling();
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




