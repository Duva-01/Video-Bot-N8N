(function () {
  const views = {
    dashboard: {
      title: "Dashboard",
      description: "Vista principal con actividad, estado del pipeline y resumen operativo.",
    },
    logs: {
      title: "Logs",
      description: "Estado del workflow, ejecuciones recientes de n8n y salida del runner de shell.",
    },
    health: {
      title: "Health",
      description: "Estado del servicio, persistencia, modo low-memory y parametros activos del runtime.",
    },
    n8n: {
      title: "n8n",
      description: "Editor embebido para workflows, ejecuciones, credenciales y automatizacion.",
    },
  };

  const titleNode = document.getElementById("viewTitle");
  const descriptionNode = document.getElementById("viewDescription");
  const healthJsonNode = document.getElementById("healthJson");
  const refreshHealthButton = document.getElementById("refreshHealth");
  const refreshLogsButton = document.getElementById("refreshLogs");
  const runNowButton = document.getElementById("runNowButton");
  const toggleAutomationButton = document.getElementById("toggleAutomationButton");
  const runnerStatusNode = document.getElementById("runnerStatus");
  const runnerCopyNode = document.getElementById("runnerCopy");
  const runnerDotNode = document.getElementById("runnerDot");
  const runnerMetaNode = document.getElementById("runnerMeta");
  const runnerLogsNode = document.getElementById("runnerLogs");
  const logsConsoleNode = document.getElementById("logsConsole");
  let refreshTimer = null;

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDuration(value) {
    if (value == null) return "-";
    const totalSeconds = Math.max(0, Math.round(Number(value) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  function renderLatestPublished(item) {
    const card = document.getElementById("latestCard");
    if (!card) return;

    if (!item) {
      card.innerHTML = '<div class="latest-card__empty">Todavia no hay Shorts publicados.</div>';
      return;
    }

    const embedUrl = extractYouTubeEmbed(item);
    const parts = [];
    if (embedUrl) {
      parts.push(`<iframe src="${embedUrl}" title="Ultimo short publicado" loading="lazy" allowfullscreen></iframe>`);
    }
    parts.push(`<h3>${item.title || item.topic || "Short reciente"}</h3>`);
    parts.push(
      `<p class="latest-card__meta">${item.category || "general"} · ${item.source || "catalog"} · ${formatDate(item.published_at || item.selected_at)}</p>`,
    );
    if (item.youtube_url) {
      parts.push(
        `<a class="inline-action inline-action--ghost" href="${item.youtube_url}" target="_blank" rel="noreferrer">Abrir en YouTube</a>`,
      );
    }

    card.innerHTML = parts.join("");
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
      runnerCopyNode.textContent = state.lastError || `La ejecucion termino con codigo ${state.exitCode}.`;
    } else if (isSuccess) {
      runnerCopyNode.textContent = `Ultima ejecucion completada: ${formatDate(state.finishedAt)}.`;
    } else {
      runnerCopyNode.textContent = "Sin ejecuciones recientes desde la shell.";
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
    if (logsConsoleNode) {
      logsConsoleNode.textContent = logText;
    }
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
      list.innerHTML = '<div class="execution-empty">Todavia no hay ejecuciones registradas.</div>';
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
              <span>Duracion: ${escapeHtml(formatDuration(item.durationMs))}</span>
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

    document.getElementById("healthStatus").textContent = health.status || "-";
    document.getElementById("healthPersistence").textContent = health.persistence?.n8nDatabase ? "Neon" : "Local";
    document.getElementById("healthMode").textContent = health.performance?.lowMemoryMode ? "Low memory" : "Standard";

    renderLatestPublished(latest);
    renderRunnerState(data.runner);
    renderWorkflowState(data.workflow);
    renderExecutions(data.executions);
  }

  function setActiveButtons(activeView) {
    document.querySelectorAll("[data-view]").forEach((node) => {
      const isActive = node.getAttribute("data-view") === activeView;
      node.classList.toggle("nav-button--active", isActive && node.classList.contains("nav-button"));
      node.classList.toggle("sidebar-link--active", isActive && node.classList.contains("sidebar-link"));
      node.classList.toggle("footer-link--active", isActive && node.classList.contains("footer-link"));
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

    if (selected === "health") {
      loadHealth();
    }

    if (selected === "logs") {
      loadLogs();
    }
  }

  async function loadHealth() {
    healthJsonNode.textContent = "Cargando health...";

    try {
      const response = await fetch("/health", {
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Health request failed with status ${response.status}`);
      }

      const payload = await response.json();

      document.getElementById("healthStatus").textContent = payload.status || "-";
      document.getElementById("healthPersistence").textContent = payload.persistence?.n8nDatabase ? "Neon" : "Local";
      document.getElementById("healthMode").textContent = payload.performance?.lowMemoryMode ? "Low memory" : "Standard";
      document.getElementById("healthService").textContent = payload.service || "-";
      document.getElementById("healthN8nPath").textContent = payload.routing?.n8nPath || "/app/";
      document.getElementById("healthResolution").textContent =
        `${payload.performance?.shortsWidth || "-"}x${payload.performance?.shortsHeight || "-"}`;
      document.getElementById("healthThreads").textContent = String(payload.performance?.ffmpegThreads || "-");
      healthJsonNode.textContent = JSON.stringify(payload, null, 2);
    } catch (error) {
      healthJsonNode.textContent = `No se pudo cargar /health\n\n${error.message}`;
    }
  }

  async function loadControlCenter() {
    const response = await fetch("/api/control-center", {
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Control center request failed with status ${response.status}`);
    }

    const payload = await response.json();
    renderControlCenter(payload);
    return payload;
  }

  async function loadLogs() {
    const response = await fetch("/api/logs", {
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Logs request failed with status ${response.status}`);
    }

    const payload = await response.json();
    renderWorkflowState(payload.workflow);
    renderExecutions(payload.executions);
    renderRunnerState(payload.runner);
    return payload;
  }

  async function toggleAutomation() {
    const currentLabel = toggleAutomationButton.textContent || "";
    const nextActive = currentLabel.includes("OFF");

    toggleAutomationButton.disabled = true;
    toggleAutomationButton.textContent = nextActive ? "Activating..." : "Deactivating...";

    try {
      const response = await fetch("/api/workflow-automation", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active: nextActive }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "No se pudo actualizar la automatizacion");
      }

      renderWorkflowState(payload);
      await loadControlCenter();
      if (document.querySelector("[data-view-panel='logs'].view--active")) {
        await loadLogs();
      }
    } catch (error) {
      if (logsConsoleNode) {
        logsConsoleNode.textContent = error.message;
      }
    } finally {
      toggleAutomationButton.disabled = false;
    }
  }

  async function triggerRunNow() {
    runNowButton.disabled = true;
    runNowButton.textContent = "Starting...";

    try {
      const response = await fetch("/api/run-now", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "No se pudo lanzar la ejecucion");
      }

      renderRunnerState(payload);

      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }

      refreshTimer = window.setInterval(async () => {
        try {
          const stateResponse = await fetch("/api/run-now", {
            credentials: "same-origin",
            headers: { accept: "application/json" },
          });
          const statePayload = await stateResponse.json();
          renderRunnerState(statePayload);

          if (!statePayload.running) {
            window.clearInterval(refreshTimer);
            refreshTimer = null;
            await loadControlCenter();
            if (document.querySelector("[data-view-panel='logs'].view--active")) {
              await loadLogs();
            }
            if (document.querySelector("[data-view-panel='health'].view--active")) {
              await loadHealth();
            }
          }
        } catch (error) {
          window.clearInterval(refreshTimer);
          refreshTimer = null;
        }
      }, 5000);
    } catch (error) {
      renderRunnerState({
        running: false,
        lastError: error.message,
      });
    }
  }

  document.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-view]");
    if (!trigger) return;

    const view = trigger.getAttribute("data-view");
    setActiveView(view, true);
  });

  refreshHealthButton.addEventListener("click", function () {
    loadHealth();
  });

  refreshLogsButton.addEventListener("click", function () {
    loadLogs().catch((error) => {
      if (logsConsoleNode) {
        logsConsoleNode.textContent = error.message;
      }
    });
  });

  runNowButton.addEventListener("click", function () {
    triggerRunNow();
  });

  toggleAutomationButton.addEventListener("click", function () {
    toggleAutomation();
  });

  window.addEventListener("popstate", function () {
    const params = new URLSearchParams(window.location.search);
    setActiveView(params.get("view") || "dashboard", false);
  });

  const params = new URLSearchParams(window.location.search);
  setActiveView(params.get("view") || "dashboard", true);
  loadControlCenter().catch((error) => {
    renderRunnerState({
      running: false,
      lastError: error.message,
    });
  });
})();
