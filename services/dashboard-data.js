require("dotenv").config();

const { createPool, ensureSchema, getDashboardSummary, hasDatabase } = require("../scripts/lib/content-db");

async function loadDashboardData() {
  const basePayload = {
    service: "bot-de-videos",
    mode: "youtube-facts-only",
    databaseConfigured: hasDatabase(),
    defaults: {
      durationSeconds: Number(process.env.VIDEO_DEFAULT_DURATION_SECONDS || 15),
      clipsPerVideo: Number(process.env.PEXELS_CLIPS_COUNT || 1),
      language: process.env.VIDEO_DEFAULT_LANGUAGE || "es",
      categories: (process.env.FACT_ALLOWED_CATEGORIES || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
  };

  if (!hasDatabase()) {
    return {
      ...basePayload,
      totals: {
        total_videos: 0,
        published_videos: 0,
        generated_videos: 0,
        selected_videos: 0,
        categories_covered: 0,
        last_published_at: null,
      },
      byStatus: [],
      byCategory: [],
      recentRuns: [],
      timeline: [],
    };
  }

  const pool = createPool();

  try {
    await ensureSchema(pool);
    const summary = await getDashboardSummary(pool);
    return {
      ...basePayload,
      ...summary,
    };
  } finally {
    await pool.end();
  }
}

module.exports = {
  loadDashboardData,
};
