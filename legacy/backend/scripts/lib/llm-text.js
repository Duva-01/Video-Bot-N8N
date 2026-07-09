require("dotenv").config();

const fetch = global.fetch || require("node-fetch");

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getTextProvider() {
  if (process.env.TEXT_PROVIDER) {
    return process.env.TEXT_PROVIDER;
  }

  if (process.env.GROQ_API_KEY) {
    return "groq";
  }

  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return "groq";
}

function getTextModel(provider) {
  if (provider === "groq") {
    return process.env.GROQ_TEXT_MODEL || "llama-3.1-8b-instant";
  }

  if (provider === "gemini") {
    return process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-lite";
  }

  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

function getGeminiText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini response did not include text output");
  }

  return text;
}

async function generateText({ prompt, provider = getTextProvider(), model = getTextModel(provider), temperature = 0.4 }) {
  if (provider === "groq") {
    const apiKey = getRequiredEnv("GROQ_API_KEY");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("Groq response did not include message content");
    }

    return { text, provider, model };
  }

  if (provider === "gemini") {
    const apiKey = getRequiredEnv("GEMINI_API_KEY");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return { text: getGeminiText(data), provider, model };
  }

  if (provider === "openai") {
    const apiKey = getRequiredEnv("OPENAI_API_KEY");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: prompt }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const text = data.output_text;
    if (!text) {
      throw new Error("OpenAI response did not include output_text");
    }

    return { text, provider, model };
  }

  throw new Error(`Unsupported text provider: ${provider}`);
}

module.exports = {
  generateText,
  getTextModel,
  getTextProvider,
};
