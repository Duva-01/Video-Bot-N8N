(function () {
  if (window.top !== window.self) return;
  if (document.querySelector(".bot-videos-chrome")) return;

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
    '<a class="bot-videos-chrome__link bot-videos-chrome__link--primary" href="/dashboard">Dashboard</a>',
    '<a class="bot-videos-chrome__link" href="/health" target="_blank" rel="noreferrer">Health</a>',
    '<a class="bot-videos-chrome__link bot-videos-chrome__link--danger" href="/auth/logout">Salir</a>',
    "</div>",
  ].join("");

  document.body.classList.add("bot-videos-chrome-spacing");
  document.body.appendChild(chrome);
})();
