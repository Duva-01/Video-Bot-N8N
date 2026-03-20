require("dotenv").config();

const http = require("http");
const { spawn } = require("child_process");
const httpProxy = require("http-proxy");

const publicHost = process.env.N8N_HOST || "0.0.0.0";
const publicPort = Number(process.env.N8N_PORT || process.env.PORT || 10000);
const internalHost = process.env.N8N_INTERNAL_HOST || "127.0.0.1";
const internalPort = Number(process.env.N8N_INTERNAL_PORT || 5678);
const keepAliveEnabled = (process.env.KEEP_ALIVE_ENABLED || "true") === "true";
const keepAliveIntervalMs = Number(process.env.KEEP_ALIVE_INTERVAL_MS || 300000);
const webhookUrl = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");

const proxy = httpProxy.createProxyServer({
  target: `http://${internalHost}:${internalPort}`,
  ws: true,
  xfwd: true,
});

let shuttingDown = false;

function log(message, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    message,
    ...meta,
  };
  console.log(JSON.stringify(payload));
}

function startN8n() {
  const env = {
    ...process.env,
    N8N_HOST: internalHost,
    N8N_PORT: String(internalPort),
    PORT: String(internalPort),
  };

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
    timestamp: new Date().toISOString(),
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
      const response = await fetch(target, {
        headers: {
          "user-agent": "render-keepalive/1.0",
        },
      });

      log("keep-alive ping completed", {
        target,
        statusCode: response.status,
      });
    } catch (error) {
      log("keep-alive ping failed", {
        target,
        error: error.message,
      });
    }
  }, keepAliveIntervalMs).unref();
}

const n8nProcess = startN8n();

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
  if (req.url === "/health") {
    const body = getHealthPayload();
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }

  proxy.web(req, res);
});

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(publicPort, publicHost, () => {
  log("proxy listening", {
    publicHost,
    publicPort,
    internalHost,
    internalPort,
  });
  startKeepAlive();
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  log("shutdown requested", { signal });
  server.close(() => {
    if (!n8nProcess.killed) {
      n8nProcess.kill(signal);
    }
  });

  setTimeout(() => {
    process.exit(0);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
