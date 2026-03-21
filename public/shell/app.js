(function () {
  const overlay = document.getElementById("overlay");
  const overlayBody = document.getElementById("overlayBody");
  const overlayTitle = document.getElementById("overlayTitle");

  function closeOverlay() {
    overlay.classList.remove("is-open");
    overlayBody.innerHTML = "";
  }

  function openOverlay(title, node) {
    overlayTitle.textContent = title;
    overlayBody.innerHTML = "";
    overlayBody.appendChild(node);
    overlay.classList.add("is-open");
  }

  function openDashboard() {
    const iframe = document.createElement("iframe");
    iframe.className = "overlay-iframe";
    iframe.src = "/dashboard";
    iframe.loading = "lazy";
    openOverlay("Dashboard", iframe);
  }

  async function openHealth() {
    const pre = document.createElement("pre");
    pre.className = "overlay-health";
    pre.textContent = "Cargando health...";
    openOverlay("Health", pre);

    try {
      const response = await fetch("/health", {
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const payload = await response.json();
      pre.textContent = JSON.stringify(payload, null, 2);
    } catch (error) {
      pre.textContent = `No se pudo cargar /health\n\n${error.message}`;
    }
  }

  document.addEventListener("click", function (event) {
    const closeTrigger = event.target.closest("[data-close-overlay='true']");
    if (closeTrigger) {
      closeOverlay();
      return;
    }

    const panelTrigger = event.target.closest("[data-shell-panel]");
    if (!panelTrigger) return;

    const panel = panelTrigger.getAttribute("data-shell-panel");
    if (panel === "dashboard") {
      openDashboard();
      return;
    }

    if (panel === "health") {
      openHealth();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeOverlay();
    }
  });
})();
