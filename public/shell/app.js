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

  document.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-view]");
    if (!trigger) return;

    const view = trigger.getAttribute("data-view");
    setActiveView(view, true);
  });

  refreshHealthButton.addEventListener("click", function () {
    loadHealth();
  });

  window.addEventListener("popstate", function () {
    const params = new URLSearchParams(window.location.search);
    setActiveView(params.get("view") || "dashboard", false);
  });

  const params = new URLSearchParams(window.location.search);
  setActiveView(params.get("view") || "dashboard", true);
})();
