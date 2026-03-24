require("dotenv").config();

const fs = require("fs");
const { spawnSync } = require("child_process");

function fail(message) {
  console.error(`[generate-subtitles][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    fail(`JSON file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getAudioDuration(audioPath) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    fail(`Could not read audio duration from ${audioPath}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  const parsed = Number(result.stdout.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`Invalid audio duration for ${audioPath}`);
  }

  return parsed;
}

function normalizeWord(word) {
  return String(word || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function tokenize(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((raw) => ({
      raw,
      plain: raw.replace(/["()¿?¡!.,;:…]/g, ""),
      normalized: normalizeWord(raw),
    }))
    .filter((token) => token.raw);
}

function escapeAss(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

function formatAssTime(seconds) {
  const clamped = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function splitTokensIntoChunks(tokens, maxWords = 5) {
  const chunks = [];
  let current = [];

  for (const token of tokens) {
    current.push(token);
    const punctuationBreak = /[.!?…]$/.test(token.raw);
    const longEnough = current.length >= maxWords;
    const commaBreak = /[,;:]$/.test(token.raw) && current.length >= 3;

    if (punctuationBreak || longEnough || commaBreak) {
      chunks.push(current);
      current = [];
    }
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks.filter((chunk) => chunk.length);
}

function splitChunkIntoLines(chunk) {
  if (chunk.length <= 3) {
    return [chunk];
  }

  const breakAt = Math.ceil(chunk.length / 2);
  return [chunk.slice(0, breakAt), chunk.slice(breakAt)];
}

function distributeDurations(chunks, startAt, endAt) {
  const totalWindow = Math.max(0.6, endAt - startAt);
  const minimumChunkDuration = totalWindow >= 9 ? 0.9 : 0.75;
  const weights = chunks.map((chunk) => {
    const words = chunk.length;
    const chars = chunk.reduce((sum, token) => sum + token.raw.length, 0);
    return words * 1.15 + chars * 0.03;
  });

  let cursor = startAt;
  let remainingWeight = weights.reduce((sum, value) => sum + value, 0) || 1;

  return chunks.map((chunk, index) => {
    const remaining = chunks.length - index;
    const remainingWindow = Math.max(0, endAt - cursor);
    const reservedForTail = Math.max(0, (remaining - 1) * minimumChunkDuration);
    const maxDuration = remaining === 1 ? remainingWindow : Math.max(minimumChunkDuration, remainingWindow - reservedForTail);
    const targetDuration = remaining === 1 ? remainingWindow : (weights[index] / remainingWeight) * remainingWindow;
    const duration = remaining === 1
      ? remainingWindow
      : Math.max(minimumChunkDuration, Math.min(maxDuration, targetDuration));
    const start = cursor;
    const end = index === chunks.length - 1 ? endAt : Math.min(endAt, cursor + duration);
    cursor = end;
    remainingWeight -= weights[index];
    return { chunk, start, end };
  });
}

function pickVariantIndex(seedSource, totalVariants = 5) {
  const source = String(seedSource || "subtitle");
  let seed = 0;
  for (let index = 0; index < source.length; index += 1) {
    seed = (seed * 31 + source.charCodeAt(index)) % 2147483647;
  }
  return (seed % totalVariants) + 1;
}

function buildKeywordSet(script) {
  const set = new Set();
  const candidates = [
    ...(Array.isArray(script.visual_keywords) ? script.visual_keywords : []),
    script.topic,
    script.category,
  ];

  for (const value of candidates) {
    const normalized = normalizeWord(value);
    if (normalized && normalized.length >= 4) {
      set.add(normalized);
    }
  }

  return set;
}

function findKeywordHits(events, keywordSet) {
  const hits = [];

  events.forEach((event) => {
    const duration = Math.max(0.2, event.end - event.start);
    event.tokens.forEach((token, tokenIndex) => {
      if (!token.normalized || !keywordSet.has(token.normalized)) {
        return;
      }

      const time = event.start + ((tokenIndex + 1) / Math.max(event.tokens.length, 1)) * duration;
      hits.push({
        eventIndex: event.index,
        keyword: token.plain || token.raw,
        normalized: token.normalized,
        time: Number(time.toFixed(3)),
      });
    });
  });

  return hits;
}

function pickTargetedHits(keywordHits, totalDuration) {
  if (!keywordHits.length) {
    return [];
  }

  const sorted = [...keywordHits].sort((a, b) => a.time - b.time);
  const targets = [totalDuration * 0.5, totalDuration * 0.86];
  const selected = [];

  for (const target of targets) {
    const candidates = sorted.filter((hit) => !selected.includes(hit));
    if (!candidates.length) {
      break;
    }

    candidates.sort((a, b) => {
      const distanceA = Math.abs(a.time - target);
      const distanceB = Math.abs(b.time - target);
      if (distanceA !== distanceB) {
        return distanceA - distanceB;
      }
      return a.time - b.time;
    });

    const picked = candidates.find((candidate) => {
      if (!selected.length) {
        return true;
      }
      return Math.abs(candidate.time - selected[0].time) >= Math.max(3.5, totalDuration * 0.18);
    }) || candidates[0];

    selected.push(picked);
  }

  return selected.filter(Boolean).sort((a, b) => a.time - b.time).slice(0, 2);
}

function createAssHeader() {
  const baseFonts = ["Montserrat", "Poppins", "DejaVu Sans", "Arial", "Verdana"];
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
  ];

  for (let index = 0; index < 5; index += 1) {
    const font = baseFonts[index];
    const size = 48 + index * 2;
    lines.push(
      `Style: Default${index + 1},${font},${size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,3,0.5,2,110,110,250,1`,
    );
    lines.push(
      `Style: Hook${index + 1},${font},${size + 8},&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,3.4,0.6,2,96,96,300,1`,
    );
    lines.push(
      `Style: Badge${index + 1},${font},${size + 2},&H00FFFFFF,&H00FFFFFF,&H000000FF,&H000000FF,-1,0,0,0,100,100,0,0,3,0,0,2,110,110,250,1`,
    );
  }

  lines.push("", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text");
  return lines.join("\n");
}

function makeDialogue(start, end, style, text, override = "", layer = 0) {
  return `Dialogue: ${layer},${formatAssTime(start)},${formatAssTime(end)},${style},,0,0,0,,${override}${text}`;
}

function styleToken(token, eventStyle, highlightedWords) {
  if (token.normalized && highlightedWords.has(token.normalized)) {
    return `{\\b1\\1c&H00FFFFFF&\\3c&H0000FF&\\4c&H0000FF&\\bord8\\shad0\\fscx108\\fscy108}${escapeAss(token.raw)}{\\r${eventStyle}}`;
  }

  return escapeAss(token.raw);
}

function buildEventText(eventStyle, tokens, highlightedWords) {
  const lines = splitChunkIntoLines(tokens);
  return lines.map((line) => line.map((token) => styleToken(token, eventStyle, highlightedWords)).join(" ")).join("\\N");
}

function main() {
  const scriptPath = process.argv[2];
  const audioPath = process.argv[3];
  const outputPath = process.argv[4];

  if (!scriptPath || !fs.existsSync(scriptPath)) {
    fail(`Script file not found: ${scriptPath}`);
  }

  if (!audioPath || !fs.existsSync(audioPath)) {
    fail(`Audio file not found: ${audioPath}`);
  }

  if (!outputPath) {
    fail("Missing output path");
  }

  const script = readJson(scriptPath);
  const totalDuration = getAudioDuration(audioPath);
  const narrationTokens = tokenize(script.narration);
  const hookTokens = tokenize(script.hook || "");
  const keywordSet = buildKeywordSet(script);

  if (!narrationTokens.length) {
    fail("Script narration is empty");
  }

  const hookWordCount = Math.min(Math.max(hookTokens.length || 4, 4), Math.max(4, Math.floor(narrationTokens.length * 0.35)));
  const hookPart = narrationTokens.slice(0, hookWordCount);
  const restPart = narrationTokens.slice(hookWordCount);

  const hookChunks = splitTokensIntoChunks(hookPart, 4);
  const restChunks = splitTokensIntoChunks(restPart, 4);
  const hookDuration = Number(
    Math.max(2.6, Math.min(5.2, totalDuration * Math.min(0.28, hookPart.length / Math.max(narrationTokens.length, 1) + 0.08))).toFixed(3),
  );

  const hookTimed = distributeDurations(hookChunks, 0, Math.min(hookDuration, totalDuration));
  const restTimed = distributeDurations(restChunks, hookDuration, totalDuration);

  const events = [...hookTimed, ...restTimed].map((entry, index) => {
    const isHook = index < hookTimed.length;
    const stylePrefix = isHook ? "Hook" : "Default";
    const plainText = entry.chunk.map((token) => token.raw).join(" ");
    return {
      index,
      start: Number(entry.start.toFixed(3)),
      end: Number(entry.end.toFixed(3)),
      style: `${stylePrefix}${pickVariantIndex(`${script.topic || "topic"}-${plainText}-${index}`)}`,
      type: isHook ? "hook" : "subtitle",
      text: plainText,
      tokens: entry.chunk,
    };
  });

  const keywordHits = findKeywordHits(events.filter((event) => event.type !== "hook"), keywordSet);
  const selectedKeywordHits = pickTargetedHits(keywordHits, totalDuration);
  const highlightByEvent = new Map();
  selectedKeywordHits.forEach((hit) => {
    const current = highlightByEvent.get(hit.eventIndex) || new Set();
    current.add(hit.normalized);
    highlightByEvent.set(hit.eventIndex, current);
  });

  const typingWindows = events.map((event) => ({
    index: event.index,
    start: event.start,
    end: Number(Math.min(event.end, event.start + (event.type === "hook" ? 0.28 : 0.22)).toFixed(3)),
    type: event.type,
  }));

  const dialogues = events.map((event) => {
    const highlightedWords = highlightByEvent.get(event.index) || new Set();
    const renderedText = buildEventText(event.style, event.tokens, highlightedWords);
    const override = event.type === "hook"
      ? "{\\fad(80,100)\\fscx95\\fscy95\\t(0,180,\\fscx100\\fscy100)}"
      : "{\\fad(50,70)\\fscx97\\fscy97\\t(0,140,\\fscx100\\fscy100)}";
    return makeDialogue(event.start, event.end, event.style, renderedText, override, 0);
  });

  const assContent = [createAssHeader(), ...dialogues].join("\n");
  const eventPath = outputPath.replace(/\.ass$/i, ".events.json");
  const eventPayload = {
    totalDuration,
    hookDuration,
    typingWindows,
    keywordHits,
    selectedKeywordHits,
    events: events.map(({ tokens, ...event }) => event),
  };

  fs.mkdirSync(require("path").dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, assContent, "utf8");
  fs.writeFileSync(eventPath, JSON.stringify(eventPayload, null, 2));

  log("subtitles generated", {
    outputPath,
    eventPath,
    eventCount: events.length,
    selectedKeywordHits: selectedKeywordHits.map((hit) => ({ keyword: hit.keyword, time: hit.time })),
    totalDuration,
  });
}

main();
