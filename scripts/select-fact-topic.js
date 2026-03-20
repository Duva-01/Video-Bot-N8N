require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const topics = require("../data/fact-topics.json");
const { createPool, ensureSchema, hasDatabase, upsertSelection } = require("./lib/content-db");

function fail(message) {
  console.error(`[select-fact-topic][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      message,
      ...meta,
    }),
  );
}

function buildAllowedCategories() {
  const configured = (process.env.FACT_ALLOWED_CATEGORIES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length) {
    return configured;
  }

  return [...new Set(topics.map((item) => item.category))];
}

function buildCandidateList() {
  const allowedCategories = buildAllowedCategories();
  const filtered = allowedCategories.length ? topics.filter((item) => allowedCategories.includes(item.category)) : topics;

  if (filtered.length === 0) {
    fail("No fact topics available after applying FACT_ALLOWED_CATEGORIES");
  }

  return filtered;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getTopicMode() {
  return process.env.FACT_TOPIC_MODE || "dynamic-first";
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    fail("Gemini dynamic topic response was empty");
  }

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]+?)```/i) || trimmed.match(/```\s*([\s\S]+?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  fail("Gemini dynamic topic response did not contain valid JSON");
}

function getGeminiText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    fail("Gemini dynamic topic response did not include text");
  }

  return text;
}

async function getExistingTopicState(pool) {
  const { rows } = await pool.query(
    `
      SELECT topic_key, category, topic, angle
      FROM content_runs
      WHERE status IN ('selected', 'generated', 'published')
      ORDER BY selected_at DESC
      LIMIT 500
    `,
  );

  const usedKeys = new Set();
  const usedPairs = new Set();

  rows.forEach((row) => {
    usedKeys.add(row.topic_key);
    usedPairs.add(`${normalizeText(row.category)}|${normalizeText(row.topic)}|${normalizeText(row.angle)}`);
  });

  return {
    rows,
    usedKeys,
    usedPairs,
  };
}

function createDynamicPrompt(existingRows, allowedCategories) {
  const recent = existingRows
    .slice(0, 40)
    .map((row) => `- ${row.category} | ${row.topic} | ${row.angle}`)
    .join("\n");

  return [
    "Genera exactamente un topic nuevo para un YouTube Short de hechos curiosos.",
    "Debe ser sorprendente, concreto, facil de explicar en menos de 30 segundos y visualmente ilustrable con clips de stock.",
    "No puede repetir ninguno de los topics ya usados.",
    "No menciones portfolio, servicios, ventas ni llamadas a contratar nada.",
    `Categorias permitidas: ${allowedCategories.join(", ")}.`,
    "Devuelve solo JSON valido, sin markdown.",
    "Schema exacto:",
    "{",
    '  "category": "una categoria permitida",',
    '  "topic": "tema concreto en pocas palabras",',
    '  "angle": "enfoque curioso y especifico",',
    '  "search_hint": "consulta corta y visual para buscar clips"',
    "}",
    "Topics ya usados recientemente:",
    recent || "- ninguno",
  ].join("\n");
}

async function generateDynamicTopic(existingState, allowedCategories) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY for dynamic topic generation");
  }

  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-lite";
  const prompt = createDynamicPrompt(existingState.rows, allowedCategories);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const parsed = JSON.parse(extractJson(getGeminiText(data)));
  const category = String(parsed.category || "").trim();
  const topic = String(parsed.topic || "").trim();
  const angle = String(parsed.angle || "").trim();
  const searchHint = String(parsed.search_hint || "").trim();

  if (!allowedCategories.includes(category)) {
    throw new Error(`Gemini returned unsupported category: ${category}`);
  }

  if (topic.length < 4 || angle.length < 12) {
    throw new Error("Gemini returned an under-specified topic");
  }

  const key = `dynamic-${category}-${normalizeText(topic)}-${normalizeText(angle)}`.slice(0, 120);
  const uniquenessKey = `${normalizeText(category)}|${normalizeText(topic)}|${normalizeText(angle)}`;

  if (existingState.usedKeys.has(key)) {
    throw new Error(`Dynamic topic key already exists: ${key}`);
  }

  if (existingState.usedPairs.has(uniquenessKey)) {
    throw new Error("Dynamic topic duplicates an existing category/topic/angle combination");
  }

  return {
    key,
    category,
    topic,
    angle,
    search_hint: searchHint || topic,
    source: "dynamic-gemini",
  };
}

async function selectDynamicTopicFromDb(pool, existingState, candidates) {
  const allowedCategories = buildAllowedCategories();
  const attempts = Number(process.env.FACT_DYNAMIC_TOPIC_ATTEMPTS || 4);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const dynamicTopic = await generateDynamicTopic(existingState, allowedCategories);
      await upsertSelection(pool, dynamicTopic, {
        source: dynamicTopic.source,
        search_hint: dynamicTopic.search_hint,
      });
      return {
        ...dynamicTopic,
        reused_catalog: false,
      };
    } catch (error) {
      log("dynamic topic rejected", {
        attempt,
        error: error.message,
      });
    }
  }

  const availableCatalog = candidates.filter((item) => !existingState.usedKeys.has(item.key));
  if (!availableCatalog.length) {
    fail("Dynamic topic generation failed and the fixed catalog is exhausted. Add more topics or widen FACT_ALLOWED_CATEGORIES.");
  }

  const chosen = pickRandom(availableCatalog);
  await upsertSelection(pool, chosen, { source: "catalog-fallback" });
  return {
    ...chosen,
    reused_catalog: false,
  };
}

async function selectTopicFromDb(pool, candidates) {
  const existingState = await getExistingTopicState(pool);
  const mode = getTopicMode();

  if (mode !== "catalog-only") {
    return selectDynamicTopicFromDb(pool, existingState, candidates);
  }

  const available = candidates.filter((item) => !existingState.usedKeys.has(item.key));
  if (!available.length) {
    fail("All fact topics in the current catalog have already been used. Switch FACT_TOPIC_MODE or add more topics.");
  }

  const chosen = pickRandom(available);
  await upsertSelection(pool, chosen, { source: "catalog" });
  return {
    ...chosen,
    reused_catalog: false,
  };
}

function selectTopicWithoutDb(candidates) {
  return pickRandom(candidates);
}

async function main() {
  const outputPath = process.argv[2] || "/tmp-output/topic.json";
  const candidates = buildCandidateList();

  let selected;
  let usedDatabase = false;
  let pool;

  try {
    if (hasDatabase()) {
      usedDatabase = true;
      pool = createPool();
      await ensureSchema(pool);
      selected = await selectTopicFromDb(pool, candidates);
    } else {
      selected = selectTopicWithoutDb(candidates);
    }
  } finally {
    if (pool) {
      await pool.end();
    }
  }

  const payload = {
    ...selected,
    cta: process.env.VIDEO_DEFAULT_CTA || "Sigue la cuenta para mas hechos curiosos",
    duration_seconds: Number(process.env.VIDEO_DEFAULT_DURATION_SECONDS || 15),
    video_style: process.env.VIDEO_DEFAULT_STYLE || "rapido, curioso, directo",
    language: process.env.VIDEO_DEFAULT_LANGUAGE || "es",
    format: "curious-fact-short",
    used_database: usedDatabase,
    search_hint: selected.search_hint || selected.topic,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  log("fact topic selected", {
    outputPath,
    topicKey: payload.key,
    category: payload.category,
    topic: payload.topic,
    source: payload.source || "catalog",
    usedDatabase,
  });
}

main().catch((error) => {
  fail(error.message);
});
