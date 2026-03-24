require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function fail(message) {
  console.error(`[generate-sfx-track][error] ${message}`);
  process.exit(1);
}

function fileIfExists(targetPath) {
  if (!targetPath) {
    return null;
  }

  if (!fs.existsSync(targetPath)) {
    fail(`SFX file not found: ${targetPath}`);
  }

  return targetPath;
}

function resolveDefaultAsset(fileName) {
  return path.resolve(__dirname, "../assets/audio", fileName);
}

function getAudioDuration(audioPath) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath],
    { encoding: "utf8" },
  );

  if (result.status === 0) {
    const parsed = Number(result.stdout.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function formatSeconds(value) {
  return Number(value || 0).toFixed(3);
}

function selectKeywordHits(keywordHits, totalDuration) {
  const hits = [...keywordHits].sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
  if (!hits.length) {
    return [];
  }

  const targets = [totalDuration * 0.5, totalDuration * 0.86];
  const selected = [];

  for (const target of targets) {
    const candidates = hits.filter((hit) => !selected.includes(hit));
    if (!candidates.length) {
      break;
    }

    candidates.sort((a, b) => {
      const distanceA = Math.abs(Number(a.time || 0) - target);
      const distanceB = Math.abs(Number(b.time || 0) - target);
      if (distanceA !== distanceB) {
        return distanceA - distanceB;
      }
      return Number(a.time || 0) - Number(b.time || 0);
    });

    const picked = candidates.find((candidate) => {
      if (!selected.length) {
        return true;
      }
      return Math.abs(Number(candidate.time || 0) - Number(selected[0].time || 0)) >= Math.max(3.5, totalDuration * 0.18);
    }) || candidates[0];

    selected.push(picked);
  }

  return selected.sort((a, b) => Number(a.time || 0) - Number(b.time || 0)).slice(0, 2);
}

function buildWindowExpression(windows) {
  if (!windows.length) {
    return "0";
  }

  return windows.map((window) => `between(t,${formatSeconds(window.start)},${formatSeconds(window.end)})`).join("+");
}

function main() {
  const narrationPath = process.argv[2];
  const eventPath = process.argv[3];
  const outputPath = process.argv[4];
  const sampleRate = Number(process.env.SFX_SAMPLE_RATE || 24000);
  const hookSfxPath = fileIfExists(process.env.HOOK_SFX_FILE || resolveDefaultAsset("suspense.mp3"));
  const typingSfxPath = fileIfExists(process.env.SUBTITLE_TYPING_SFX_FILE || resolveDefaultAsset("writing.mp3"));
  const dingSfxPath = fileIfExists(process.env.KEYWORD_DING_SFX_FILE || resolveDefaultAsset("ding.mp3"));

  if (!narrationPath || !fs.existsSync(narrationPath)) {
    fail(`Narration file not found: ${narrationPath}`);
  }

  if (!eventPath || !fs.existsSync(eventPath)) {
    fail(`Subtitle event file not found: ${eventPath}`);
  }

  if (!outputPath) {
    fail("Missing output path");
  }

  const duration = getAudioDuration(narrationPath);
  if (!duration) {
    fail(`Could not determine narration duration for ${narrationPath}`);
  }

  const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const typingWindows = Array.isArray(eventData.typingWindows) ? eventData.typingWindows : [];
  const selectedKeywordHits = Array.isArray(eventData.selectedKeywordHits) ? eventData.selectedKeywordHits : [];
  const keywordHits = selectedKeywordHits.length
    ? selectedKeywordHits
    : selectKeywordHits(Array.isArray(eventData.keywordHits) ? eventData.keywordHits : [], duration);
  const hookDuration = Number(eventData.hookDuration || 1.2);

  const ffmpegArgs = [
    "-y",
    "-f",
    "lavfi",
    "-t",
    formatSeconds(duration + 0.1),
    "-i",
    `anullsrc=r=${sampleRate}:cl=mono`,
  ];

  const filterParts = [`[0:a]atrim=0:${formatSeconds(duration)},volume=0[silence]`];
  const mixInputs = ["[silence]"];
  let inputIndex = 1;

  if (hookSfxPath) {
    ffmpegArgs.push("-i", hookSfxPath);
    const hookVolume = Number(process.env.HOOK_SFX_VOLUME || 0.52);
    const hookFadeStart = Math.max(0, hookDuration - 0.35);
    filterParts.push(
      `[${inputIndex}:a]atrim=0:${formatSeconds(Math.max(0.35, hookDuration + 0.1))},afade=t=out:st=${formatSeconds(hookFadeStart)}:d=0.35,volume=${hookVolume}[hook]`,
    );
    mixInputs.push("[hook]");
    inputIndex += 1;
  }

  if (typingSfxPath && typingWindows.length) {
    ffmpegArgs.push("-stream_loop", "-1", "-i", typingSfxPath);
    const typingExpression = buildWindowExpression(typingWindows);
    const typingVolume = Number(process.env.SUBTITLE_TYPING_SFX_VOLUME || 0.12);
    filterParts.push(
      `[${inputIndex}:a]atrim=0:${formatSeconds(duration)},volume='if(gt(${typingExpression},0),${typingVolume},0)':eval=frame[typing]`,
    );
    mixInputs.push("[typing]");
    inputIndex += 1;
  }

  if (dingSfxPath && keywordHits.length) {
    ffmpegArgs.push("-i", dingSfxPath);
    const dingDuration = Number(process.env.KEYWORD_DING_DURATION || 0.35);
    const dingVolume = Number(process.env.KEYWORD_DING_VOLUME || 0.8);
    const dingStreams = [];

    keywordHits.forEach((hit, index) => {
      const delayMs = Math.max(0, Math.round(Number(hit.time || 0) * 1000));
      const label = `ding${index}`;
      filterParts.push(
        `[${inputIndex}:a]atrim=0:${formatSeconds(dingDuration)},volume=${dingVolume},adelay=${delayMs}|${delayMs}[${label}]`,
      );
      dingStreams.push(`[${label}]`);
    });

    if (dingStreams.length === 1) {
      filterParts.push(`${dingStreams[0]}anull[dings]`);
    } else {
      filterParts.push(`${dingStreams.join("")}amix=inputs=${dingStreams.length}:dropout_transition=0[dings]`);
    }

    mixInputs.push("[dings]");
  }

  filterParts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:dropout_transition=0,atrim=0:${formatSeconds(duration)}[mix]`);

  ffmpegArgs.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[mix]",
    "-c:a",
    "pcm_s16le",
    "-ar",
    String(sampleRate),
    outputPath,
  );

  const result = spawnSync("ffmpeg", ffmpegArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    fail(`ffmpeg failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`ffmpeg exited with status ${result.status}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      message: "sfx track generated",
      outputPath,
      duration,
      hookEnabled: Boolean(hookSfxPath),
      typingEnabled: Boolean(typingSfxPath && typingWindows.length),
      dingCount: dingSfxPath ? keywordHits.length : 0,
      dingTimes: keywordHits.map((hit) => Number(hit.time || 0)),
    }),
  );
}

main();
