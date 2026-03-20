function formatRelativeDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function renderTimeline(items) {
  const root = document.getElementById("timelineChart");
  if (!root) return;
  root.innerHTML = "";

  if (!items.length) {
    root.innerHTML = '<div class="empty">Sin actividad todavia</div>';
    return;
  }

  const max = Math.max(...items.map((item) => Number(item.total) || 0), 1);
  items.forEach((item, index) => {
    const bar = document.createElement("div");
    bar.className = "spark-bar";
    bar.style.height = `${Math.max(16, Math.round(((Number(item.total) || 0) / max) * 120))}px`;
    bar.style.animationDelay = `${index * 50}ms`;

    const label = document.createElement("span");
    label.textContent = item.day.slice(5);
    bar.appendChild(label);
    root.appendChild(bar);
  });
}

function renderProgressRows(rootId, items, color) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = "";

  if (!items.length) {
    root.innerHTML = '<div class="empty">Sin datos todavia</div>';
    return;
  }

  const max = Math.max(...items.map((item) => Number(item.total) || 0), 1);

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = rootId === "categoryChart" ? "category-row" : "status-row";

    const label = document.createElement("div");
    label.textContent = item.category || item.status;

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${((Number(item.total) || 0) / max) * 100}%`;
    if (color) {
      fill.style.background = color;
    }

    track.appendChild(fill);

    const value = document.createElement("div");
    value.textContent = item.total;

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);
    root.appendChild(row);
  });
}

function renderRecent(items) {
  const root = document.getElementById("recentList");
  if (!root) return;
  root.innerHTML = "";

  if (!items.length) {
    root.innerHTML = '<div class="empty">Todavia no hay videos registrados en Neon.</div>';
    return;
  }

  items.forEach((item) => {
    const wrapper = document.createElement("article");
    wrapper.className = "recent-item";

    const top = document.createElement("div");
    top.className = "recent-top";

    const titleBlock = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.title || item.topic;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `${item.category} · ${item.angle} · ${item.source || "catalog"}`;
    titleBlock.appendChild(title);
    titleBlock.appendChild(meta);

    const status = document.createElement("span");
    status.className = "pill";
    status.textContent = item.status;

    top.appendChild(titleBlock);
    top.appendChild(status);

    const detail = document.createElement("p");
    detail.className = "meta";
    detail.textContent = `Seleccionado: ${formatRelativeDate(item.selected_at)} · Publicado: ${formatRelativeDate(item.published_at)}`;

    wrapper.appendChild(top);
    wrapper.appendChild(detail);

    if (item.youtube_url) {
      const link = document.createElement("a");
      link.className = "button secondary";
      link.href = item.youtube_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Abrir Short";
      wrapper.appendChild(link);
    }

    root.appendChild(wrapper);
  });
}

async function boot() {
  const response = await fetch("/api/dashboard");
  if (!response.ok) {
    throw new Error(`Dashboard request failed with status ${response.status}`);
  }

  const data = await response.json();

  setText("modeValue", data.mode || "youtube-facts-only");
  setText("categoriesValue", String((data.defaults?.categories || []).length));
  setText("databaseValue", data.databaseConfigured ? "Conectada" : "No configurada");
  setText("totalVideos", String(data.totals?.total_videos || 0));
  setText("publishedVideos", String(data.totals?.published_videos || 0));
  setText("categoriesCovered", String(data.totals?.categories_covered || 0));
  setText("lastPublished", formatRelativeDate(data.totals?.last_published_at));

  renderTimeline(data.timeline || []);
  renderProgressRows("statusBars", data.byStatus || []);
  renderProgressRows("categoryChart", data.byCategory || [], "linear-gradient(90deg, #ffd169, #ff7f6b)");
  renderRecent(data.recentRuns || []);
}

boot().catch((error) => {
  const root = document.getElementById("recentList");
  if (root) {
    root.innerHTML = `<div class="empty">${error.message}</div>`;
  }
});
