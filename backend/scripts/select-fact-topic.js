require("dotenv").config();

const fs = require("fs");
const path = require("path");
const topics = require("../data/fact-topics.json");
const { upsertSelection } = require("./lib/content-db");
const { logStepEvent, withOptionalPool } = require("./lib/script-observer");
const { generateText, getTextModel, getTextProvider } = require("./lib/llm-text");

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

function getCategoryHistoryWindow() {
  return Number(process.env.FACT_CATEGORY_HISTORY_WINDOW || 24);
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

function buildCategoryUsage(rows, allowedCategories) {
  const historyWindow = getCategoryHistoryWindow();
  const usage = new Map(allowedCategories.map((category) => [category, 0]));

  rows.slice(0, historyWindow).forEach((row) => {
    if (usage.has(row.category)) {
      usage.set(row.category, usage.get(row.category) + 1);
    }
  });

  return usage;
}

function pickBalancedCategory(rows, allowedCategories) {
  if (!allowedCategories.length) {
    fail("No allowed categories configured");
  }

  const usage = buildCategoryUsage(rows, allowedCategories);
  const minUsage = Math.min(...usage.values());
  let candidates = allowedCategories.filter((category) => usage.get(category) === minUsage);
  const lastCategory = rows[0]?.category || null;

  if (lastCategory && candidates.length > 1) {
    const withoutLast = candidates.filter((category) => category !== lastCategory);
    if (withoutLast.length) {
      candidates = withoutLast;
    }
  }

  return pickRandom(candidates);
}

function createDynamicPrompt(existingRows, allowedCategories, targetCategory) {
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
    `La categoria elegida debe ser exactamente: ${targetCategory}.`,
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

async function generateDynamicTopic(existingState, allowedCategories, targetCategory) {
  const provider = getTextProvider();
  const model = getTextModel(provider);
  const prompt = createDynamicPrompt(existingState.rows, allowedCategories, targetCategory);
  const result = await generateText({ prompt, provider, model, temperature: 0.4 });
  const parsed = JSON.parse(extractJson(result.text));
  const category = String(parsed.category || "").trim();
  const topic = String(parsed.topic || "").trim();
  const angle = String(parsed.angle || "").trim();
  const searchHint = String(parsed.search_hint || "").trim();

  if (!allowedCategories.includes(category)) {
    throw new Error(`Gemini returned unsupported category: ${category}`);
  }

  if (category !== targetCategory) {
    throw new Error(`Gemini returned category ${category} instead of required ${targetCategory}`);
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
    source: `dynamic-${provider}`,
  };
}

async function selectDynamicTopicFromDb(pool, existingState, candidates) {
  const allowedCategories = buildAllowedCategories();
  const attempts = Number(process.env.FACT_DYNAMIC_TOPIC_ATTEMPTS || 4);
  const targetCategory = pickBalancedCategory(existingState.rows, allowedCategories);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const dynamicTopic = await generateDynamicTopic(existingState, allowedCategories, targetCategory);
      await upsertSelection(pool, dynamicTopic, {
        source: dynamicTopic.source,
        search_hint: dynamicTopic.search_hint,
      });
      return {
        ...dynamicTopic,
        reused_catalog: false,
        target_category: targetCategory,
      };
    } catch (error) {
      log("dynamic topic rejected", {
        attempt,
        targetCategory,
        error: error.message,
      });
    }
  }

  const availableCatalog = candidates.filter((item) => !existingState.usedKeys.has(item.key));
  if (!availableCatalog.length) {
    fail("Dynamic topic generation failed and the fixed catalog is exhausted. Add more topics or widen FACT_ALLOWED_CATEGORIES.");
  }

  const categoryPool = availableCatalog.filter((item) => item.category === targetCategory);
  const chosen = pickRandom(categoryPool.length ? categoryPool : availableCatalog);
  await upsertSelection(pool, chosen, { source: "catalog-fallback" });
  return {
    ...chosen,
    reused_catalog: false,
    target_category: targetCategory,
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

  const availableCategories = [...new Set(available.map((item) => item.category))];
  const targetCategory = pickBalancedCategory(existingState.rows, availableCategories);
  const categoryPool = available.filter((item) => item.category === targetCategory);
  const chosen = pickRandom(categoryPool.length ? categoryPool : available);
  await upsertSelection(pool, chosen, { source: "catalog" });
  return {
    ...chosen,
    reused_catalog: false,
    target_category: targetCategory,
  };
}

function selectTopicWithoutDb(candidates) {
  return pickRandom(candidates);
}

async function main() {
  const outputPath = process.argv[2] || "/tmp/bot-videos/topic.json";
  const candidates = buildCandidateList();

  let selected;
  let usedDatabase = false;

  await withOptionalPool(async (pool) => {
    if (pool) {
      usedDatabase = true;
      selected = await selectTopicFromDb(pool, candidates);
      await logStepEvent(pool, {
        topic_key: selected.key,
        event_type: "topic_selected",
        stage: "select_topic",
        level: "info",
        source: "select-fact-topic",
        message: `Topic selected: ${selected.topic}`,
        metadata: {
          category: selected.category,
          angle: selected.angle,
          source: selected.source || "catalog",
        },
      });
      return;
    }

    selected = selectTopicWithoutDb(candidates);
  });

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
