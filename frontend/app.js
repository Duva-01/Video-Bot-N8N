(function () {
  const TOKEN_KEY = "facts_engine_token";
  const API_BASE_KEY = "facts_engine_api_base";
  const config = window.FACTS_APP_CONFIG || {};
  const views = {
    dashboard: {
      title: "Dashboard",
      description: "Overview operativo del bot: últimos runs, cobertura de categorías, vídeo reciente y telemetría.",
    },
    console: {
      title: "Console",
      description: "Eventos persistidos en Neon: eventos de pipeline, ejecuciones, artefactos, auditoría y runner logs.",
    },
    health: {
      title: "Health",
      description: "Estado técnico del backend, persistencia, perfil low-memory y salida cruda del endpoint health.",
    },
  };

  const landingView = document.getElementById("landingView");
  const loginModal = document.getElementById("loginModal");
  const appView = document.getElementById("appView");
  const loginForm = document.getElementById("loginForm");
  const loginMessage = document.getElementById("loginMessage");
  const apiBaseUrlInput = document.getElementById("apiBaseUrl");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const logoutButton = document.getElementById("logoutButton");
  const openN8nButton = document.getElementById("openN8nButton");
  const runNowButton = document.getElementById("runNowButton");
  const toggleAutomationButton = document.getElementById("toggleAutomationButton");
  const refreshDashboardButton = document.getElementById("refreshDashboardButton");
  const refreshHealthButton = document.getElementById("refreshHealthButton");
  const refreshLogsButton = document.getElementById("refreshLogsButton");
  const titleNode = document.getElementById("viewTitle");
  const descriptionNode = document.getElementById("viewDescription");
  const backendLabelNode = document.getElementById("backendLabel");
  const runnerStatusNode = document.getElementById("runnerStatus");
  const runnerCopyNode = document.getElementById("runnerCopy");
  const runnerDotNode = document.getElementById("runnerDot");
  const runnerMetaNode = document.getElementById("runnerMeta");
  const runnerLogsNode = document.getElementById("runnerLogs");
  const logsConsoleNode = document.getElementById("logsConsole");
  const healthJsonNode = document.getElementById("healthJson");

  let runPollTimer = null;
  let autoRefreshTimer = null;

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

  function openLoginModal() {
    loginModal.classList.remove("login-modal--hidden");
    loginModal.setAttribute("aria-hidden", "false");
    loginMessage.textContent = "";
  }

  function closeLoginModal() {
    loginModal.classList.add("login-modal--hidden");
    loginModal.setAttribute("aria-hidden", "true");
  }

  function setViewMode(authenticated) {
    landingView.classList.toggle("landing-shell--hidden", authenticated);
    appView.classList.toggle("app-shell--hidden", !authenticated);
    if (authenticated) {
      closeLoginModal();
    }
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function formatDuration(ms) {
    if (ms == null) return "-";
    const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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
    if (["published", "success", "completed"].includes(String(status))) return "status-chip status-chip--success";
    if (["running", "generated", "selected", "active", "info"].includes(String(status))) return "status-chip status-chip--running";
    if (["failed", "error", "inactive"].includes(String(status))) return "status-chip status-chip--error";
    return "status-chip status-chip--info";
  }

  function extractYouTubeEmbed(item) {
    const id = item?.youtube_video_id || (() => {
      const url = String(item?.youtube_url || "");
      const match = url.match(/[?&]v=([^&]+)/);
      return match ? match[1] : null;
    })();
    return id ? `https://www.youtube.com/embed/${id}` : null;
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

  async function publicFetch(path) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`);
    return payload;
  }

  function setActiveButtons(activeView) {
    document.querySelectorAll("[data-view]").forEach((node) => {
      const isActive = node.getAttribute("data-view") === activeView;
      node.classList.toggle("nav-button--active", isActive && node.classList.contains("nav-button"));
    });
  }

  function setActiveView(view, pushHistory) {
    const selected = views[view] ? view : "dashboard";
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("view--active", panel.getAttribute("data-view-panel") === selected);
    });
    titleNode.textContent = views[selected].title;
    descriptionNode.textContent = views[selected].description;
    setActiveButtons(selected);
    if (pushHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", selected);
      window.history.replaceState({}, "", url);
    }
  }

  function renderLatest(item) {
    const card = qs("latestCard");
    const embed = qs("latestEmbed");
    if (!item) {
      card.innerHTML = '<div class="empty-state">No published short yet.</div>';
      embed.innerHTML = '<div class="empty-state">No video yet.</div>';
      return;
    }

    const embedUrl = extractYouTubeEmbed(item);
    const meta = `${escapeHtml(item.category || "general")} · ${escapeHtml(item.source || "catalog")} · ${escapeHtml(formatDate(item.published_at || item.selected_at))}`;
    card.innerHTML = `
      <div class="latest-card__body">
        <h3>${escapeHtml(item.title || item.topic || "Latest short")}</h3>
        <p>${meta}</p>
        ${item.youtube_url ? `<p style="margin-top:12px"><a class="nav-button nav-button--primary" href="${item.youtube_url}" target="_blank" rel="noreferrer">Open on YouTube</a></p>` : ""}
      </div>
    `;

    embed.innerHTML = embedUrl
      ? `<iframe src="${embedUrl}" title="Latest short" loading="lazy" allowfullscreen></iframe>`
      : '<div class="empty-state">Published item without embed URL.</div>';
  }

  function renderBarList(nodeId, items, labelKey, valueKey) {
    const node = qs(nodeId);
    if (!node) return;
    if (!Array.isArray(items) || items.length === 0) {
      node.innerHTML = '<div class="empty-state">No data yet.</div>';
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

  function renderTimeline(nodeId, items, mode) {
    const node = qs(nodeId);
    if (!node) return;
    if (!Array.isArray(items) || items.length === 0) {
      node.innerHTML = '<div class="empty-state">No records yet.</div>';
      return;
    }

    node.innerHTML = items
      .map((item) => {
        if (mode === "runs") {
          return `
            <article class="timeline-item">
              <div class="timeline-item__top">
                <strong>${escapeHtml(item.title || item.topic || item.topic_key || "run")}</strong>
                <span class="${getStatusClass(item.status)}">${escapeHtml(item.status || "unknown")}</span>
              </div>
              <div class="timeline-item__meta">
                <span>${escapeHtml(item.category || "-")}</span>
                <span>${escapeHtml(item.current_stage || "-")}</span>
                <span>${escapeHtml(item.source || "-")}</span>
                <span>${escapeHtml(formatDate(item.published_at || item.updated_at || item.selected_at))}</span>
              </div>
            </article>
          `;
        }

        return `
          <article class="timeline-item">
            <div class="timeline-item__top">
              <strong>${escapeHtml(item.message || item.event_type || "event")}</strong>
              <span class="${getStatusClass(item.level || "info")}">${escapeHtml(item.level || "info")}</span>
            </div>
            <div class="timeline-item__meta">
              <span>${escapeHtml(item.stage || item.source || "-")}</span>
              <span>${escapeHtml(item.topic_key || "global")}</span>
              <span>${escapeHtml(formatDate(item.created_at))}</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderMemoryChart(items) {
    const node = qs("memoryChart");
    if (!node) return;
    const samples = (Array.isArray(items) ? items : []).filter((item) => item.metric_name === "rss_mb").slice(-12);
    if (!samples.length) {
      node.innerHTML = '<div class="empty-state">No memory samples yet.</div>';
      return;
    }

    const maxValue = Math.max(...samples.map((item) => Number(item.metric_value || 0)), 1);
    node.innerHTML = samples
      .map((item) => {
        const value = Number(item.metric_value || 0);
        const height = Math.max(8, Math.round((value / maxValue) * 180));
        return `
          <div class="memory-bar">
            <div class="memory-bar__fill" style="height:${height}px"></div>
            <div class="memory-bar__label">${Math.round(value)} MB</div>
          </div>
        `;
      })
      .join("");
  }

  function renderConsoleList(nodeId, items, formatter) {
    const node = qs(nodeId);
    if (!node) return;
    if (!Array.isArray(items) || items.length === 0) {
      node.innerHTML = '<div class="empty-state">No entries yet.</div>';
      return;
    }
    node.innerHTML = items.map(formatter).join("");
  }

  function renderRunnerState(runner) {
    const state = runner || {};
    const isRunning = Boolean(state.running);
    const isError = !isRunning && (state.exitCode || state.lastError);
    const isSuccess = !isRunning && state.finishedAt && !state.exitCode && !state.lastError;

    runnerStatusNode.textContent = isRunning ? "Running" : isError ? "Error" : isSuccess ? "Completed" : "Idle";
    runnerDotNode.className = "runner-dot";
    if (isRunning) runnerDotNode.classList.add("is-running");
    if (isError) runnerDotNode.classList.add("is-error");
    if (isSuccess) runnerDotNode.classList.add("is-success");

    if (isRunning) {
      runnerCopyNode.textContent = `Executing ${state.workflowName || "workflow"} since ${formatDate(state.startedAt)}.`;
    } else if (isError) {
      runnerCopyNode.textContent = state.lastError || `Execution exited with code ${state.exitCode}.`;
    } else if (isSuccess) {
      runnerCopyNode.textContent = `Last run completed at ${formatDate(state.finishedAt)}.`;
    } else {
      runnerCopyNode.textContent = "No recent runs from the control panel.";
    }

    runnerMetaNode.textContent = [`Workflow: ${state.workflowName || "-"}`, `Start: ${formatDate(state.startedAt)}`, `End: ${formatDate(state.finishedAt)}`, `Exit: ${state.exitCode ?? "-"}`].join(" | ");
    const logText = String(state.lastError || state.stderrTail || state.stdoutTail || "No logs yet.").trim();
    runnerLogsNode.textContent = logText;
    logsConsoleNode.textContent = logText;
    runNowButton.disabled = isRunning;
    runNowButton.textContent = isRunning ? "Running..." : "Run now";
  }

  function renderWorkflowState(workflow, snapshot) {
    const state = workflow || snapshot || {};
    qs("workflowName").textContent = state.name || state.workflow_name || "-";
    qs("workflowActive").textContent = state.active ? "ON" : "OFF";
    qs("workflowTriggerCount").textContent = state.triggerCount ?? state.trigger_count ?? "-";
    qs("workflowUpdatedAt").textContent = formatDate(state.updatedAt || state.updated_at);
    qs("workflowBadge").textContent = state.active ? "active" : "inactive";
    toggleAutomationButton.textContent = state.active ? "Automation ON" : "Automation OFF";
    toggleAutomationButton.classList.toggle("nav-button--active", Boolean(state.active));
  }

  function renderN8nExecutionConsole(items) {
    renderConsoleList("executionConsole", items, (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>#${escapeHtml(item.id || item.execution_id || "-")}</strong>
          <span class="${getStatusClass(item.status || item.level || "info")}">${escapeHtml(item.status || item.level || "info")}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.mode || item.source || "-")}</span>
          <span>${escapeHtml(formatDate(item.startedAt || item.created_at))}</span>
          <span>${escapeHtml(formatDuration(item.durationMs))}</span>
        </div>
        ${item.message ? `<pre>${escapeHtml(item.message)}</pre>` : ""}
      </article>
    `);
  }

  function renderOperations(operations) {
    const data = operations || {};

    renderConsoleList("eventConsole", data.events || [], (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>${escapeHtml(item.message || item.event_type || "event")}</strong>
          <span class="${getStatusClass(item.level || "info")}">${escapeHtml(item.level || "info")}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.stage || "-")}</span>
          <span>${escapeHtml(item.source || "-")}</span>
          <span>${escapeHtml(item.topic_key || "global")}</span>
          <span>${escapeHtml(formatDate(item.created_at))}</span>
        </div>
        <pre>${escapeHtml(JSON.stringify(item.metadata || {}, null, 2))}</pre>
      </article>
    `);

    renderConsoleList("artifactConsole", data.artifacts || [], (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>${escapeHtml(item.artifact_type || "artifact")}</strong>
          <span class="${getStatusClass("info")}">${escapeHtml(item.label || "stored")}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.topic_key || "-")}</span>
          <span>${escapeHtml(item.mime_type || "-")}</span>
          <span>${escapeHtml(item.size_bytes ? `${Math.round(item.size_bytes / 1024)} KB` : "-")}</span>
          <span>${escapeHtml(formatDate(item.created_at))}</span>
        </div>
        <pre>${escapeHtml(JSON.stringify({ file_path: item.file_path, external_url: item.external_url, metadata: item.metadata || {} }, null, 2))}</pre>
      </article>
    `);

    renderConsoleList("auditConsole", data.apiAudit || [], (item) => `
      <article class="console-item">
        <div class="console-item__top">
          <strong>${escapeHtml(item.action || "request")}</strong>
          <span class="${getStatusClass(item.status_code >= 400 ? "error" : "success")}">${escapeHtml(String(item.status_code || "-"))}</span>
        </div>
        <div class="console-item__meta">
          <span>${escapeHtml(item.actor || "anonymous")}</span>
          <span>${escapeHtml(item.path || "/")}</span>
          <span>${escapeHtml(item.ip_address || "-")}</span>
          <span>${escapeHtml(formatDate(item.created_at))}</span>
        </div>
        <pre>${escapeHtml(JSON.stringify(item.metadata || {}, null, 2))}</pre>
      </article>
    `);
  }

  function renderControlCenter(data) {
    const dashboard = data.dashboard || {};
    const totals = dashboard.totals || {};
    const latest = dashboard.latestPublished || null;
    const health = data.health || {};
    const operations = dashboard.operations || {};

    qs("headerPublishedCount").textContent = String(totals.published_videos || 0);
    qs("headerLatestTitle").textContent = latest?.title || latest?.topic || "No data";
    qs("headerLastPublished").textContent = formatDate(totals.last_published_at);
    qs("totalVideos").textContent = String(totals.total_videos || 0);
    qs("generatedVideos").textContent = String(totals.generated_videos || 0);
    qs("publishedVideos").textContent = String(totals.published_videos || 0);
    qs("failedVideos").textContent = String(totals.failed_videos || 0);
    qs("categoriesCovered").textContent = String(totals.categories_covered || 0);

    qs("healthStatus").textContent = health.status || "-";
    qs("healthPersistence").textContent = health.persistence?.n8nDatabase ? "Neon" : "Local";
    qs("healthMode").textContent = health.performance?.lowMemoryMode ? "Low memory" : "Standard";
    backendLabelNode.textContent = getApiBaseUrl() || "Backend not set";

    renderLatest(latest);
    renderBarList("categoryBars", dashboard.byCategory || [], "category", "total");
    renderBarList("artifactBars", dashboard.artifactSummary || [], "artifact_type", "total");
    renderTimeline("recentRunsList", dashboard.recentRuns || [], "runs");
    renderTimeline("recentEventsList", dashboard.recentEvents || [], "events");
    renderMemoryChart(dashboard.memorySamples || []);
    renderRunnerState(data.runner);
    renderWorkflowState(data.workflow, dashboard.workflowSnapshot);
    renderN8nExecutionConsole(data.executions || []);
    renderOperations(operations);
  }

  async function loadControlCenter() {
    const payload = await apiFetch("/api/control-center");
    renderControlCenter(payload);
    return payload;
  }

  async function loadLogs() {
    const payload = await apiFetch("/api/logs");
    renderRunnerState(payload.runner);
    renderWorkflowState(payload.workflow, payload.dashboard?.workflowSnapshot);
    renderN8nExecutionConsole(payload.executions || []);
    renderOperations(payload.dashboard?.operations || {});
    return payload;
  }

  async function loadHealth() {
    const payload = await publicFetch("/health");
    qs("healthStatus").textContent = payload.status || "-";
    qs("healthPersistence").textContent = payload.persistence?.n8nDatabase ? "Neon" : "Local";
    qs("healthMode").textContent = payload.performance?.lowMemoryMode ? "Low memory" : "Standard";
    qs("healthService").textContent = payload.service || "-";
    qs("healthN8nPath").textContent = payload.routing?.n8nPath || "/app/";
    qs("healthResolution").textContent = `${payload.performance?.shortsWidth || "-"}x${payload.performance?.shortsHeight || "-"}`;
    qs("healthThreads").textContent = String(payload.performance?.ffmpegThreads || "-");
    healthJsonNode.textContent = JSON.stringify(payload, null, 2);
    return payload;
  }

  async function triggerRunNow() {
    runNowButton.disabled = true;
    runNowButton.textContent = "Starting...";
    try {
      const payload = await apiFetch("/api/run-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      renderRunnerState(payload);
      if (runPollTimer) window.clearInterval(runPollTimer);
      runPollTimer = window.setInterval(async () => {
        try {
          const statePayload = await apiFetch("/api/run-now");
          renderRunnerState(statePayload);
          if (!statePayload.running) {
            window.clearInterval(runPollTimer);
            runPollTimer = null;
            await Promise.all([loadControlCenter(), loadLogs(), loadHealth()]);
          }
        } catch (error) {
          window.clearInterval(runPollTimer);
          runPollTimer = null;
          renderFatalError(error);
        }
      }, 5000);
    } catch (error) {
      renderFatalError(error);
    }
  }

  async function toggleAutomation() {
    const nextActive = (toggleAutomationButton.textContent || "").includes("OFF");
    toggleAutomationButton.disabled = true;
    toggleAutomationButton.textContent = nextActive ? "Activating..." : "Deactivating...";
    try {
      await apiFetch("/api/workflow-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      await Promise.all([loadControlCenter(), loadLogs()]);
    } catch (error) {
      renderFatalError(error);
    } finally {
      toggleAutomationButton.disabled = false;
    }
  }

  function renderFatalError(error) {
    const message = error?.message || "Unknown error";
    runnerCopyNode.textContent = message;
    runnerLogsNode.textContent = message;
    logsConsoleNode.textContent = message;
    loginMessage.textContent = message;
  }

  async function hydrateApp() {
    const apiBase = getApiBaseUrl();
    backendLabelNode.textContent = apiBase || "Backend not configured";
    openN8nButton.href = `${apiBase}/app/`;
    await Promise.all([loadControlCenter(), loadLogs(), loadHealth()]);
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = window.setInterval(() => {
      Promise.all([loadControlCenter(), loadLogs(), loadHealth()]).catch(renderFatalError);
    }, 30000);
  }

  function stopAllTimers() {
    if (runPollTimer) window.clearInterval(runPollTimer);
    if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
    runPollTimer = null;
    autoRefreshTimer = null;
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
      setViewMode(true);
      await hydrateApp();
      setActiveView("dashboard", true);
      startAutoRefresh();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  }

  loginForm.addEventListener("submit", handleLogin);
  logoutButton.addEventListener("click", () => {
    clearSession();
    stopAllTimers();
    setViewMode(false);
    openLoginModal();
  });
  refreshDashboardButton.addEventListener("click", () => loadControlCenter().catch(renderFatalError));
  refreshHealthButton.addEventListener("click", () => loadHealth().catch(renderFatalError));
  refreshLogsButton.addEventListener("click", () => loadLogs().catch(renderFatalError));
  runNowButton.addEventListener("click", () => triggerRunNow());
  toggleAutomationButton.addEventListener("click", () => toggleAutomation());

  ["openLoginButton", "openLoginButtonHero", "openLoginButtonFooter"].forEach((id) => {
    const node = qs(id);
    if (node) node.addEventListener("click", openLoginModal);
  });
  qs("closeLoginButton").addEventListener("click", closeLoginModal);
  qs("loginBackdrop").addEventListener("click", closeLoginModal);

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-view]");
    if (!trigger) return;
    setActiveView(trigger.getAttribute("data-view"), true);
  });

  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    setActiveView(params.get("view") || "dashboard", false);
  });

  apiBaseUrlInput.value = getApiBaseUrl() || config.API_BASE_URL || "";
  usernameInput.value = config.DEFAULT_USERNAME || "admin";

  if (getToken() && getApiBaseUrl()) {
    setViewMode(true);
    hydrateApp()
      .then(() => {
        const params = new URLSearchParams(window.location.search);
        setActiveView(params.get("view") || "dashboard", true);
        startAutoRefresh();
      })
      .catch((error) => {
        clearSession();
        setViewMode(false);
        loginMessage.textContent = error.message;
      });
  } else {
    setViewMode(false);
    closeLoginModal();
  }
})();
