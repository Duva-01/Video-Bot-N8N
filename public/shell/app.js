(function () {
  const views = {
    dashboard: {
      title: "Dashboard",
      description: "Vista principal con actividad, estado del pipeline y resumen operativo.",
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
  const runNowButton = document.getElementById("runNowButton");
  const runnerStatusNode = document.getElementById("runnerStatus");
  const runnerCopyNode = document.getElementById("runnerCopy");
  const runnerDotNode = document.getElementById("runnerDot");
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

    runNowButton.disabled = Boolean(isRunning);
    runNowButton.textContent = isRunning ? "Running..." : "Run now";
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

  runNowButton.addEventListener("click", function () {
    triggerRunNow();
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
