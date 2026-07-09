(function () {
  const TOKEN_KEY = "facts_engine_token";
  const API_BASE_KEY = "facts_engine_api_base";
  const AUTO_REFRESH_INTERVAL_MS = 20000;

  const state = {
    entries: [],
    selectedId: null,
    refreshTimer: null,
  };

  const loginView = document.getElementById("loginView");
  const appView = document.getElementById("appView");
  const loginForm = document.getElementById("loginForm");
  const loginMessage = document.getElementById("loginMessage");
  const apiBaseUrlInput = document.getElementById("apiBaseUrl");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const backendLabel = document.getElementById("backendLabel");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");
  const autoRefreshToggle = document.getElementById("autoRefreshToggle");
  const logSearchFilter = document.getElementById("logSearchFilter");
  const logPlatformFilter = document.getElementById("logPlatformFilter");
  const logLevelFilter = document.getElementById("logLevelFilter");
  const logKindFilter = document.getElementById("logKindFilter");
  const logStatusFilter = document.getElementById("logStatusFilter");
  const logStageFilter = document.getElementById("logStageFilter");
  const sortOrder = document.getElementById("sortOrder");
  const logCounts = document.getElementById("logCounts");
  const logTable = document.getElementById("logTable");
  const detailSummary = document.getElementById("detailSummary");
  const detailJson = document.getElementById("detailJson");
  const resultCount = document.getElementById("resultCount");

  function getToken() {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(value) {
    window.localStorage.setItem(TOKEN_KEY, value);
  }

  function clearToken() {
    window.localStorage.removeItem(TOKEN_KEY);
  }

  function getApiBaseUrl() {
    return String(window.localStorage.getItem(API_BASE_KEY) || "").replace(/\/+$/, "");
  }

  function setApiBaseUrl(value) {
    const normalized = String(value || "").replace(/\/+$/, "");
    window.localStorage.setItem(API_BASE_KEY, normalized);
    return normalized;
  }

  function setAuthenticated(authenticated) {
    loginView.style.display = authenticated ? "none" : "block";
    appView.classList.toggle("app-shell--hidden", !authenticated);
  }

  function escapeHtml(value) {
    return String(value ?? "")
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
    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(date);
  }

  function formatJson(value) {
    try {
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return String(value ?? "");
    }
  }

  function statusClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (["published", "success", "ok", "completed", "running", "started", "info"].includes(normalized)) {
      return "badge badge--info";
    }
    if (["warning", "warn", "limited"].includes(normalized)) {
      return "badge badge--warn";
    }
    return "badge badge--error";
  }

  function levelClass(level) {
    const normalized = String(level || "").toLowerCase();
    if (normalized === "error") return "badge badge--error";
    if (normalized === "warning" || normalized === "warn") return "badge badge--warn";
    return "badge badge--info";
  }

  function summarize(entry) {
    const message = entry.message || "-";
    const reason = entry.reason ? ` | ${entry.reason}` : "";
    return `${message}${reason}`;
  }

  async function apiFetch(path, options = {}) {
    const baseUrl = getApiBaseUrl();
    const token = getToken();
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

  function currentFilters() {
    return {
      limit: "300",
      search: logSearchFilter.value.trim(),
      platform: logPlatformFilter.value,
      level: logLevelFilter.value,
      kind: logKindFilter.value,
      stage: logStageFilter.value.trim(),
    };
  }

  async function loadLogs() {
    const params = new URLSearchParams();
    Object.entries(currentFilters()).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    const payload = await apiFetch(`/api/logs?${params.toString()}`);
    state.entries = Array.isArray(payload.entries) ? payload.entries.slice() : [];
    renderCounts(payload.counts || {});
    renderTable();
    ensureSelection();
    renderDetails();
  }

  function renderCounts(counts) {
    const warningCount = (counts.byLevel?.warning || 0) + (counts.byLevel?.warn || 0);
    const cards = [
      { label: "Entries", value: counts.total || 0 },
      { label: "Errors", value: counts.byLevel?.error || 0 },
      { label: "Warnings", value: warningCount },
      { label: "YouTube", value: counts.byPlatform?.youtube || 0 },
      { label: "API", value: counts.byKind?.api || 0 },
      { label: "Artifacts", value: counts.byKind?.artifact || 0 },
    ];

    logCounts.innerHTML = cards
      .map(
        (card) => `
          <article class="stat-card">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
          </article>
        `,
      )
      .join("");
  }

  function filteredAndSortedEntries() {
    const filtered = state.entries.filter((entry) => {
      if (logStatusFilter.value && String(entry.status || "").toLowerCase() !== logStatusFilter.value.toLowerCase()) {
        return false;
      }
      return true;
    });

    const direction = sortOrder.value === "asc" ? 1 : -1;
    return filtered.sort((left, right) => {
      const leftTime = new Date(left.timestamp || 0).getTime();
      const rightTime = new Date(right.timestamp || 0).getTime();
      return (leftTime - rightTime) * direction;
    });
  }

  function renderTable() {
    const entries = filteredAndSortedEntries();
    resultCount.textContent = `${entries.length} entries`;

    if (!entries.length) {
      logTable.innerHTML = '<div class="empty-state">No logs match the current filters.</div>';
      return;
    }

    logTable.innerHTML = entries
      .map(
        (entry) => `
          <button class="log-row ${state.selectedId === entry.id ? "log-row--active" : ""}" type="button" data-entry-id="${escapeHtml(entry.id)}">
            <span class="log-cell log-cell--mono">${escapeHtml(formatDate(entry.timestamp))}</span>
            <span class="log-cell"><span class="${levelClass(entry.level)}">${escapeHtml(entry.level || "info")}</span></span>
            <span class="log-cell">${escapeHtml(entry.platform || "-")}</span>
            <span class="log-cell">${escapeHtml(entry.stage || "-")}</span>
            <span class="log-cell log-cell--summary">
              <strong>${escapeHtml(entry.message || "-")}</strong>
              <small>${escapeHtml([entry.source, entry.topic, entry.reason].filter(Boolean).join(" | "))}</small>
            </span>
          </button>
        `,
      )
      .join("");

    logTable.querySelectorAll("[data-entry-id]").forEach((node) => {
      node.addEventListener("click", () => {
        state.selectedId = Number(node.dataset.entryId) || node.dataset.entryId;
        renderTable();
        renderDetails();
      });
    });
  }

  function ensureSelection() {
    const entries = filteredAndSortedEntries();
    if (!entries.length) {
      state.selectedId = null;
      return;
    }

    const exists = entries.some((entry) => String(entry.id) === String(state.selectedId));
    if (!exists) {
      state.selectedId = entries[0].id;
    }
  }

  function renderDetails() {
    const entry = filteredAndSortedEntries().find((item) => String(item.id) === String(state.selectedId));
    if (!entry) {
      detailSummary.innerHTML = '<div class="empty-state">Select a row to inspect its full context.</div>';
      detailJson.textContent = "Select a row to inspect its full context.";
      return;
    }

    detailSummary.innerHTML = `
      <div class="summary-grid">
        <article class="summary-card">
          <span>Timestamp</span>
          <strong>${escapeHtml(formatDate(entry.timestamp))}</strong>
        </article>
        <article class="summary-card">
          <span>Platform</span>
          <strong>${escapeHtml(entry.platform || "-")}</strong>
        </article>
        <article class="summary-card">
          <span>Stage</span>
          <strong>${escapeHtml(entry.stage || "-")}</strong>
        </article>
        <article class="summary-card">
          <span>Status</span>
          <strong><span class="${statusClass(entry.status)}">${escapeHtml(entry.status || "-")}</span></strong>
        </article>
        <article class="summary-card summary-card--wide">
          <span>Message</span>
          <strong>${escapeHtml(entry.message || "-")}</strong>
        </article>
        <article class="summary-card summary-card--wide">
          <span>Failure reason</span>
          <strong>${escapeHtml(entry.reason || "-")}</strong>
        </article>
        <article class="summary-card summary-card--wide">
          <span>Reference</span>
          <strong>${entry.reference ? `<a href="${escapeHtml(entry.reference)}" target="_blank" rel="noreferrer">${escapeHtml(entry.reference)}</a>` : "-"}</strong>
        </article>
        <article class="summary-card summary-card--wide">
          <span>Source</span>
          <strong>${escapeHtml([entry.kind, entry.source, entry.topic].filter(Boolean).join(" / "))}</strong>
        </article>
      </div>
    `;
    detailJson.textContent = formatJson(entry);
  }

  function scheduleRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }

    if (!autoRefreshToggle.checked) {
      return;
    }

    state.refreshTimer = window.setInterval(() => {
      loadLogs().catch((error) => console.error(error));
    }, AUTO_REFRESH_INTERVAL_MS);
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
      backendLabel.textContent = baseUrl;
      setAuthenticated(true);
      scheduleRefresh();
      await loadLogs();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  }

  function handleLogout() {
    clearToken();
    setAuthenticated(false);
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  function bindEvents() {
    loginForm.addEventListener("submit", handleLoginSubmit);
    refreshButton.addEventListener("click", () => loadLogs().catch((error) => console.error(error)));
    logoutButton.addEventListener("click", handleLogout);
    autoRefreshToggle.addEventListener("change", scheduleRefresh);

    [logSearchFilter, logPlatformFilter, logLevelFilter, logKindFilter, logStatusFilter, logStageFilter, sortOrder].forEach(
      (input) => {
        input.addEventListener("change", () => {
          if (getToken()) {
            loadLogs().catch((error) => console.error(error));
          }
        });

        input.addEventListener("input", () => {
          if (!getToken()) {
            return;
          }
          clearTimeout(input._refreshHandle);
          input._refreshHandle = setTimeout(() => {
            loadLogs().catch((error) => console.error(error));
          }, 200);
        });
      },
    );
  }

  async function bootstrap() {
    apiBaseUrlInput.value = getApiBaseUrl();
    bindEvents();

    if (!getToken() || !getApiBaseUrl()) {
      setAuthenticated(false);
      return;
    }

    try {
      backendLabel.textContent = getApiBaseUrl();
      setAuthenticated(true);
      scheduleRefresh();
      await loadLogs();
    } catch (error) {
      console.error(error);
      handleLogout();
    }
  }

  bootstrap();
})();
