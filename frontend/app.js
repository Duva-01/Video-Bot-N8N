(function () {
  const TOKEN_KEY = "facts_engine_token";
  const API_BASE_KEY = "facts_engine_api_base";
  const views = ["global", "youtube", "instagram", "tiktok", "console"];

  const loginView = document.getElementById("loginView");
  const appView = document.getElementById("appView");
  const loginForm = document.getElementById("loginForm");
  const loginMessage = document.getElementById("loginMessage");
  const apiBaseUrlInput = document.getElementById("apiBaseUrl");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");

  let refreshTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function getApiBaseUrl() {
    return String(window.localStorage.getItem(API_BASE_KEY) || "").replace(/\/+$/, "");
  }

  function setApiBaseUrl(value) {
    const normalized = String(value || "").replace(/\/+$/, "");
    window.localStorage.setItem(API_BASE_KEY, normalized);
    return normalized;
  }

  function getToken() {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(value) {
    window.localStorage.setItem(TOKEN_KEY, value);
  }

  function clearSession() {
    window.localStorage.removeItem(TOKEN_KEY);
  }

  function setAuthenticated(authenticated) {
    loginView.style.display = authenticated ? "none" : "block";
    appView.classList.toggle("app-shell--hidden", !authenticated);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function formatCompactDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("es-ES", { month: "short", day: "numeric" }).format(date);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
  }

  function getStatusClass(state) {
    const normalized = String(state || "").toLowerCase();
    if (["ok", "active", "available", "published", "connected"].includes(normalized)) {
      return "status-pill status-pill--success";
    }
    if (["warning", "limited", "configured"].includes(normalized)) {
      return "status-pill status-pill--warn";
    }
    return "status-pill status-pill--error";
  }

  function platformAccent(platformKey) {
    if (platformKey === "youtube") return "#ff5a36";
    if (platformKey === "instagram") return "#f0ba49";
    return "#11b18a";
  }

  async function apiFetch(path, options = {}) {
    const token = getToken();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error("Missing API base URL");
    }

    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    return payload;
  }

  function setActiveView(view, syncUrl) {
    const selected = views.includes(view) ? view : "global";
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("view--active", panel.getAttribute("data-view-panel") === selected);
    });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("nav-tab--active", button.getAttribute("data-view") === selected);
    });

    if (syncUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", selected);
      window.history.replaceState({}, "", url);
    }
  }

  function makeKpiCards(items) {
    if (!items.length) {
      return '<div class="empty-state">No metrics yet.</div>';
    }

    return items
      .map(
        (item) => `
          <article class="kpi-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
          </article>
        `,
      )
      .join("");
  }

  function createLineChart(series, valueKey, color) {
    if (!Array.isArray(series) || series.length === 0) {
      return '<div class="empty-state small-empty">No time series available.</div>';
    }

    const width = 640;
    const height = 220;
    const padding = 20;
    const values = series.map((item) => Number(item[valueKey] || 0));
    const max = Math.max(...values, 1);
    const stepX = values.length === 1 ? 0 : (width - padding * 2) / (values.length - 1);

    const points = values
      .map((value, index) => {
        const x = padding + index * stepX;
        const y = height - padding - (value / max) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(" ");

    const labels = series
      .filter((_, index) => index === 0 || index === series.length - 1 || index === Math.floor(series.length / 2))
      .map((item, index) => {
        const sourceIndex = index === 0 ? 0 : index === 1 && series.length > 2 ? Math.floor(series.length / 2) : series.length - 1;
        const x = padding + sourceIndex * stepX;
        return `<text x="${x}" y="${height - 4}" text-anchor="middle">${escapeHtml(
          formatCompactDate(item.date || item.publishedAt || item.label),
        )}</text>`;
      })
      .join("");

    return `
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(valueKey)} chart">
        <defs>
          <linearGradient id="chart-gradient-${escapeHtml(valueKey)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.32"></stop>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <polyline class="line-chart__grid" points="${padding},${padding} ${padding},${height - padding} ${width - padding},${height - padding}"></polyline>
        <polyline class="line-chart__area" points="${padding},${height - padding} ${points} ${width - padding},${height - padding}" fill="url(#chart-gradient-${escapeHtml(
          valueKey,
        )})"></polyline>
        <polyline class="line-chart__line" points="${points}" style="--chart-color:${color}"></polyline>
        ${labels}
      </svg>
    `;
  }

  function createWarnings(warnings) {
    if (!Array.isArray(warnings) || warnings.length === 0) {
      return '<div class="empty-state small-empty">No warnings.</div>';
    }

    return warnings
      .map(
        (warning) => `
          <article class="warning-item">
            <strong>${escapeHtml(warning.type || "warning")}</strong>
            <p>${escapeHtml(warning.message || "Unknown warning")}</p>
          </article>
        `,
      )
      .join("");
  }

  function createVideoCards(videos, accentColor) {
    if (!Array.isArray(videos) || videos.length === 0) {
      return '<div class="empty-state small-empty">No videos available.</div>';
    }

    return `
      <div class="video-grid">
        ${videos
          .map(
            (video) => `
              <article class="video-card">
                ${
                  video.thumbnailUrl
                    ? `<div class="video-card__thumb" style="background-image:url('${escapeHtml(video.thumbnailUrl)}')"></div>`
                    : '<div class="video-card__thumb video-card__thumb--empty"></div>'
                }
                <div class="video-card__body">
                  <span class="video-card__date">${escapeHtml(formatCompactDate(video.publishedAt))}</span>
                  <h4>${escapeHtml(video.title || "Untitled")}</h4>
                  <div class="video-card__stats">
                    <span style="--chip-accent:${accentColor}">${formatNumber(video.views || video.likes || 0)} views</span>
                    <span>${formatNumber(video.likes || 0)} likes</span>
                    <span>${formatNumber(video.comments || 0)} comments</span>
                  </div>
                  ${video.url ? `<a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">Open post</a>` : ""}
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function createTopTable(videos, accentColor) {
    if (!Array.isArray(videos) || videos.length === 0) {
      return '<div class="empty-state small-empty">No top content available.</div>';
    }

    return `
      <div class="top-table">
        ${videos
          .map(
            (video) => `
              <article class="top-row">
                <div>
                  <span class="top-row__label">${escapeHtml(formatCompactDate(video.publishedAt))}</span>
                  <strong>${escapeHtml(video.title || "Untitled")}</strong>
                </div>
                <div class="top-row__meta">
                  <span style="color:${accentColor}">${formatNumber(video.analytics?.views || video.views || 0)} views</span>
                  <span>${formatNumber(video.analytics?.likes || video.likes || 0)} likes</span>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderHeaderSummary(global) {
    const node = byId("headerSummary");
    node.innerHTML = makeKpiCards([
      { label: "Followers", value: formatNumber(global.followers || 0) },
      { label: "Recent views", value: formatNumber(global.recentViews || 0) },
      { label: "Interactions", value: formatNumber(global.recentInteractions || 0) },
      { label: "Tracked posts", value: formatNumber(global.trackedVideos || 0) },
    ]);
  }

  function renderPlatformStatusStrip(platforms) {
    const node = byId("platformStatusStrip");
    node.innerHTML = Object.entries(platforms)
      .map(([key, platform]) => {
        const status = platform.available ? (platform.warnings?.length ? "limited" : "active") : "unavailable";
        return `
          <article class="strip-card">
            <div>
              <span>${escapeHtml(platform.name)}</span>
              <strong>${escapeHtml(platform.account?.displayName || platform.account?.title || platform.account?.username || status)}</strong>
            </div>
            <span class="${getStatusClass(status)}">${escapeHtml(status)}</span>
          </article>
        `;
      })
      .join("");
  }

  function renderGlobalView(live) {
    byId("globalKpis").innerHTML = makeKpiCards([
      { label: "Connected platforms", value: String(live.global.connectedPlatforms || 0) },
      { label: "Followers", value: formatNumber(live.global.followers || 0) },
      { label: "Recent views", value: formatNumber(live.global.recentViews || 0) },
      { label: "Recent interactions", value: formatNumber(live.global.recentInteractions || 0) },
      { label: "Tracked posts", value: formatNumber(live.global.trackedVideos || 0) },
    ]);

    byId("globalPlatformCards").innerHTML = Object.entries(live.platforms)
      .map(([key, platform]) => {
        const accent = platformAccent(key);
        const status = platform.available ? (platform.warnings?.length ? "limited" : "active") : "unavailable";
        const mainMetric =
          key === "youtube"
            ? `${formatNumber(platform.metrics?.subscribers || 0)} subscribers`
            : `${formatNumber(platform.metrics?.followers || 0)} followers`;

        return `
          <article class="platform-card">
            <div class="platform-card__header">
              <div class="platform-card__identity">
                <span class="platform-dot" style="--dot-color:${accent}"></span>
                <div>
                  <span>${escapeHtml(platform.name)}</span>
                  <strong>${escapeHtml(platform.account?.displayName || platform.account?.title || platform.account?.username || "Not available")}</strong>
                </div>
              </div>
              <span class="${getStatusClass(status)}">${escapeHtml(status)}</span>
            </div>
            <p class="platform-card__metric">${escapeHtml(mainMetric)}</p>
            <p class="platform-card__note">${escapeHtml(
              key === "instagram"
                ? `${formatNumber(platform.metrics?.reach || 0)} reach in recent insight window`
                : key === "youtube"
                  ? `${formatNumber(platform.metrics?.recentViews || 0)} recent views`
                  : `${platform.warnings?.length || 0} warning(s)`,
            )}</p>
          </article>
        `;
      })
      .join("");

    const alerts = [];
    Object.entries(live.platforms).forEach(([key, platform]) => {
      if (!platform.available) {
        alerts.push({
          title: `${platform.name} unavailable`,
          body: platform.error?.message || platform.reason || "Unknown issue",
        });
      }
      (platform.warnings || []).forEach((warning) => {
        alerts.push({
          title: `${platform.name}: ${warning.type}`,
          body: warning.message,
        });
      });
    });

    byId("globalAlerts").innerHTML = alerts.length
      ? alerts
          .map(
            (alert) => `
              <article class="alert-card">
                <strong>${escapeHtml(alert.title)}</strong>
                <p>${escapeHtml(alert.body)}</p>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No platform alerts right now.</div>';
  }

  function renderPlatformView(nodeId, platformKey, platform) {
    const node = byId(nodeId);
    const accent = platformAccent(platformKey);

    if (!platform.available) {
      node.innerHTML = `
        <section class="dashboard-grid">
          <article class="module shell-card">
            <div class="section-heading">
              <div>
                <p class="eyebrow">${escapeHtml(platform.name)}</p>
                <h2>Connection required</h2>
              </div>
            </div>
            <div class="empty-state">
              <strong>${escapeHtml(platform.reason || "Unavailable")}</strong>
              <p>${escapeHtml(platform.error?.message || "This platform is not returning live metrics yet.")}</p>
            </div>
          </article>
        </section>
      `;
      return;
    }

    const accountName =
      platform.account?.displayName ||
      platform.account?.title ||
      platform.account?.username ||
      platform.name;
    const metrics = platform.metrics || {};
    const chartSeries =
      platformKey === "youtube"
        ? platform.charts?.daily || []
        : platformKey === "instagram"
          ? platform.charts?.insights || []
          : platform.charts?.recentVideos || [];
    const chartKey = platformKey === "youtube" ? "views" : platformKey === "instagram" ? "reach" : "views";

    const kpiItems =
      platformKey === "youtube"
        ? [
            { label: "Subscribers", value: formatNumber(metrics.subscribers || 0) },
            { label: "Total views", value: formatNumber(metrics.totalViews || 0) },
            { label: "Videos", value: formatNumber(metrics.videoCount || 0) },
            { label: "Recent watch min", value: formatNumber(metrics.recentWatchMinutes || 0) },
            { label: "Recent views", value: formatNumber(metrics.recentViews || 0) },
            { label: "Recent likes", value: formatNumber(metrics.recentLikes || 0) },
          ]
        : platformKey === "instagram"
          ? [
              { label: "Followers", value: formatNumber(metrics.followers || 0) },
              { label: "Following", value: formatNumber(metrics.following || 0) },
              { label: "Media", value: formatNumber(metrics.mediaCount || 0) },
              { label: "Reach", value: formatNumber(metrics.reach || 0) },
              { label: "Likes", value: formatNumber(metrics.recentLikes || 0) },
              { label: "Comments", value: formatNumber(metrics.recentComments || 0) },
            ]
          : [
              { label: "Followers", value: formatNumber(metrics.followers || 0) },
              { label: "Following", value: formatNumber(metrics.following || 0) },
              { label: "Likes", value: formatNumber(metrics.totalLikes || 0) },
              { label: "Videos", value: formatNumber(metrics.videoCount || 0) },
              { label: "Recent views", value: formatNumber(metrics.recentViews || 0) },
              { label: "Recent shares", value: formatNumber(metrics.recentShares || 0) },
            ];

    node.innerHTML = `
      <section class="dashboard-grid">
        <article class="module shell-card module--wide">
          <div class="platform-hero">
            <div class="platform-hero__identity">
              ${
                platform.account?.thumbnailUrl || platform.account?.profilePictureUrl || platform.account?.avatarUrl
                  ? `<img class="platform-avatar" src="${escapeHtml(
                      platform.account.thumbnailUrl || platform.account.profilePictureUrl || platform.account.avatarUrl,
                    )}" alt="${escapeHtml(accountName)}" />`
                  : `<div class="platform-avatar platform-avatar--placeholder" style="--avatar-accent:${accent}"></div>`
              }
              <div>
                <p class="eyebrow">${escapeHtml(platform.name)}</p>
                <h2>${escapeHtml(accountName)}</h2>
                <p class="muted">${escapeHtml(
                  platform.account?.description || platform.account?.biography || platform.account?.profileUrl || "Live data from the official API",
                )}</p>
              </div>
            </div>
            <div class="platform-hero__meta">
              <span class="${getStatusClass(platform.warnings?.length ? "limited" : "active")}">${
                platform.warnings?.length ? "limited" : "active"
              }</span>
              <small>${escapeHtml(platform.tokenExpiresAt ? `token ${formatDate(platform.tokenExpiresAt)}` : "live token")}</small>
            </div>
          </div>
        </article>

        <article class="module shell-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Metrics</p>
              <h2>Primary KPIs</h2>
            </div>
          </div>
          <div class="kpi-grid">${makeKpiCards(kpiItems)}</div>
        </article>

        <article class="module shell-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Trend</p>
              <h2>${escapeHtml(chartKey)} over time</h2>
            </div>
          </div>
          ${createLineChart(chartSeries, chartKey, accent)}
        </article>

        <article class="module shell-card">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Warnings</p>
              <h2>Integration state</h2>
            </div>
          </div>
          ${createWarnings(platform.warnings || [])}
        </article>

        <article class="module shell-card module--wide">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Recent</p>
              <h2>Latest content</h2>
            </div>
          </div>
          ${createVideoCards(platform.recentVideos || [], accent)}
        </article>

        <article class="module shell-card module--wide">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Top content</p>
              <h2>Best performers</h2>
            </div>
          </div>
          ${createTopTable(platform.topVideos || [], accent)}
        </article>
      </section>
    `;
  }

  function renderConsole(control) {
    const runner = control.runner || {};
    const workflow = control.workflow || {};
    const dashboard = control.dashboard || {};
    const executions = Array.isArray(control.executions) ? control.executions : [];
    const events = Array.isArray(dashboard.recentEvents) ? dashboard.recentEvents : [];
    const operations = dashboard.operations || {};
    const recentRuns = Array.isArray(dashboard.recentRuns) ? dashboard.recentRuns : [];

    byId("runnerStatusBadge").className = getStatusClass(runner.running ? "active" : "configured");
    byId("runnerStatusBadge").textContent = runner.running ? "running" : "idle";
    byId("runnerMeta").innerHTML = makeKpiCards([
      { label: "Status", value: runner.running ? "Running" : "Idle" },
      { label: "Workflow", value: workflow.name || "-" },
      { label: "Started", value: runner.startedAt ? formatDate(runner.startedAt) : "-" },
      { label: "Finished", value: runner.finishedAt ? formatDate(runner.finishedAt) : "-" },
    ]);
    byId("runnerLogs").textContent = [runner.stdoutTail, runner.stderrTail].filter(Boolean).join("\n\n") || "No logs yet.";

    byId("executionConsole").innerHTML = executions.length
      ? executions
          .map(
            (item) => `
              <article class="stack-item">
                <div>
                  <span>${escapeHtml(item.name || "workflow")}</span>
                  <strong>${escapeHtml(item.status || "-")}</strong>
                </div>
                <small>${escapeHtml(formatDate(item.startedAt || item.stoppedAt))}</small>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state small-empty">No workflow executions yet.</div>';

    byId("eventConsole").innerHTML = events.length
      ? events
          .slice(0, 12)
          .map(
            (item) => `
              <article class="stack-item">
                <div>
                  <span>${escapeHtml(item.stage || item.event_type || "event")}</span>
                  <strong>${escapeHtml(item.message || "-")}</strong>
                </div>
                <small>${escapeHtml(formatDate(item.created_at || item.ts || item.event_at))}</small>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state small-empty">No content events yet.</div>';

    const fallbacks = recentRuns
      .flatMap((run) => {
        const socialPosts = run?.metadata?.social_posts || {};
        return ["youtube", "instagram", "tiktok"]
          .map((platform) => ({ platform, payload: socialPosts[platform], title: run.title || run.topic_key || "Untitled" }))
          .filter((item) => item.payload?.manualFallback);
      })
      .slice(0, 12);

    byId("fallbackConsole").innerHTML = fallbacks.length
      ? fallbacks
          .map(
            (item) => `
              <article class="stack-item">
                <div>
                  <span>${escapeHtml(item.platform)}</span>
                  <strong>${escapeHtml(item.title)}</strong>
                </div>
                <div class="stack-links">
                  ${item.payload.manualFallback.videoUrl ? `<a href="${escapeHtml(item.payload.manualFallback.videoUrl)}" target="_blank" rel="noreferrer">video</a>` : ""}
                  ${item.payload.manualFallback.txtUrl ? `<a href="${escapeHtml(item.payload.manualFallback.txtUrl)}" target="_blank" rel="noreferrer">txt</a>` : ""}
                  ${item.payload.manualFallback.jsonUrl ? `<a href="${escapeHtml(item.payload.manualFallback.jsonUrl)}" target="_blank" rel="noreferrer">json</a>` : ""}
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state small-empty">No manual fallback packages waiting.</div>';
  }

  async function loadDashboard() {
    const [live, control] = await Promise.all([apiFetch("/api/platform-analytics"), apiFetch("/api/control-center")]);
    byId("backendLabel").textContent = getApiBaseUrl();
    renderHeaderSummary(live.global || {});
    renderPlatformStatusStrip(live.platforms || {});
    renderGlobalView(live);
    renderPlatformView("youtubeView", "youtube", live.platforms.youtube);
    renderPlatformView("instagramView", "instagram", live.platforms.instagram);
    renderPlatformView("tiktokView", "tiktok", live.platforms.tiktok);
    renderConsole(control);
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = window.setInterval(() => {
      loadDashboard().catch((error) => {
        console.error(error);
      });
    }, 60000);
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    loginMessage.textContent = "";

    try {
      const baseUrl = setApiBaseUrl(apiBaseUrlInput.value.trim());
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          username: usernameInput.value.trim(),
          password: passwordInput.value,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Unable to login");
      }

      setToken(payload.token);
      setAuthenticated(true);
      scheduleRefresh();
      await loadDashboard();
      setActiveView(new URL(window.location.href).searchParams.get("view") || "global", false);
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  }

  function handleLogout() {
    clearSession();
    setAuthenticated(false);
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function bindEvents() {
    loginForm.addEventListener("submit", handleLoginSubmit);
    refreshButton.addEventListener("click", () => {
      loadDashboard().catch((error) => {
        console.error(error);
      });
    });
    logoutButton.addEventListener("click", handleLogout);
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveView(button.getAttribute("data-view"), true);
      });
    });
  }

  async function bootstrap() {
    apiBaseUrlInput.value = getApiBaseUrl();
    bindEvents();

    if (!getToken() || !getApiBaseUrl()) {
      setAuthenticated(false);
      return;
    }

    try {
      setAuthenticated(true);
      scheduleRefresh();
      await loadDashboard();
      setActiveView(new URL(window.location.href).searchParams.get("view") || "global", false);
    } catch (error) {
      console.error(error);
      handleLogout();
    }
  }

  bootstrap();
})();
