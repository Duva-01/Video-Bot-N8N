(function () {
  const TOKEN_KEY = "facts_engine_token";
  const API_BASE_KEY = "facts_engine_api_base";
  const config = window.FACTS_APP_CONFIG || {};
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
  const backendLabelNode = document.getElementById("backendLabel");

  let refreshTimer = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function getApiBaseUrl() {
    return String(window.localStorage.getItem(API_BASE_KEY) || config.API_BASE_URL || "").replace(/\/+$/, "");
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
    loginView.style.display = authenticated ? "none" : "grid";
    appView.classList.toggle("app-shell--hidden", !authenticated);
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
    return new Intl.DateTimeFormat("es-ES", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getStatusClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (["published", "success", "completed", "publish_complete", "on"].includes(normalized)) return "status-pill status-pill--success";
    if (["failed", "error", "off"].includes(normalized)) return "status-pill status-pill--error";
    if (["running", "generated", "selected", "pending", "warning"].includes(normalized)) return "status-pill status-pill--warn";
    return "status-pill status-pill--idle";
  }

  function getConnectionStateClass(connected, enabled) {
    if (connected && enabled) return "status-pill status-pill--success";
    if (connected) return "status-pill status-pill--warn";
    return "status-pill status-pill--idle";
  }

  async function apiFetch(path, options = {}) {
    const token = getToken();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) throw new Error("Missing API_BASE_URL");

    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`);
    return payload;
  }

  function setActiveView(view, pushHistory) {
    const selected = views.includes(view) ? view : "global";
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("view--active", panel.getAttribute("data-view-panel") === selected);
    });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("nav-tab--active", button.getAttribute("data-view") === selected);
    });

    if (pushHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", selected);
      window.history.replaceState({}, "", url);
    }
  }

  function normalizeRecentItem(item) {
    return {
      topicKey: item?.topic_key || "-",
      title: item?.title || item?.topic || item?.topic_key || "Untitled",
      category: item?.category || "-",
      stage: item?.current_stage || "-",
      status: item?.status || "unknown",
      updatedAt: item?.published_at || item?.updated_at || item?.selected_at || null,
      metadata: item?.metadata || {},
      youtubeUrl: item?.youtube_url || null,
      youtubeVideoId: item?.youtube_video_id || null,
      tiktokStatus: item?.tiktok_status || null,
      tiktokPublishId: item?.tiktok_publish_id || null,
    };
  }

  function getPlatformResult(item, platformKey) {
    const metadata = item?.metadata || {};
    const socialPosts = metadata.social_posts || {};

    if (platformKey === "youtube") {
      const youtubeResult = metadata.youtube_result || {};
      return {
        status: item.youtubeUrl || item.youtubeVideoId ? "published" : youtubeResult.status || item.status || "unknown",
        url: item.youtubeUrl || youtubeResult.url || null,
        error: youtubeResult.error || null,
        manualFallback: youtubeResult.manualFallback || null,
      };
    }

    if (platformKey === "instagram") {
      const instagram = socialPosts.instagram || {};
      return {
        status: instagram.status || "unknown",
        url: instagram.url || null,
        error: instagram.error || null,
        manualFallback: instagram.manualFallback || null,
      };
    }

    const tiktok = socialPosts.tiktok || {};
    return {
      status: tiktok.status || item.tiktokStatus || "unknown",
      url: tiktok.url || null,
      error: tiktok.error || null,
      manualFallback: tiktok.manualFallback || null,
      publishId: tiktok.publishId || item.tiktokPublishId || null,
    };
  }

  function renderSimpleCard(nodeId, item, platformKey) {
    const node = qs(nodeId);
    if (!node) return;

    if (!item) {
      node.innerHTML = '<div class="empty-state small-empty">No data yet.</div>';
      return;
    }

    const normalized = normalizeRecentItem(item);
    const result = platformKey ? getPlatformResult(normalized, platformKey) : null;
    const actionUrl = result?.url || normalized.youtubeUrl || null;

    node.innerHTML = `
      <article class="story-card">
        <div class="story-card__meta">
          <span>${escapeHtml(normalized.category)}</span>
          <span>${escapeHtml(formatCompactDate(normalized.updatedAt))}</span>
        </div>
        <h4>${escapeHtml(normalized.title)}</h4>
        <div class="story-card__actions">
          <span class="${getStatusClass(result?.status || normalized.status)}">${escapeHtml(result?.status || normalized.status)}</span>
          ${actionUrl ? `<a href="${escapeHtml(actionUrl)}" target="_blank" rel="noreferrer">Open</a>` : ""}
        </div>
      </article>
    `;
  }

  function renderBarList(nodeId, items, labelKey, valueKey) {
    const node = qs(nodeId);
    if (!node) return;

    if (!Array.isArray(items) || items.length === 0) {
      node.innerHTML = '<div class="empty-state small-empty">No data yet.</div>';
      return;
    }

    const maxValue = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
    node.innerHTML = items
      .map((item) => {
        const value = Number(item[valueKey] || 0);
        const width = Math.max(8, Math.round((value / maxValue) * 100));
        return `
          <div class="bar-row">
            <div class="bar-head">
              <span>${escapeHtml(item[labelKey] || "-")}</span>
              <strong>${value}</strong>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          </div>
        `;
      })
      .join("");
  }

  function renderTimelineList(nodeId, items, formatter) {
    const node = qs(nodeId);
    if (!node) return;

    if (!Array.isArray(items) || items.length === 0) {
      node.innerHTML = '<div class="empty-state small-empty">No entries yet.</div>';
      return;
    }

    node.innerHTML = items.map(formatter).join("");
  }

  function renderPlatformStrip(platformConfig, platforms) {
    const node = qs("platformConnectionStrip");
    if (!node) return;

    const order = ["youtube", "instagram", "tiktok"];
    node.innerHTML = order.map((key) => {
      const configEntry = platformConfig?.[key] || {};
      const summary = platforms?.[key] || {};
      const stateLabel = configEntry.connected ? (configEntry.enabled ? "connected" : "configured") : "not configured";
      return `
        <article class="connection-card">
          <div>
            <span>${escapeHtml(summary.name || key)}</span>
            <strong>${escapeHtml(stateLabel)}</strong>
          </div>
          <div class="connection-card__meta">
            <span class="${getConnectionStateClass(configEntry.connected, configEntry.enabled)}">${configEntry.enabled ? "enabled" : "disabled"}</span>
            <small>${summary.published || 0} published</small>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderGlobalStats(dashboard) {
    const totals = dashboard?.totals || {};
    const platforms = dashboard?.platforms || {};
    const node = qs("globalStats");
    if (!node) return;

    const cards = [
      { label: "Tracked videos", value: totals.total_videos || 0 },
      { label: "Published records", value: totals.published_videos || 0 },
      { label: "Failed runs", value: totals.failed_videos || 0 },
      { label: "Categories", value: totals.categories_covered || 0 },
      { label: "Instagram published", value: platforms.instagram?.published || 0 },
      { label: "TikTok published", value: platforms.tiktok?.published || 0 },
    ];

    node.innerHTML = cards.map((card) => `
      <article class="stat-card shell-card">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
      </article>
    `).join("");
  }

  function renderPlatformCards(dashboard) {
    const node = qs("platformCards");
    if (!node) return;

    const platformConfig = dashboard?.platformConfig || {};
    const platforms = dashboard?.platforms || {};
    node.innerHTML = ["youtube", "instagram", "tiktok"].map((key) => {
      const platform = platforms[key] || { name: key };
      const configEntry = platformConfig[key] || {};
      return `
        <article class="platform-card shell-card">
          <div class="platform-card__head">
            <div>
              <p class="eyebrow">Platform</p>
              <h3>${escapeHtml(platform.name || key)}</h3>
            </div>
            <span class="${getConnectionStateClass(configEntry.connected, configEntry.enabled)}">${configEntry.enabled ? "active" : "off"}</span>
          </div>
          <div class="platform-card__stats">
            <article><span>Attempted</span><strong>${platform.attempted || 0}</strong></article>
            <article><span>Published</span><strong>${platform.published || 0}</strong></article>
            <article><span>Failed</span><strong>${platform.failed || 0}</strong></article>
          </div>
          <p class="platform-card__meta">Last success: ${escapeHtml(formatDate(platform.last_published_at))}</p>
        </article>
      `;
    }).join("");
  }

  function collectManualFallbacks(platforms) {
    const fallbackItems = [];
    ["youtube", "instagram", "tiktok"].forEach((platformKey) => {
      (platforms?.[platformKey]?.recentItems || []).forEach((item) => {
        const normalized = normalizeRecentItem(item);
        const result = getPlatformResult(normalized, platformKey);
        if (result.manualFallback) {
          fallbackItems.push({
            platformKey,
            title: normalized.title,
            updatedAt: normalized.updatedAt,
            error: result.error || "Manual fallback ready",
            fallback: result.manualFallback,
          });
        }
      });
    });

    return fallbackItems.slice(0, 10);
  }

  function renderGlobalView(data) {
    const dashboard = data.dashboard || {};
    const totals = dashboard.totals || {};

    qs("headerTotalVideos").textContent = String(totals.total_videos || 0);
    qs("headerPublishedVideos").textContent = String(totals.published_videos || 0);
    qs("headerFailedVideos").textContent = String(totals.failed_videos || 0);
    qs("headerLastPublished").textContent = formatDate(totals.last_published_at);
    backendLabelNode.textContent = getApiBaseUrl() || "Backend not configured";

    renderPlatformStrip(dashboard.platformConfig || {}, dashboard.platforms || {});
    renderGlobalStats(dashboard);
    renderPlatformCards(dashboard);
    renderSimpleCard("latestGeneratedCard", dashboard.latestGenerated || dashboard.recentRuns?.[0] || null, null);
    renderSimpleCard("latestPublishedCard", dashboard.latestPublished || null, "youtube");
    renderBarList("categoryBars", dashboard.byCategory || [], "category", "total");

    renderTimelineList("recentEventsList", dashboard.recentEvents || [], (item) => `
      <article class="list-item">
        <div class="list-item__top">
          <strong>${escapeHtml(item.message || item.event_type || "event")}</strong>
          <span class="${getStatusClass(item.level || "info")}">${escapeHtml(item.level || "info")}</span>
        </div>
        <div class="list-item__meta">
          <span>${escapeHtml(item.stage || "-")}</span>
          <span>${escapeHtml(item.topic_key || "global")}</span>
          <span>${escapeHtml(formatCompactDate(item.created_at))}</span>
        </div>
      </article>
    `);

    const manualFallbacks = collectManualFallbacks(dashboard.platforms || {});
    renderTimelineList("manualFallbackList", manualFallbacks, (item) => `
      <article class="list-item">
        <div class="list-item__top">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="${getStatusClass("warning")}">${escapeHtml(item.platformKey)}</span>
        </div>
        <div class="list-item__meta">
          <span>${escapeHtml(item.error)}</span>
          <span>${escapeHtml(formatCompactDate(item.updatedAt))}</span>
        </div>
        <div class="list-item__links">
          ${item.fallback.videoUrl ? `<a href="${escapeHtml(item.fallback.videoUrl)}" target="_blank" rel="noreferrer">Cloudinary video</a>` : ""}
          ${item.fallback.txtPath ? `<span>${escapeHtml(item.fallback.txtPath)}</span>` : ""}
        </div>
      </article>
    `);
  }

  function renderPlatformSection(nodeId, platformKey, dashboard) {
    const node = qs(nodeId);
    if (!node) return;

    const platform = dashboard?.platforms?.[platformKey] || { name: platformKey, recentItems: [] };
    const configEntry = dashboard?.platformConfig?.[platformKey] || {};
    const recentItems = Array.isArray(platform.recentItems) ? platform.recentItems.map(normalizeRecentItem) : [];

    node.innerHTML = `
      <div class="platform-view-grid">
        <section class="module shell-card">
          <div class="module-head">
            <div>
              <p class="eyebrow">Status</p>
              <h3>${escapeHtml(platform.name || platformKey)}</h3>
            </div>
            <span class="${getConnectionStateClass(configEntry.connected, configEntry.enabled)}">${configEntry.enabled ? "enabled" : "disabled"}</span>
          </div>
          <div class="platform-kpis">
            <article><span>Attempted</span><strong>${platform.attempted || 0}</strong></article>
            <article><span>Published</span><strong>${platform.published || 0}</strong></article>
            <article><span>Failed</span><strong>${platform.failed || 0}</strong></article>
            <article><span>Last success</span><strong>${escapeHtml(formatDate(platform.last_published_at))}</strong></article>
          </div>
          <div class="platform-tags">
            <span class="${getConnectionStateClass(configEntry.connected, configEntry.enabled)}">${configEntry.connected ? "credentials ready" : "missing credentials"}</span>
            <span class="status-pill status-pill--idle">view: ${escapeHtml(platformKey)}</span>
          </div>
        </section>

        <section class="module shell-card module--wide">
          <div class="module-head">
            <div>
              <p class="eyebrow">Recent items</p>
              <h3>Latest ${escapeHtml(platform.name || platformKey)} attempts</h3>
            </div>
          </div>
          <div class="list-stack">
            ${recentItems.length ? recentItems.map((item) => {
              const result = getPlatformResult(item, platformKey);
              return `
                <article class="list-item">
                  <div class="list-item__top">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span class="${getStatusClass(result.status || item.status)}">${escapeHtml(result.status || item.status)}</span>
                  </div>
                  <div class="list-item__meta">
                    <span>${escapeHtml(item.category)}</span>
                    <span>${escapeHtml(item.stage)}</span>
                    <span>${escapeHtml(formatCompactDate(item.updatedAt))}</span>
                  </div>
                  <div class="list-item__links">
                    ${result.url ? `<a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">Open post</a>` : ""}
                    ${result.manualFallback?.videoUrl ? `<a href="${escapeHtml(result.manualFallback.videoUrl)}" target="_blank" rel="noreferrer">Manual fallback</a>` : ""}
                    ${result.publishId ? `<span>${escapeHtml(result.publishId)}</span>` : ""}
                    ${result.error ? `<span>${escapeHtml(result.error)}</span>` : ""}
                  </div>
                </article>
              `;
            }).join("") : '<div class="empty-state small-empty">No platform activity yet.</div>'}
          </div>
        </section>
      </div>
    `;
  }

  function renderConsoleView(data) {
    const runner = data.runner || {};
    const operations = data.dashboard?.operations || {};
    const executions = Array.isArray(data.executions) ? data.executions : [];

    const runnerStatus = runner.running ? "running" : runner.lastError ? "error" : runner.finishedAt ? "completed" : "idle";
    qs("runnerStatusBadge").className = getStatusClass(runnerStatus);
    qs("runnerStatusBadge").textContent = runnerStatus;
    qs("runnerStatus").textContent = runner.running ? "Running" : runner.lastError ? "Error" : runner.finishedAt ? "Completed" : "Idle";
    qs("runnerWorkflow").textContent = runner.workflowName || "-";
    qs("runnerStartedAt").textContent = formatDate(runner.startedAt);
    qs("runnerFinishedAt").textContent = formatDate(runner.finishedAt);
    qs("runnerLogs").textContent = String(runner.lastError || runner.stderrTail || runner.stdoutTail || "No logs yet.").trim() || "No logs yet.";

    renderTimelineList("executionConsole", executions, (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>#${escapeHtml(item.id || item.execution_id || "-")}</strong>
          <span class="${getStatusClass(item.status || "info")}">${escapeHtml(item.status || "info")}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.mode || "-")}</span>
          <span>${escapeHtml(formatCompactDate(item.startedAt || item.created_at))}</span>
          <span>${escapeHtml(item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : "-")}</span>
        </div>
      </article>
    `);

    renderTimelineList("eventConsole", operations.events || [], (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>${escapeHtml(item.message || item.event_type || "event")}</strong>
          <span class="${getStatusClass(item.level || "info")}">${escapeHtml(item.level || "info")}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.stage || "-")}</span>
          <span>${escapeHtml(item.topic_key || "global")}</span>
          <span>${escapeHtml(formatCompactDate(item.created_at))}</span>
        </div>
      </article>
    `);

    renderTimelineList("artifactConsole", operations.artifacts || [], (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>${escapeHtml(item.artifact_type || "artifact")}</strong>
          <span class="${getStatusClass("info")}">${escapeHtml(item.label || "stored")}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.topic_key || "-")}</span>
          <span>${escapeHtml(item.mime_type || "-")}</span>
          <span>${escapeHtml(item.size_bytes ? `${Math.round(item.size_bytes / 1024)} KB` : "-")}</span>
        </div>
      </article>
    `);

    renderTimelineList("auditConsole", operations.apiAudit || [], (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>${escapeHtml(item.action || "request")}</strong>
          <span class="${getStatusClass(item.status_code >= 400 ? "error" : "success")}">${escapeHtml(String(item.status_code || "-"))}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.actor || "anonymous")}</span>
          <span>${escapeHtml(item.path || "/")}</span>
          <span>${escapeHtml(formatCompactDate(item.created_at))}</span>
        </div>
      </article>
    `);
  }

  function renderPayload(data) {
    renderGlobalView(data);
    renderPlatformSection("youtubeView", "youtube", data.dashboard || {});
    renderPlatformSection("instagramView", "instagram", data.dashboard || {});
    renderPlatformSection("tiktokView", "tiktok", data.dashboard || {});
    renderConsoleView(data);
  }

  async function loadAppData() {
    const payload = await apiFetch("/api/control-center");
    renderPayload(payload);
    return payload;
  }

  function startAutoRefresh() {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      loadAppData().catch(handleFatalError);
    }, 30000);
  }

  function stopAutoRefresh() {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function handleFatalError(error) {
    const message = error?.message || "Unknown error";
    loginMessage.textContent = message;
    backendLabelNode.textContent = message;
    qs("runnerLogs").textContent = message;
  }

  async function handleLogin(event) {
    event.preventDefault();
    loginMessage.textContent = "";

    try {
      const apiBase = setApiBaseUrl(apiBaseUrlInput.value);
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Login failed with status ${response.status}`);
      setToken(payload.token);
      setAuthenticated(true);
      await loadAppData();
      setActiveView(new URLSearchParams(window.location.search).get("view") || "global", true);
      startAutoRefresh();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  }

  loginForm.addEventListener("submit", handleLogin);
  refreshButton.addEventListener("click", () => loadAppData().catch(handleFatalError));
  logoutButton.addEventListener("click", () => {
    clearSession();
    stopAutoRefresh();
    setAuthenticated(false);
  });

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-view]");
    if (!trigger) return;
    setActiveView(trigger.getAttribute("data-view"), true);
  });

  window.addEventListener("popstate", () => {
    setActiveView(new URLSearchParams(window.location.search).get("view") || "global", false);
  });

  apiBaseUrlInput.value = getApiBaseUrl() || config.API_BASE_URL || "";
  usernameInput.value = config.DEFAULT_USERNAME || "admin";

  if (getToken() && getApiBaseUrl()) {
    setAuthenticated(true);
    loadAppData()
      .then(() => {
        setActiveView(new URLSearchParams(window.location.search).get("view") || "global", true);
        startAutoRefresh();
      })
      .catch((error) => {
        clearSession();
        setAuthenticated(false);
        loginMessage.textContent = error.message;
      });
  } else {
    setAuthenticated(false);
  }
})();
