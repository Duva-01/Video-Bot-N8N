(function () {
  const TOKEN_KEY = "facts_engine_token";
  const API_BASE_KEY = "facts_engine_api_base";
  const config = window.FACTS_APP_CONFIG || {};
  const views = {
    dashboard: {
      title: "Dashboard",
      description: "Vista principal con actividad, últimos contenidos y estado operativo.",
    },
    logs: {
      title: "Logs",
      description: "Workflow, ejecuciones recientes de n8n y salida del runner manual.",
    },
    health: {
      title: "Health",
      description: "Estado del backend, persistencia, modo low-memory y runtime actual.",
    },
  };

  const loginView = document.getElementById("loginView");
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

  let refreshTimer = null;

  function getApiBaseUrl() {
    const stored = window.localStorage.getItem(API_BASE_KEY);
    return String(stored || config.API_BASE_URL || "").replace(/\/+$/, "");
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

  function setViewMode(authenticated) {
    loginView.classList.toggle("login-layout--hidden", authenticated);
    appView.classList.toggle("app-shell--hidden", !authenticated);
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function formatDuration(value) {
    if (value == null) return "-";
    const totalSeconds = Math.max(0, Math.round(Number(value) / 1000));
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

  function extractYouTubeEmbed(item) {
    const id =
      item?.youtube_video_id ||
      (() => {
        const url = String(item?.youtube_url || "");
        const match = url.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
      })();

    return id ? `https://www.youtube.com/embed/${id}` : null;
  }

  async function apiFetch(path, options = {}) {
    const token = getToken();
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error("Falta API_BASE_URL");
    }

    const headers = {
      accept: "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }

    return payload;
  }

  async function publicFetch(path) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
  }

  function setActiveButtons(activeView) {
    document.querySelectorAll("[data-view]").forEach((node) => {
      const isActive = node.getAttribute("data-view") === activeView;
      node.classList.toggle("nav-button--active", isActive && node.classList.contains("nav-button"));
    });
  }

  function setActiveView(activeView, pushHistory) {
    const selected = views[activeView] ? activeView : "dashboard";

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

    if (selected === "logs") {
      loadLogs().catch(renderFatalError);
    }

    if (selected === "health") {
      loadHealth().catch(renderFatalError);
    }
  }

  function renderLatestPublished(item) {
    const card = document.getElementById("latestCard");
    if (!card) return;

    if (!item) {
      card.innerHTML = '<div class="latest-card__empty">Todavía no hay Shorts publicados.</div>';
      return;
    }

    const embedUrl = extractYouTubeEmbed(item);
    const parts = [];
    if (embedUrl) {
      parts.push(`<iframe src="${embedUrl}" title="Último short publicado" loading="lazy" allowfullscreen></iframe>`);
    }
    parts.push(`<h3>${escapeHtml(item.title || item.topic || "Short reciente")}</h3>`);
    parts.push(
      `<p class="latest-card__meta">${escapeHtml(item.category || "general")} · ${escapeHtml(item.source || "catalog")} · ${escapeHtml(formatDate(item.published_at || item.selected_at))}</p>`,
    );
    if (item.youtube_url) {
      parts.push(
        `<a class="inline-action inline-action--ghost" href="${item.youtube_url}" target="_blank" rel="noreferrer">Abrir en YouTube</a>`,
      );
    }

    card.innerHTML = parts.join("");
  }

  function renderRecentRuns(items) {
    const container = document.getElementById("recentRunsList");
    if (!container) return;

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = '<div class="execution-empty">Sin histórico todavía.</div>';
      return;
    }

    container.innerHTML = items
      .map(
        (item) => `
          <article class="execution-item">
            <div class="execution-item__top">
              <strong>${escapeHtml(item.title || item.topic || "Topic")}</strong>
              <span class="execution-status execution-status--${item.status === "published" ? "success" : item.status === "generated" ? "running" : "error"}">${escapeHtml(item.status || "unknown")}</span>
            </div>
            <div class="execution-item__meta">
              <span>${escapeHtml(item.category || "-")}</span>
              <span>${escapeHtml(item.source || "-")}</span>
              <span>${escapeHtml(formatDate(item.published_at || item.selected_at))}</span>
            </div>
          </article>
        `,
      )
      .join("");
  }

  function renderRunnerState(runner) {
    const state = runner || {};
    const isRunning = state.running;
    const isError = !state.running && (state.exitCode || state.lastError);
    const isSuccess = !state.running && state.finishedAt && !state.exitCode && !state.lastError;

    runnerStatusNode.textContent = isRunning ? "Running" : isError ? "Error" : isSuccess ? "Completed" : "Idle";
    runnerDotNode.className = "runner-dot";
    if (isRunning) runnerDotNode.classList.add("is-running");
    if (isError) runnerDotNode.classList.add("is-error");
    if (isSuccess) runnerDotNode.classList.add("is-success");

    if (isRunning) {
      runnerCopyNode.textContent = `Ejecutando ${state.workflowName || "workflow"} desde ${formatDate(state.startedAt)}.`;
    } else if (isError) {
      runnerCopyNode.textContent = state.lastError || `La ejecución terminó con código ${state.exitCode}.`;
    } else if (isSuccess) {
      runnerCopyNode.textContent = `Última ejecución completada: ${formatDate(state.finishedAt)}.`;
    } else {
      runnerCopyNode.textContent = "Sin ejecuciones recientes desde el frontend.";
    }

    runnerMetaNode.textContent = [
      `Workflow: ${state.workflowName || "-"}`,
      `Inicio: ${formatDate(state.startedAt)}`,
      `Fin: ${formatDate(state.finishedAt)}`,
      `Exit: ${state.exitCode ?? "-"}`,
    ].join(" | ");

    const stderrTail = String(state.stderrTail || "").trim();
    const stdoutTail = String(state.stdoutTail || "").trim();
    const lastError = String(state.lastError || "").trim();
    const logText =
      (isError && (lastError || stderrTail || stdoutTail)) ||
      (isRunning && (stderrTail || stdoutTail)) ||
      stdoutTail ||
      stderrTail ||
      "Sin logs recientes.";

    runnerLogsNode.textContent = logText;
    logsConsoleNode.textContent = logText;
    runNowButton.disabled = Boolean(isRunning);
    runNowButton.textContent = isRunning ? "Running..." : "Run now";
  }

  function renderWorkflowState(workflow) {
    const state = workflow || {};
    document.getElementById("workflowName").textContent = state.name || "-";
    document.getElementById("workflowActive").textContent = state.active ? "ON" : "OFF";
    document.getElementById("workflowTriggerCount").textContent = state.triggerCount ?? "-";
    document.getElementById("workflowUpdatedAt").textContent = formatDate(state.updatedAt);
    toggleAutomationButton.textContent = state.active ? "Automation ON" : "Automation OFF";
    toggleAutomationButton.classList.toggle("nav-button--active", Boolean(state.active));
  }

  function renderExecutions(executions) {
    const list = document.getElementById("executionList");
    if (!list) return;

    if (!Array.isArray(executions) || executions.length === 0) {
      list.innerHTML = '<div class="execution-empty">Todavía no hay ejecuciones registradas.</div>';
      return;
    }

    list.innerHTML = executions
      .map((item) => {
        const statusClass =
          item.status === "success"
            ? "execution-status execution-status--success"
            : item.status === "running"
              ? "execution-status execution-status--running"
              : "execution-status execution-status--error";

        const staleCopy = item.staleRunning ? " · stale" : "";
        return `
          <article class="execution-item">
            <div class="execution-item__top">
              <strong>#${escapeHtml(item.id)}</strong>
              <span class="${statusClass}">${escapeHtml(item.status || "unknown")}${staleCopy}</span>
            </div>
            <div class="execution-item__meta">
              <span>Inicio: ${escapeHtml(formatDate(item.startedAt))}</span>
              <span>Fin: ${escapeHtml(formatDate(item.stoppedAt))}</span>
              <span>Duración: ${escapeHtml(formatDuration(item.durationMs))}</span>
              <span>Modo: ${escapeHtml(item.mode || "-")}</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderControlCenter(data) {
    const dashboard = data.dashboard || {};
    const latest = dashboard.latestPublished || null;
    const totals = dashboard.totals || {};
    const health = data.health || {};

    document.getElementById("headerPublishedCount").textContent = String(totals.published_videos || 0);
    document.getElementById("headerLatestTitle").textContent = latest?.title || latest?.topic || "Sin datos";
    document.getElementById("headerLastPublished").textContent = formatDate(totals.last_published_at);
    document.getElementById("totalVideos").textContent = String(totals.total_videos || 0);
    document.getElementById("generatedVideos").textContent = String(totals.generated_videos || 0);
    document.getElementById("publishedVideos").textContent = String(totals.published_videos || 0);
    document.getElementById("categoriesCovered").textContent = String(totals.categories_covered || 0);

    document.getElementById("healthStatus").textContent = health.status || "-";
    document.getElementById("healthPersistence").textContent = health.persistence?.n8nDatabase ? "Neon" : "Local";
    document.getElementById("healthMode").textContent = health.performance?.lowMemoryMode ? "Low memory" : "Standard";

    renderLatestPublished(latest);
    renderRecentRuns(dashboard.recentRuns || []);
    renderRunnerState(data.runner);
    renderWorkflowState(data.workflow);
    renderExecutions(data.executions || []);
  }

  async function loadControlCenter() {
    const payload = await apiFetch("/api/control-center");
    renderControlCenter(payload);
    return payload;
  }

  async function loadLogs() {
    const payload = await apiFetch("/api/logs");
    renderWorkflowState(payload.workflow);
    renderExecutions(payload.executions);
    renderRunnerState(payload.runner);
    return payload;
  }

  async function loadHealth() {
    const payload = await publicFetch("/health");
    document.getElementById("healthStatus").textContent = payload.status || "-";
    document.getElementById("healthPersistence").textContent = payload.persistence?.n8nDatabase ? "Neon" : "Local";
    document.getElementById("healthMode").textContent = payload.performance?.lowMemoryMode ? "Low memory" : "Standard";
    document.getElementById("healthService").textContent = payload.service || "-";
    document.getElementById("healthN8nPath").textContent = payload.routing?.n8nPath || "/app/";
    document.getElementById("healthResolution").textContent =
      `${payload.performance?.shortsWidth || "-"}x${payload.performance?.shortsHeight || "-"}`;
    document.getElementById("healthThreads").textContent = String(payload.performance?.ffmpegThreads || "-");
    healthJsonNode.textContent = JSON.stringify(payload, null, 2);
    return payload;
  }

  async function triggerRunNow() {
    runNowButton.disabled = true;
    runNowButton.textContent = "Starting...";

    try {
      const payload = await apiFetch("/api/run-now", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      renderRunnerState(payload);

      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }

      refreshTimer = window.setInterval(async () => {
        try {
          const statePayload = await apiFetch("/api/run-now");
          renderRunnerState(statePayload);

          if (!statePayload.running) {
            window.clearInterval(refreshTimer);
            refreshTimer = null;
            await Promise.all([loadControlCenter(), loadLogs(), loadHealth()]);
          }
        } catch (error) {
          window.clearInterval(refreshTimer);
          refreshTimer = null;
          renderFatalError(error);
        }
      }, 5000);
    } catch (error) {
      renderFatalError(error);
    }
  }

  async function toggleAutomation() {
    const currentLabel = toggleAutomationButton.textContent || "";
    const nextActive = currentLabel.includes("OFF");
    toggleAutomationButton.disabled = true;
    toggleAutomationButton.textContent = nextActive ? "Activating..." : "Deactivating...";

    try {
      await apiFetch("/api/workflow-automation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
    const message = error?.message || "Error desconocido";
    runnerCopyNode.textContent = message;
    runnerLogsNode.textContent = message;
    logsConsoleNode.textContent = message;
  }

  async function hydrateApp() {
    const apiBase = getApiBaseUrl();
    backendLabelNode.textContent = apiBase || "Backend no configurado";
    openN8nButton.href = `${apiBase}/login?next=/app/`;
    await Promise.all([loadControlCenter(), loadLogs(), loadHealth()]);
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginMessage.textContent = "";

    try {
      const apiBase = setApiBaseUrl(apiBaseUrlInput.value);
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          username: usernameInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Login failed with status ${response.status}`);
      }

      setToken(payload.token);
      setViewMode(true);
      await hydrateApp();
      setActiveView("dashboard", true);
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  });

  logoutButton.addEventListener("click", function () {
    clearSession();
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    setViewMode(false);
  });

  refreshHealthButton.addEventListener("click", function () {
    loadHealth().catch(renderFatalError);
  });

  refreshLogsButton.addEventListener("click", function () {
    loadLogs().catch(renderFatalError);
  });

  runNowButton.addEventListener("click", function () {
    triggerRunNow();
  });

  toggleAutomationButton.addEventListener("click", function () {
    toggleAutomation();
  });

  document.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-view]");
    if (!trigger) return;
    setActiveView(trigger.getAttribute("data-view"), true);
  });

  window.addEventListener("popstate", function () {
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
      })
      .catch((error) => {
        clearSession();
        setViewMode(false);
        loginMessage.textContent = error.message;
      });
  } else {
    setViewMode(false);
  }
})();
