require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const { createPool, ensureSchema, hasDatabase, markGenerated } = require("./lib/content-db");

function fail(message) {
  console.error(`[generate-script][error] ${message}`);
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

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extractJson(text) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]+?)```/i) || trimmed.match(/```\s*([\s\S]+?)```/);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  fail("OpenAI response did not contain valid JSON text");
}

function getGeminiText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    fail("Gemini response did not include text output");
  }

  return text;
}

async function main() {
  const outputPath = process.argv[2] || "/tmp-output/script.json";
  const topicFilePath = process.argv[3] && process.argv[3].endsWith(".json") ? process.argv[3] : null;
  const topicFile = topicFilePath && fs.existsSync(topicFilePath) ? JSON.parse(fs.readFileSync(topicFilePath, "utf8")) : null;
  const topic = topicFile?.topic || process.argv[3] || process.env.VIDEO_DEFAULT_TOPIC || "hechos curiosos";
  const durationSeconds = Number(topicFile?.duration_seconds || process.argv[4] || process.env.VIDEO_DEFAULT_DURATION_SECONDS || 25);
  const cta = topicFile?.cta || process.argv[5] || process.env.VIDEO_DEFAULT_CTA || "Sigue la cuenta para mas hechos curiosos";
  const style = topicFile?.video_style || process.argv[6] || process.env.VIDEO_DEFAULT_STYLE || "curioso, rapido, directo";
  const language = topicFile?.language || process.argv[7] || process.env.VIDEO_DEFAULT_LANGUAGE || "es";
  const provider = process.env.TEXT_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "openai");
  const model =
    provider === "gemini"
      ? process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-lite"
      : process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const angle = topicFile?.angle || "un hecho curioso poco conocido";
  const category = topicFile?.category || "general";

  const prompt = [
    "Genera un plan completo para un video corto vertical de facts y hechos curiosos para YouTube Shorts.",
    `Idioma: ${language}.`,
    `Categoria: ${category}.`,
    `Tema: ${topic}.`,
    `Angulo concreto: ${angle}.`,
    `Duracion objetivo: ${durationSeconds} segundos.`,
    `Estilo: ${style}.`,
    `CTA final: ${cta}.`,
    "Debe ser un hecho curioso concreto, verificable, sorprendente y facil de entender en menos de 30 segundos.",
    "No repitas el tema de forma generica; enfoca el guion en el angulo concreto indicado.",
    "No menciones portfolio, servicios, clientes, productos SaaS ni llamadas a contratar nada.",
    "No metas introducciones largas, relleno, ni opiniones.",
    "Devuelve solo JSON valido, sin markdown ni explicaciones.",
    "Schema esperado:",
    "{",
    '  "title": "titulo corto y atractivo",',
    '  "description": "descripcion corta para publicacion",',
    '  "narration": "texto completo para locucion en menos de 90 palabras",',
    '  "visual_keywords": ["keyword1", "keyword2", "keyword3", "keyword4"],',
    '  "search_query": "consulta breve para buscar clips en Pexels",',
    '  "tags": ["tag1", "tag2", "tag3", "tag4"]',
    "}",
  ].join("\n");

  log("openai script generation starting", {
    outputPath,
    topic,
    durationSeconds,
    model,
    provider,
  });

  let outputText;

  if (provider === "gemini") {
    const apiKey = getRequiredEnv("GEMINI_API_KEY");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      fail(`Gemini request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    outputText = getGeminiText(data);
  } else {
    const apiKey = getRequiredEnv("OPENAI_API_KEY");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
      }),
    });

    if (!response.ok) {
      fail(`OpenAI request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    outputText = data.output_text;

    if (!outputText) {
      fail("OpenAI response did not include output_text");
    }
  }

  const parsed = JSON.parse(extractJson(outputText));
  const payload = {
    topic_key: topicFile?.key || null,
    topic_source: topicFile?.source || "catalog",
    category,
    topic,
    angle,
    duration_seconds: durationSeconds,
    cta,
    style,
    language,
    title: parsed.title,
    description: parsed.description,
    narration: parsed.narration,
    visual_keywords: Array.isArray(parsed.visual_keywords) ? parsed.visual_keywords : [],
    search_query: parsed.search_query || topicFile?.search_hint || topic,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  if (hasDatabase() && payload.topic_key) {
    const pool = createPool();
    try {
      await ensureSchema(pool);
      await markGenerated(pool, payload);
    } finally {
      await pool.end();
    }
  }

  log("openai script generation completed", {
    outputPath,
    title: payload.title,
    searchQuery: payload.search_query,
    provider,
  });
}

main().catch((error) => {
  fail(error.message);
});
