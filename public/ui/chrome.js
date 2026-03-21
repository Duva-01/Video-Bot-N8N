(function () {
  if (window.top !== window.self) return;
  if (document.querySelector(".bot-videos-chrome")) return;

  function closePanel() {
    const panel = document.querySelector(".bot-videos-shell");
    if (!panel) return;
    panel.classList.remove("is-open");
  }

  function ensurePanel() {
    let shell = document.querySelector(".bot-videos-shell");
    if (shell) return shell;

    shell = document.createElement("div");
    shell.className = "bot-videos-shell";
    shell.innerHTML = [
      '<div class="bot-videos-shell__backdrop" data-shell-close="true"></div>',
      '<aside class="bot-videos-shell__panel">',
      '<div class="bot-videos-shell__header">',
      '<div>',
      '<div class="bot-videos-shell__eyebrow">Inline Panel</div>',
      '<strong class="bot-videos-shell__title">Dashboard</strong>',
      "</div>",
      '<button class="bot-videos-shell__close" type="button" aria-label="Cerrar panel" data-shell-close="true">×</button>',
      "</div>",
      '<div class="bot-videos-shell__body"></div>',
      "</aside>",
    ].join("");

    shell.addEventListener("click", function (event) {
      if (event.target && event.target.getAttribute("data-shell-close") === "true") {
        closePanel();
      }
    });

    document.body.appendChild(shell);
    return shell;
  }

  function setPanelContent(title, contentNode) {
    const shell = ensurePanel();
    const titleNode = shell.querySelector(".bot-videos-shell__title");
    const body = shell.querySelector(".bot-videos-shell__body");

    titleNode.textContent = title;
    body.innerHTML = "";
    body.appendChild(contentNode);
    shell.classList.add("is-open");
  }

  function openDashboardInline() {
    const iframe = document.createElement("iframe");
    iframe.className = "bot-videos-shell__iframe";
    iframe.src = "/dashboard";
    iframe.loading = "lazy";
    setPanelContent("Dashboard", iframe);
  }

  async function openHealthInline() {
    const pre = document.createElement("pre");
    pre.className = "bot-videos-shell__health";
    pre.textContent = "Cargando health...";
    setPanelContent("Health", pre);

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

  const chrome = document.createElement("div");
  chrome.className = "bot-videos-chrome";
  chrome.innerHTML = [
    '<div class="bot-videos-chrome__brand">',
    '<div class="bot-videos-chrome__mark" aria-hidden="true"></div>',
    '<div class="bot-videos-chrome__copy">',
    '<span class="bot-videos-chrome__eyebrow">Private Control Layer</span>',
    '<strong class="bot-videos-chrome__title">Facts Engine</strong>',
    '<span class="bot-videos-chrome__status">n8n + dashboard + YouTube</span>',
    "</div>",
    "</div>",
    '<div class="bot-videos-chrome__actions">',
    '<button class="bot-videos-chrome__link bot-videos-chrome__link--primary" type="button" data-inline-panel="dashboard">Dashboard</button>',
    '<button class="bot-videos-chrome__link" type="button" data-inline-panel="health">Health</button>',
    '<a class="bot-videos-chrome__link bot-videos-chrome__link--danger" href="/auth/logout">Salir</a>',
    "</div>",
  ].join("");

  chrome.addEventListener("click", function (event) {
    const trigger = event.target && event.target.closest("[data-inline-panel]");
    if (!trigger) return;

    const mode = trigger.getAttribute("data-inline-panel");
    if (mode === "dashboard") {
      openDashboardInline();
      return;
    }

    if (mode === "health") {
      openHealthInline();
    }
  });

  document.body.classList.add("bot-videos-chrome-spacing");
  document.body.appendChild(chrome);
})();
