const fs = require("fs");
const path = require("path");
const {
  createPool,
  ensureSchema,
  hasDatabase,
  markFailed,
  recordArtifact,
  recordEvent,
} = require("./content-db");

async function withOptionalPool(work) {
  if (!hasDatabase()) {
    return work(null);
  }

  const pool = createPool();
  try {
    await ensureSchema(pool);
    return await work(pool);
  } finally {
    await pool.end();
  }
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveTopicKey(payload) {
  return payload?.topic_key || payload?.key || null;
}

async function logStepEvent(pool, payload) {
  if (!pool) {
    return;
  }

  try {
    await recordEvent(pool, payload);
  } catch (error) {
    console.warn(`[script-observer][warn] event logging skipped: ${error.message}`);
  }
}

async function logArtifact(pool, payload) {
  if (!pool || !payload?.topic_key) {
    return;
  }

  try {
    await recordArtifact(pool, payload);
  } catch (error) {
    console.warn(`[script-observer][warn] artifact logging skipped: ${error.message}`);
  }
}

async function logFailure(pool, payload) {
  if (!pool || !payload?.topic_key) {
    return;
  }

  try {
    await markFailed(pool, payload);
    await recordEvent(pool, {
      topic_key: payload.topic_key,
      event_type: "step_failed",
      stage: payload.stage || "unknown",
      level: "error",
      source: payload.source || "script",
      message: payload.error || "Step failed",
      metadata: payload.metadata || {},
    });
  } catch (error) {
    console.warn(`[script-observer][warn] failure logging skipped: ${error.message}`);
  }
}

function topicKeyFromWorkspacePath(filePath) {
  const dir = filePath ? path.dirname(filePath) : null;
  if (!dir) {
    return null;
  }

  const scriptPath = path.join(dir, "script.json");
  const topicPath = path.join(dir, "topic.json");
  const script = readJsonIfExists(scriptPath);
  if (script?.topic_key) {
    return script.topic_key;
  }

  const topic = readJsonIfExists(topicPath);
  return topic?.key || null;
}

module.exports = {
  logArtifact,
  logFailure,
  logStepEvent,
  readJsonIfExists,
  resolveTopicKey,
  topicKeyFromWorkspacePath,
  withOptionalPool,
};
