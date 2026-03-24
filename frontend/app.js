(function () {
  const TOKEN_KEY = "facts_engine_token";
  const API_BASE_KEY = "facts_engine_api_base";

  const loginView = document.getElementById("loginView");
  const appView = document.getElementById("appView");
  const loginForm = document.getElementById("loginForm");
  const loginMessage = document.getElementById("loginMessage");
  const apiBaseUrlInput = document.getElementById("apiBaseUrl");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");
  const logKindFilter = document.getElementById("logKindFilter");
  const logPlatformFilter = document.getElementById("logPlatformFilter");
  const logLevelFilter = document.getElementById("logLevelFilter");
  const logStageFilter = document.getElementById("logStageFilter");
  const logSearchFilter = document.getElementById("logSearchFilter");

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

  function getStatusClass(state) {
    const normalized = String(state || "").toLowerCase();
    if (["ok", "active", "available", "published", "connected", "running", "info"].includes(normalized)) {
      return "status-pill status-pill--success";
    }
    if (["warning", "limited", "configured", "warn"].includes(normalized)) {
      return "status-pill status-pill--warn";
    }
    return "status-pill status-pill--error";
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

  function getLogFilters() {
    return {
      kind: logKindFilter.value,
      platform: logPlatformFilter.value,
      level: logLevelFilter.value,
      stage: logStageFilter.value.trim(),
      search: logSearchFilter.value.trim(),
    };
  }

  async function loadConsoleFeed() {
    const filters = getLogFilters();
    const params = new URLSearchParams({ limit: "200" });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    return apiFetch(`/api/logs?${params.toString()}`);
  }

  function renderRunner(control) {
    const runner = control.runner || {};
    const workflow = control.workflow || {};
    byId("backendLabel").textContent = getApiBaseUrl();
    byId("runnerStatusBadge").className = getStatusClass(runner.running ? "running" : "configured");
    byId("runnerStatusBadge").textContent = runner.running ? "running" : "idle";
    byId("runnerMeta").innerHTML = makeKpiCards([
      { label: "Status", value: runner.running ? "Running" : "Idle" },
      { label: "Workflow", value: workflow.name || "-" },
      { label: "Started", value: runner.startedAt ? formatDate(runner.startedAt) : "-" },
      { label: "Finished", value: runner.finishedAt ? formatDate(runner.finishedAt) : "-" },
    ]);
    byId("runnerLogs").textContent = [runner.stdoutTail, runner.stderrTail].filter(Boolean).join("\n\n") || "No logs yet.";
  }

  function renderExecutions(control) {
    const executions = Array.isArray(control.executions) ? control.executions : [];
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
  }

  function renderConsoleFeed(feed) {
    const counts = feed.counts || { total: 0, byKind: {}, byPlatform: {}, byLevel: {} };
    byId("logCounts").innerHTML = makeKpiCards([
      { label: "Entries", value: String(counts.total || 0) },
      { label: "Errors", value: String(counts.byLevel?.error || 0) },
      { label: "Warnings", value: String((counts.byLevel?.warning || 0) + (counts.byLevel?.warn || 0)) },
      { label: "YouTube", value: String(counts.byPlatform?.youtube || 0) },
      { label: "Instagram", value: String(counts.byPlatform?.instagram || 0) },
      { label: "TikTok", value: String(counts.byPlatform?.tiktok || 0) },
    ]);

    byId("eventConsole").innerHTML = Array.isArray(feed.entries) && feed.entries.length
      ? feed.entries
          .map(
            (entry) => `
              <article class="stack-item">
                <div>
                  <span>${escapeHtml([entry.kind, entry.platform || entry.source, entry.stage].filter(Boolean).join(" / "))}</span>
                  <strong>${escapeHtml(entry.message || "-")}</strong>
                </div>
                <div class="stack-links">
                  <span class="${getStatusClass(entry.level === "error" ? "error" : entry.level === "warning" || entry.level === "warn" ? "warning" : "info")}">${escapeHtml(entry.level || "info")}</span>
                  ${entry.reference ? `<a href="${escapeHtml(entry.reference)}" target="_blank" rel="noreferrer">ref</a>` : ""}
                  <small>${escapeHtml(formatDate(entry.timestamp))}</small>
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state small-empty">No entries match the current filters.</div>';
  }

  function renderFallbacks(control) {
    const dashboard = control.dashboard || {};
    const recentRuns = Array.isArray(dashboard.recentRuns) ? dashboard.recentRuns : [];
    const fallbacks = recentRuns
      .flatMap((run) => {
        const socialPosts = run?.metadata?.social_posts || {};
        return ["youtube", "instagram", "tiktok"]
          .map((platform) => ({ platform, payload: socialPosts[platform], title: run.title || run.topic_key || "Untitled" }))
          .filter((item) => item.payload?.manualFallback);
      })
      .slice(0, 20);

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

  async function loadConsole() {
    const [control, feed] = await Promise.all([apiFetch("/api/control-center"), loadConsoleFeed()]);
    renderRunner(control);
    renderExecutions(control);
    renderConsoleFeed(feed);
    renderFallbacks(control);
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = window.setInterval(() => {
      loadConsole().catch((error) => {
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
      await loadConsole();
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
      loadConsole().catch((error) => {
        console.error(error);
      });
    });
    logoutButton.addEventListener("click", handleLogout);

    [logKindFilter, logPlatformFilter, logLevelFilter, logStageFilter, logSearchFilter].forEach((input) => {
      input.addEventListener("change", () => {
        if (getToken()) {
          loadConsole().catch((error) => console.error(error));
        }
      });
      input.addEventListener("input", () => {
        if (getToken()) {
          clearTimeout(input._logTimer);
          input._logTimer = setTimeout(() => {
            loadConsole().catch((error) => console.error(error));
          }, 250);
        }
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
      await loadConsole();
    } catch (error) {
      console.error(error);
      handleLogout();
    }
  }

  bootstrap();
})();
