require("dotenv").config();

const { google } = require("googleapis");
const fetch = global.fetch || require("node-fetch");

const { ensureFreshInstagramAccessToken, verifyInstagramAccessToken } = require("../scripts/lib/instagram-token");
const { ensureFreshTikTokAccessToken } = require("../scripts/lib/tiktok-auth");

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function ymd(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function daysAgo(days) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumBy(items, key) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => total + toNumber(item?.[key]), 0);
}

function normalizeError(error) {
  return {
    message: error?.message || "Unknown error",
    status: error?.status || null,
    code: error?.code || null,
    raw: error?.raw || null,
  };
}

function createUnavailablePlatform(name, reason, error = null, extras = {}) {
  return {
    name,
    available: false,
    reason,
    error: error ? normalizeError(error) : null,
    warnings: [],
    account: null,
    metrics: {},
    charts: {},
    recentVideos: [],
    ...extras,
  };
}

async function readJson(response, label) {
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  const hasStructuredError =
    payload?.error &&
    typeof payload.error === "object" &&
    String(payload.error.code || "").toLowerCase() !== "ok";
  if (!response.ok || hasStructuredError) {
    const error = new Error(`${label} failed with status ${response.status}: ${raw}`);
    error.status = response.status;
    error.raw = raw;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function requestTikTok(pathname, { accessToken, method = "GET", fields = "", body = null } = {}) {
  const query = new URLSearchParams();
  if (fields) {
    query.set("fields", fields);
  }

  const url = `https://open.tiktokapis.com${pathname}${query.toString() ? `?${query.toString()}` : ""}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readJson(response, `TikTok request ${pathname}`);
}

async function requestInstagram(pathname, { accessToken, query = {} } = {}) {
  const params = new URLSearchParams({ access_token: accessToken });
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  const response = await fetch(`https://graph.instagram.com/${pathname}?${params.toString()}`);
  return readJson(response, `Instagram request ${pathname}`);
}

function mapYouTubeVideos(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id || null,
    title: item.snippet?.title || "Untitled",
    description: item.snippet?.description || "",
    publishedAt: isoDate(item.snippet?.publishedAt),
    thumbnailUrl:
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.default?.url ||
      null,
    url: item.id ? `https://www.youtube.com/watch?v=${item.id}` : null,
    duration: item.contentDetails?.duration || null,
    views: toNumber(item.statistics?.viewCount),
    likes: toNumber(item.statistics?.likeCount),
    comments: toNumber(item.statistics?.commentCount),
  }));
}

function buildYouTubeDailyRows(payload) {
  const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : [];
  return rows.map((row) => ({
    date: row[0],
    views: toNumber(row[1]),
    likes: toNumber(row[2]),
    comments: toNumber(row[3]),
    watchMinutes: toNumber(row[4]),
    subscribersGained: toNumber(row[5]),
  }));
}

function buildYouTubeTopVideoRows(payload) {
  const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : [];
  return rows.map((row) => ({
    videoId: row[0],
    views: toNumber(row[1]),
    likes: toNumber(row[2]),
    comments: toNumber(row[3]),
    watchMinutes: toNumber(row[4]),
  }));
}

async function loadYouTubeAnalytics() {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return createUnavailablePlatform("YouTube", "missing_credentials");
  }

  const auth = new google.auth.OAuth2(
    getRequiredEnv("YOUTUBE_CLIENT_ID"),
    getRequiredEnv("YOUTUBE_CLIENT_SECRET"),
  );
  auth.setCredentials({ refresh_token: getRequiredEnv("YOUTUBE_REFRESH_TOKEN") });

  const youtube = google.youtube({ version: "v3", auth });
  const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth });
  const warnings = [];

  const channelResponse = await youtube.channels.list({
    part: ["snippet", "statistics", "contentDetails"],
    mine: true,
  });

  const channel = channelResponse.data.items?.[0];
  if (!channel) {
    return createUnavailablePlatform("YouTube", "channel_not_found");
  }

  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads || null;
  let recentVideos = [];

  if (uploadsPlaylistId) {
    const playlistResponse = await youtube.playlistItems.list({
      part: ["contentDetails"],
      playlistId: uploadsPlaylistId,
      maxResults: 12,
    });
    const videoIds = (playlistResponse.data.items || [])
      .map((item) => item.contentDetails?.videoId)
      .filter(Boolean);

    if (videoIds.length) {
      const videosResponse = await youtube.videos.list({
        part: ["snippet", "statistics", "contentDetails"],
        id: videoIds.join(","),
        maxResults: 12,
      });
      recentVideos = mapYouTubeVideos(videosResponse.data.items || []).sort((a, b) => {
        return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
      });
    }
  }

  let daily = [];
  let topVideoMetrics = [];
  const endDate = ymd(daysAgo(1));
  const startDate = ymd(daysAgo(28));

  try {
    const dailyResponse = await youtubeAnalytics.reports.query({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,likes,comments,estimatedMinutesWatched,subscribersGained",
      dimensions: "day",
      sort: "day",
    });
    daily = buildYouTubeDailyRows(dailyResponse);
  } catch (error) {
    warnings.push({
      type: "analytics_unavailable",
      message: "No se pudieron cargar las metricas historicas de YouTube Analytics. Revisa los scopes del refresh token.",
      error: normalizeError(error),
    });
  }

  try {
    const topResponse = await youtubeAnalytics.reports.query({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,likes,comments,estimatedMinutesWatched",
      dimensions: "video",
      sort: "-views",
      maxResults: 10,
    });
    topVideoMetrics = buildYouTubeTopVideoRows(topResponse);
  } catch (error) {
    warnings.push({
      type: "top_videos_unavailable",
      message: "No se pudieron cargar los videos top desde YouTube Analytics.",
      error: normalizeError(error),
    });
  }

  const topMap = new Map(topVideoMetrics.map((item) => [item.videoId, item]));
  const mergedTopVideos = recentVideos.map((item) => ({ ...item, analytics: topMap.get(item.id) || null }));

  return {
    name: "YouTube",
    available: true,
    warnings,
    account: {
      channelId: channel.id || null,
      title: channel.snippet?.title || "YouTube",
      description: channel.snippet?.description || "",
      customUrl: channel.snippet?.customUrl || null,
      thumbnailUrl:
        channel.snippet?.thumbnails?.high?.url ||
        channel.snippet?.thumbnails?.medium?.url ||
        channel.snippet?.thumbnails?.default?.url ||
        null,
      publishedAt: isoDate(channel.snippet?.publishedAt),
    },
    metrics: {
      subscribers: toNumber(channel.statistics?.subscriberCount),
      totalViews: toNumber(channel.statistics?.viewCount),
      videoCount: toNumber(channel.statistics?.videoCount),
      recentViews: sumBy(daily, "views"),
      recentLikes: sumBy(daily, "likes"),
      recentComments: sumBy(daily, "comments"),
      recentWatchMinutes: sumBy(daily, "watchMinutes"),
      subscribersGained: sumBy(daily, "subscribersGained"),
    },
    charts: {
      daily,
    },
    recentVideos,
    topVideos: mergedTopVideos
      .sort((a, b) => (b.analytics?.views || b.views || 0) - (a.analytics?.views || a.views || 0))
      .slice(0, 6),
  };
}

async function loadTikTokAnalytics() {
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
    return createUnavailablePlatform("TikTok", "missing_credentials");
  }

  const tokenState = await ensureFreshTikTokAccessToken({ logger: () => {} });
  if (!tokenState?.accessToken) {
    return createUnavailablePlatform("TikTok", "missing_access_token");
  }

  const warnings = [];
  let userBasic = null;
  let userStats = null;
  let recentVideos = [];

  try {
    const basicResponse = await requestTikTok("/v2/user/info/", {
      accessToken: tokenState.accessToken,
      fields: "open_id,union_id,avatar_url,avatar_large_url,display_name",
    });
    userBasic = basicResponse.data?.user || null;
  } catch (error) {
    return createUnavailablePlatform("TikTok", "user_info_failed", error, {
      tokenExpiresAt: tokenState.expiresAt || null,
    });
  }

  try {
    const statsResponse = await requestTikTok("/v2/user/info/", {
      accessToken: tokenState.accessToken,
      fields: "follower_count,following_count,likes_count,video_count,profile_deep_link,is_verified,bio_description,username",
    });
    userStats = statsResponse.data?.user || null;
  } catch (error) {
    warnings.push({
      type: "stats_scope_missing",
      message: "TikTok no devolvio stats. Autoriza el scope user.info.stats para follower_count, likes_count y video_count.",
      error: normalizeError(error),
    });
  }

  try {
    const videoListResponse = await requestTikTok("/v2/video/list/", {
      accessToken: tokenState.accessToken,
      method: "POST",
      fields: "id,title,video_description,create_time,cover_image_url,share_url,duration,height,width,like_count,comment_count,share_count,view_count",
      body: { max_count: 12 },
    });
    recentVideos = (videoListResponse.data?.videos || []).map((item) => ({
      id: item.id || null,
      title: item.title || item.video_description || "Untitled",
      description: item.video_description || "",
      publishedAt: item.create_time ? new Date(Number(item.create_time) * 1000).toISOString() : null,
      thumbnailUrl: item.cover_image_url || null,
      url: item.share_url || null,
      duration: toNumber(item.duration),
      views: toNumber(item.view_count),
      likes: toNumber(item.like_count),
      comments: toNumber(item.comment_count),
      shares: toNumber(item.share_count),
      width: toNumber(item.width),
      height: toNumber(item.height),
    }));
  } catch (error) {
    warnings.push({
      type: "video_list_scope_missing",
      message: "TikTok no devolvio la lista de videos. Autoriza el scope video.list para metricas por video.",
      error: normalizeError(error),
    });
  }

  const sortedVideos = recentVideos
    .slice()
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
  const daily = sortedVideos
    .slice()
    .reverse()
    .map((item) => ({
      date: (item.publishedAt || "").slice(0, 10),
      views: item.views,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
    }));

  return {
    name: "TikTok",
    available: true,
    warnings,
    tokenExpiresAt: tokenState.expiresAt || null,
    account: {
      openId: userBasic?.open_id || tokenState.openId || null,
      username: userBasic?.username || null,
      displayName: userBasic?.display_name || "TikTok",
      avatarUrl: userBasic?.avatar_large_url || userBasic?.avatar_url || null,
      bio: userStats?.bio_description || null,
      verified: Boolean(userStats?.is_verified),
      profileUrl: userStats?.profile_deep_link || null,
    },
    metrics: {
      followers: toNumber(userStats?.follower_count),
      following: toNumber(userStats?.following_count),
      totalLikes: toNumber(userStats?.likes_count),
      videoCount: toNumber(userStats?.video_count || recentVideos.length),
      recentViews: sumBy(recentVideos, "views"),
      recentLikes: sumBy(recentVideos, "likes"),
      recentComments: sumBy(recentVideos, "comments"),
      recentShares: sumBy(recentVideos, "shares"),
    },
    charts: {
      recentVideos: daily,
    },
    recentVideos: sortedVideos,
    topVideos: sortedVideos.slice().sort((a, b) => b.views - a.views).slice(0, 6),
  };
}

async function loadInstagramAnalytics() {
  if (!process.env.INSTAGRAM_APP_ID || !process.env.INSTAGRAM_APP_SECRET || !process.env.INSTAGRAM_IG_USER_ID) {
    return createUnavailablePlatform("Instagram", "missing_credentials");
  }

  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION || "v25.0";
  const expectedUserId = process.env.INSTAGRAM_IG_USER_ID;
  const tokenInfo = await ensureFreshInstagramAccessToken({ logger: () => {} });
  const accessToken = tokenInfo.accessToken;

  if (!accessToken) {
    return createUnavailablePlatform("Instagram", "missing_access_token");
  }

  const warnings = [];
  let account = null;
  let media = [];
  let insights = [];

  try {
    const verified = await verifyInstagramAccessToken(accessToken, apiVersion, expectedUserId);
    account = {
      id: verified.id || expectedUserId,
      username: verified.username || null,
    };
  } catch (error) {
    return createUnavailablePlatform("Instagram", "token_verification_failed", error, {
      tokenExpiresAt: tokenInfo.expiresAt ? tokenInfo.expiresAt.toISOString() : null,
    });
  }

  try {
    const accountResponse = await requestInstagram(`${apiVersion}/${expectedUserId}`, {
      accessToken,
      query: {
        fields: "username,profile_picture_url,followers_count,follows_count,media_count,website,biography",
      },
    });
    account = {
      ...account,
      username: accountResponse.username || account.username,
      profilePictureUrl: accountResponse.profile_picture_url || null,
      followersCount: toNumber(accountResponse.followers_count),
      followsCount: toNumber(accountResponse.follows_count),
      mediaCount: toNumber(accountResponse.media_count),
      website: accountResponse.website || null,
      biography: accountResponse.biography || null,
    };
  } catch (error) {
    warnings.push({
      type: "account_fields_unavailable",
      message: "Instagram no devolvio followers/media_count desde el perfil.",
      error: normalizeError(error),
    });
  }

  try {
    const mediaResponse = await requestInstagram(`${apiVersion}/${expectedUserId}/media`, {
      accessToken,
      query: {
        fields:
          "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
        limit: 12,
      },
    });
    media = (mediaResponse.data || []).map((item) => ({
      id: item.id || null,
      title: item.caption ? item.caption.split("\n")[0].slice(0, 80) : "Instagram post",
      caption: item.caption || "",
      mediaType: item.media_type || null,
      mediaProductType: item.media_product_type || null,
      publishedAt: isoDate(item.timestamp),
      thumbnailUrl: item.thumbnail_url || item.media_url || null,
      url: item.permalink || null,
      likes: toNumber(item.like_count),
      comments: toNumber(item.comments_count),
    }));
  } catch (error) {
    warnings.push({
      type: "media_list_unavailable",
      message: "Instagram no devolvio la lista de media del perfil.",
      error: normalizeError(error),
    });
  }

  try {
    const insightResponse = await requestInstagram(`${apiVersion}/${expectedUserId}/insights`, {
      accessToken,
      query: {
        metric: "views,reach,accounts_engaged,total_interactions",
        period: "day",
      },
    });
    insights = Array.isArray(insightResponse.data) ? insightResponse.data : [];
  } catch (error) {
    warnings.push({
      type: "insights_unavailable",
      message:
        "Instagram no devolvio insights agregados. Revisa que el token tenga instagram_business_manage_insights y vuelve a autorizar la cuenta en Render.",
      error: normalizeError(error),
    });
  }

  const chartRows = [];
  const chartMap = new Map();
  insights.forEach((metric) => {
    const series = Array.isArray(metric.values) ? metric.values : [];
    if (!series.length && metric.total_value?.value !== undefined) {
      const key = "total";
      const current = chartMap.get(key) || { date: "Total" };
      current[metric.name] = toNumber(metric.total_value.value);
      chartMap.set(key, current);
      return;
    }

    series.forEach((point) => {
      const key = point.end_time ? String(point.end_time).slice(0, 10) : String(point.value);
      const current = chartMap.get(key) || { date: key };
      current[metric.name] = toNumber(point.value);
      chartMap.set(key, current);
    });
  });
  chartRows.push(...Array.from(chartMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date))));

  return {
    name: "Instagram",
    available: true,
    warnings,
    tokenExpiresAt: tokenInfo.expiresAt ? tokenInfo.expiresAt.toISOString() : null,
    account,
    metrics: {
      followers: toNumber(account?.followersCount),
      following: toNumber(account?.followsCount),
      mediaCount: toNumber(account?.mediaCount || media.length),
      recentLikes: sumBy(media, "likes"),
      recentComments: sumBy(media, "comments"),
      views: sumBy(chartRows, "views"),
      reach: sumBy(chartRows, "reach"),
      engaged: sumBy(chartRows, "accounts_engaged"),
      interactions: sumBy(chartRows, "total_interactions"),
    },
    charts: {
      insights: chartRows,
    },
    recentVideos: media.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()),
    topVideos: media.slice().sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, 6),
  };
}

function buildGlobalSummary(platforms) {
  const values = Object.values(platforms || {});
  return {
    connectedPlatforms: values.filter((item) => item.available).length,
    followers:
      toNumber(platforms.youtube?.metrics?.subscribers) +
      toNumber(platforms.instagram?.metrics?.followers) +
      toNumber(platforms.tiktok?.metrics?.followers),
    recentViews:
      toNumber(platforms.youtube?.metrics?.recentViews) +
      toNumber(platforms.instagram?.metrics?.views) +
      toNumber(platforms.tiktok?.metrics?.recentViews),
    recentInteractions:
      toNumber(platforms.youtube?.metrics?.recentLikes) +
      toNumber(platforms.youtube?.metrics?.recentComments) +
      toNumber(platforms.instagram?.metrics?.interactions) +
      toNumber(platforms.tiktok?.metrics?.recentLikes) +
      toNumber(platforms.tiktok?.metrics?.recentComments) +
      toNumber(platforms.tiktok?.metrics?.recentShares),
    trackedVideos:
      toNumber(platforms.youtube?.metrics?.videoCount) +
      toNumber(platforms.instagram?.metrics?.mediaCount) +
      toNumber(platforms.tiktok?.metrics?.videoCount),
  };
}

async function loadPlatformAnalytics() {
  const [youtube, instagram, tiktok] = await Promise.all([
    loadYouTubeAnalytics().catch((error) => createUnavailablePlatform("YouTube", "request_failed", error)),
    loadInstagramAnalytics().catch((error) => createUnavailablePlatform("Instagram", "request_failed", error)),
    loadTikTokAnalytics().catch((error) => createUnavailablePlatform("TikTok", "request_failed", error)),
  ]);

  const platforms = { youtube, instagram, tiktok };

  return {
    fetchedAt: new Date().toISOString(),
    global: buildGlobalSummary(platforms),
    platforms,
  };
}

module.exports = {
  loadPlatformAnalytics,
};
