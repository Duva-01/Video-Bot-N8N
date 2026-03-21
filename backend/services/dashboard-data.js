require("dotenv").config();

const { createPool, ensureSchema, getDashboardSummary, getOperationsLog, hasDatabase } = require("../scripts/lib/content-db");

function pickLatestPublished(recentRuns) {
  const items = Array.isArray(recentRuns) ? recentRuns : [];
  return (
    items.find((item) => {
      const isPublished = item.status === "published";
      const hasVideo = item.youtube_url || item.youtube_video_id;
      const privacyStatus = String(item?.metadata?.privacy_status || "").toLowerCase();
      return isPublished && hasVideo && privacyStatus !== "private";
    }) || null
  );
}

function pickLatestGenerated(recentRuns) {
  const items = Array.isArray(recentRuns) ? recentRuns : [];
  return items.find((item) => item.youtube_url || item.youtube_video_id || item.status === "published" || item.status === "generated") || null;
}

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
        failed_videos: 0,
        categories_covered: 0,
        last_published_at: null,
      },
      byStatus: [],
      byCategory: [],
      recentRuns: [],
      recentEvents: [],
      artifactSummary: [],
      memorySamples: [],
      workflowSnapshot: null,
      latestPublished: null,
      operations: {
        events: [],
        executionLogs: [],
        artifacts: [],
        apiAudit: [],
        samples: [],
      },
    };
  }

  const pool = createPool();

  try {
    await ensureSchema(pool);
    const [summary, operations] = await Promise.all([getDashboardSummary(pool), getOperationsLog(pool, 30)]);
    return {
      ...basePayload,
      ...summary,
      latestGenerated: pickLatestGenerated(summary.recentRuns),
      latestPublished: pickLatestPublished(summary.recentRuns),
      operations,
    };
  } finally {
    await pool.end();
  }
}

module.exports = {
  loadDashboardData,
};
