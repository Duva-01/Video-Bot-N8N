require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..", "..");
const outputDir = path.join(rootDir, "tmp", "render-free-sim");
const imageTag = process.env.SIM_DOCKER_IMAGE || "bot-videos-render-free-sim";
const containerName = `bot-videos-render-free-${Date.now()}`;
const memoryLimit = process.env.SIM_RENDER_MEMORY || "512m";
const cpuLimit = process.env.SIM_RENDER_CPUS || "0.10";
const workDirInContainer = "/workspace";

function log(message, meta = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...meta,
    }),
  );
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.status !== 0) {
    const error = new Error(result.stderr || result.stdout || `${command} failed`);
    error.status = result.status;
    throw error;
  }

  return result.stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFile(name, content) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, name), content);
}

async function buildImage() {
  log("simulation build starting", {
    imageTag,
  });

  const child = spawn("docker", ["build", "-t", imageTag, "."], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docker build failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

async function startContainer() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const pipelineCommand = [
    `rm -rf ${workDirInContainer}/tmp/render-free-sim`,
    `mkdir -p ${workDirInContainer}/tmp/render-free-sim/clips`,
    `node backend/scripts/select-fact-topic.js ${workDirInContainer}/tmp/render-free-sim/topic.json`,
    `node backend/scripts/generate-script.js ${workDirInContainer}/tmp/render-free-sim/script.json ${workDirInContainer}/tmp/render-free-sim/topic.json`,
    `node backend/scripts/generate-voice.js ${workDirInContainer}/tmp/render-free-sim/script.json ${workDirInContainer}/tmp/render-free-sim/narration.wav`,
    `node backend/scripts/generate-subtitles.js ${workDirInContainer}/tmp/render-free-sim/script.json ${workDirInContainer}/tmp/render-free-sim/narration.wav ${workDirInContainer}/tmp/render-free-sim/subtitles.srt`,
    `node backend/scripts/fetch-pexels.js ${workDirInContainer}/tmp/render-free-sim/script.json ${workDirInContainer}/tmp/render-free-sim/clips`,
    `bash backend/scripts/build-short.sh ${workDirInContainer}/tmp/render-free-sim/final.mp4 ${workDirInContainer}/tmp/render-free-sim/narration.wav ${workDirInContainer}/tmp/render-free-sim/clips ${workDirInContainer}/tmp/render-free-sim/subtitles.srt`,
  ].join(" && ");

  const workspaceMount = `${rootDir.replace(/\\/g, "/")}:/workspace`;
  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "--memory",
    memoryLimit,
    "--cpus",
    cpuLimit,
    "--env-file",
    ".env",
    "-e",
    "RENDER_LOW_MEMORY_MODE=true",
    "-v",
    workspaceMount,
    "-w",
    workDirInContainer,
    imageTag,
    "bash",
    "-lc",
    pipelineCommand,
  ];

  const containerId = runSync("docker", args);
  log("simulation container started", {
    containerName,
    containerId,
    memoryLimit,
    cpuLimit,
  });
}

function readStats() {
  try {
    const output = runSync("docker", ["stats", "--no-stream", "--format", "{{json .}}", containerName]);
    return output ? JSON.parse(output) : null;
  } catch (error) {
    return null;
  }
}

function isContainerRunning() {
  try {
    return runSync("docker", ["inspect", "--format", "{{.State.Running}}", containerName]) === "true";
  } catch (error) {
    return false;
  }
}

function getContainerExitCode() {
  return Number(runSync("docker", ["inspect", "--format", "{{.State.ExitCode}}", containerName]));
}

function getContainerLogs() {
  return runSync("docker", ["logs", containerName], { maxBuffer: 1024 * 1024 * 10 });
}

function removeContainer() {
  try {
    runSync("docker", ["rm", "-f", containerName]);
  } catch (error) {
    return;
  }
}

function readFfprobe() {
  const outputPath = path.join(rootDir, "tmp", "render-free-sim", "final.mp4");
  if (!fs.existsSync(outputPath)) {
    return null;
  }

  const workspaceMount = `${rootDir.replace(/\\/g, "/")}:/workspace`;
  const output = runSync("docker", [
    "run",
    "--rm",
    "-v",
    workspaceMount,
    "-w",
    workDirInContainer,
    imageTag,
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=index,codec_type,codec_name,width,height",
    "-of",
    "json",
    `${workDirInContainer}/tmp/render-free-sim/final.mp4`,
  ]);

  return JSON.parse(output);
}

async function main() {
  const startedAt = Date.now();
  const statsLog = [];

  try {
    await buildImage();
    await startContainer();

    while (isContainerRunning()) {
      const stats = readStats();
      if (stats) {
        statsLog.push({
          ts: new Date().toISOString(),
          stats,
        });
        log("simulation stats", stats);
      }
      await sleep(2000);
    }

    const exitCode = getContainerExitCode();
    const logs = getContainerLogs();
    const ffprobe = readFfprobe();
    const summary = {
      containerName,
      imageTag,
      exitCode,
      memoryLimit,
      cpuLimit,
      durationMs: Date.now() - startedAt,
      finalVideoExists: fs.existsSync(path.join(rootDir, "tmp", "render-free-sim", "final.mp4")),
      ffprobe,
    };

    writeFile("container.log", logs);
    writeFile("stats.json", JSON.stringify(statsLog, null, 2));
    writeFile("summary.json", JSON.stringify(summary, null, 2));

    log("simulation finished", summary);

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } finally {
    removeContainer();
  }
}

main().catch((error) => {
  log("simulation failed", {
    error: error.message,
  });
  removeContainer();
  process.exit(1);
});
