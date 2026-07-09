require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { markGenerated } = require("./lib/content-db");
const { logArtifact, logFailure, logStepEvent, withOptionalPool } = require("./lib/script-observer");
const { generateText, getTextModel, getTextProvider } = require("./lib/llm-text");

function fail(message) {
  console.error(`[generate-script][error] ${message}`);
  process.exit(1);
}

function log(message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }));
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

  fail("Model response did not contain valid JSON text");
}

function cleanSentence(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensurePunctuation(value) {
  const cleaned = cleanSentence(value);
  if (!cleaned) {
    return "";
  }

  return /[.!?…]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function buildNarration(parsed, fallbackCta) {
  if (cleanSentence(parsed.narration)) {
    return cleanSentence(parsed.narration);
  }

  const parts = [
    ensurePunctuation(parsed.hook),
    ensurePunctuation(parsed.setup),
    ensurePunctuation(parsed.payoff),
    ensurePunctuation(parsed.cta_line || fallbackCta),
  ].filter(Boolean);

  return parts.join(" ");
}

async function main() {
  const outputPath = process.argv[2] || "/tmp/bot-videos/script.json";
  const topicFilePath = process.argv[3] && process.argv[3].endsWith(".json") ? process.argv[3] : null;
  const topicFile = topicFilePath && fs.existsSync(topicFilePath) ? JSON.parse(fs.readFileSync(topicFilePath, "utf8")) : null;
  const topic = topicFile?.topic || process.argv[3] || process.env.VIDEO_DEFAULT_TOPIC || "hechos curiosos";
  const durationSeconds = Number(topicFile?.duration_seconds || process.argv[4] || process.env.VIDEO_DEFAULT_DURATION_SECONDS || 25);
  const cta = topicFile?.cta || process.argv[5] || process.env.VIDEO_DEFAULT_CTA || "Sigue la cuenta para mas hechos curiosos";
  const style = topicFile?.video_style || process.argv[6] || process.env.VIDEO_DEFAULT_STYLE || "curioso, rapido, directo";
  const language = topicFile?.language || process.argv[7] || process.env.VIDEO_DEFAULT_LANGUAGE || "es";
  const provider = getTextProvider();
  const model = getTextModel(provider);
  const angle = topicFile?.angle || "un hecho curioso poco conocido";
  const category = topicFile?.category || "general";
  const topicKey = topicFile?.key || null;

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
    "La narracion debe abrir con un hook fuerte en la primera frase.",
    "Estructura obligatoria: hook corto, contexto minimo, dato sorprendente y cierre/remate.",
    "El hook debe despertar curiosidad o contradiccion en menos de 10 palabras.",
    "La narracion completa debe sonar natural, compacta y lista para locucion vertical.",
    "Devuelve solo JSON valido, sin markdown ni explicaciones.",
    "Schema esperado:",
    "{",
    '  "title": "titulo corto y atractivo",',
    '  "description": "descripcion corta para publicacion",',
    '  "hook": "frase inicial con tension o curiosidad en menos de 10 palabras",',
    '  "setup": "1 o 2 frases que den contexto rapido",',
    '  "payoff": "frase final con el dato o giro principal",',
    '  "cta_line": "cierre opcional muy corto alineado con el CTA dado",',
    '  "narration": "texto completo para locucion, integrando hook, setup, payoff y cierre, en menos de 90 palabras",',
    '  "visual_keywords": ["keyword1", "keyword2", "keyword3", "keyword4"],',
    '  "search_query": "consulta breve para buscar clips en Pexels",',
    '  "tags": ["tag1", "tag2", "tag3", "tag4"]',
    "}",
  ].join("\n");

  log("script generation starting", { outputPath, topic, durationSeconds, model, provider });

  await withOptionalPool(async (pool) => {
    await logStepEvent(pool, {
      topic_key: topicKey,
      event_type: "step_started",
      stage: "generate_script",
      level: "info",
      source: "generate-script",
      message: "Generating script",
      metadata: { provider, model, topic, category },
    });
  });

  let outputText;

  try {
    const result = await generateText({ prompt, provider, model, temperature: 0.3 });
    outputText = result.text;

    const parsed = JSON.parse(extractJson(outputText));
    const narration = buildNarration(parsed, cta);
    const payload = {
      topic_key: topicKey,
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
      hook: cleanSentence(parsed.hook),
      setup: cleanSentence(parsed.setup),
      payoff: cleanSentence(parsed.payoff),
      cta_line: cleanSentence(parsed.cta_line || cta),
      narration,
      visual_keywords: Array.isArray(parsed.visual_keywords) ? parsed.visual_keywords : [],
      search_query: parsed.search_query || topicFile?.search_hint || topic,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

    await withOptionalPool(async (pool) => {
      if (pool && payload.topic_key) {
        await markGenerated(pool, payload);
        await logArtifact(pool, {
          topic_key: payload.topic_key,
          artifact_type: "script_json",
          label: "Generated script payload",
          file_path: outputPath,
          mime_type: "application/json",
          metadata: { provider, model },
        });
      }

      await logStepEvent(pool, {
        topic_key: payload.topic_key,
        event_type: "step_completed",
        stage: "generate_script",
        level: "info",
        source: "generate-script",
        message: "Script generated",
        metadata: {
          provider,
          model,
          title: payload.title,
          hook: payload.hook,
          search_query: payload.search_query,
          tag_count: payload.tags.length,
        },
      });
    });

    log("script generation completed", {
      outputPath,
      title: payload.title,
      hook: payload.hook,
      searchQuery: payload.search_query,
      provider,
    });
  } catch (error) {
    await withOptionalPool(async (pool) => {
      await logFailure(pool, {
        topic_key: topicKey,
        stage: "generate_script",
        source: "generate-script",
        error: error.message,
        metadata: { provider, model },
      });
    });
    throw error;
  }
}

main().catch((error) => {
  fail(error.message);
});
