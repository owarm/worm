(async () => {
  const counts = {
    release: document.querySelector('[data-count="release"]'),
    ota: document.querySelector('[data-count="ota"]'),
  };
  const filters = [
    { label: "All", value: "all" },
    { label: "System", value: "system" },
    { label: "Apps", value: "apps" },
    { label: "Builds", value: "builds" },
    { label: "Patches", value: "patches" },
    { label: "Releases", value: "releases" },
    { label: "Network", value: "network" },
  ];

  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return response.json();
  }

  function packageRow(item) {
    const article = document.createElement("article");
    article.className = "package";

    const identity = document.createElement("div");
    identity.innerHTML = `
      <div class="device"></div>
      <div class="build"></div>
    `;
    identity.querySelector(".device").textContent = `${item.device} · ${item.codename}`;
    identity.querySelector(".build").textContent = item.buildId;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <div class="filename"></div>
      <div></div>
      <div class="sha"></div>
      <div></div>
    `;
    meta.children[0].textContent = item.filename;
    meta.children[1].textContent = item.sizeHuman;
    meta.children[2].textContent = item.sha256;
    meta.children[3].textContent = item.date;

    const link = document.createElement("a");
    link.className = "download";
    link.href = item.url;
    link.download = item.filename;
    link.textContent = "Download";

    article.append(identity, meta, link);
    return article;
  }

  function renderListing(kind, items) {
    document.body.innerHTML = `
      <main class="shell">
        <section class="page-head">
          <div>
            <p class="kicker">Worm</p>
            <h1>${kind === "release" ? "RELEASE" : "OTA"}</h1>
            <p class="subtitle">${kind === "release" ? "Factory installation packages" : "Over-the-air update packages"}</p>
          </div>
          <a class="back" href="/">Back</a>
        </section>
        <section class="list" aria-label="${kind === "release" ? "Release packages" : "OTA packages"}"></section>
      </main>
      <footer>VPN connection required</footer>
    `;

    const list = document.querySelector(".list");
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No packages available.";
      list.append(empty);
      return;
    }
    items.forEach((item) => list.append(packageRow(item)));
  }

  function setActiveNav(view) {
    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.nav === view);
    });
  }

  function timelineItem(item) {
    const article = document.createElement("article");
    article.className = "timeline-item";
    article.dataset.group = item.group;
    article.dataset.category = item.category;
    article.dataset.search = `${item.title} ${item.category} ${item.description} ${item.status || ""}`.toLowerCase();
    article.dataset.date = item.timestamp.slice(0, 10);

    const marker = document.createElement("span");
    marker.className = "timeline-marker";
    marker.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "timeline-card";
    body.innerHTML = `
      <div class="timeline-meta">
        <span class="timeline-date"></span>
        <span class="timeline-time"></span>
        <span class="category-badge"></span>
      </div>
      <h2></h2>
      <p></p>
      <div class="timeline-actions"></div>
    `;
    body.querySelector(".timeline-date").textContent = item.date;
    body.querySelector(".timeline-time").textContent = item.time;
    body.querySelector(".category-badge").textContent = item.category;
    body.querySelector(".category-badge").dataset.category = item.category;
    body.querySelector("h2").textContent = item.title;
    body.querySelector("p").textContent = item.description;

    const actions = body.querySelector(".timeline-actions");
    if (item.status) {
      const status = document.createElement("span");
      status.className = "status-pill";
      status.textContent = item.status;
      actions.append(status);
    }
    if (item.link?.url) {
      const link = document.createElement("a");
      link.href = item.link.url;
      link.textContent = item.link.label || "Open";
      link.rel = "noreferrer";
      actions.append(link);
    }

    article.append(marker, body);
    return article;
  }

  function renderRecent(events) {
    const recent = document.querySelector("[data-recent-list]");
    if (!recent) return;
    recent.textContent = "";
    events.slice(0, 5).forEach((item) => {
      const row = document.createElement("a");
      row.className = "recent-row";
      row.href = "/timeline";
      row.innerHTML = `
        <span></span>
        <strong></strong>
        <em></em>
      `;
      row.children[0].textContent = `${item.date} · ${item.time}`;
      row.children[1].textContent = item.title;
      row.children[2].textContent = item.category;
      recent.append(row);
    });
  }

  function renderTimeline(data) {
    document.body.innerHTML = `
      <main class="shell timeline-shell">
        <section class="mac-window portal-window" aria-labelledby="timeline-title">
          <div class="titlebar">
            <div class="traffic-lights" aria-hidden="true">
              <span class="traffic-light traffic-close"></span>
              <span class="traffic-light traffic-minimize"></span>
              <span class="traffic-light traffic-zoom"></span>
            </div>
            <div class="titlebar-center">
              <strong>WORM</strong>
              <span>Timeline</span>
            </div>
            <span class="connection-dot is-connected" aria-hidden="true"></span>
          </div>
          <div class="window-body portal-layout">
            <nav class="sidebar" aria-label="Portal">
              <a href="/" data-nav="overview">Overview</a>
              <a href="/timeline" data-nav="timeline">Timeline</a>
              <a href="/apps/" data-nav="apps">Apps</a>
              <a href="/release/" data-nav="builds">Builds</a>
              <a href="/release/" data-nav="releases">Releases</a>
              <a href="https://logs.coffee.pm/" data-nav="logs">Logs</a>
            </nav>
            <section class="portal-main timeline-main">
              <section class="page-head timeline-head">
                <div>
                  <p class="kicker">Europe/Rome · ${data.timezone}</p>
                  <h1 id="timeline-title">Timeline</h1>
                  <p class="subtitle">Chronological WORM project activity, newest first.</p>
                </div>
                <a class="back" href="/">Overview</a>
              </section>
              <section class="filters" aria-label="Timeline filters">
                <div class="filter-tabs" role="tablist"></div>
                <label class="search-field">
                  <span>Search</span>
                  <input data-filter-search type="search" placeholder="Search events">
                </label>
                <label class="date-field">
                  <span>Date</span>
                  <input data-filter-date type="date">
                </label>
              </section>
              <section class="timeline-list" aria-label="Project timeline"></section>
              <div class="empty timeline-empty" hidden>No matching timeline events.</div>
            </section>
          </div>
        </section>
      </main>
      <footer>VPN connection required</footer>
    `;

    setActiveNav("timeline");
    const tabs = document.querySelector(".filter-tabs");
    const list = document.querySelector(".timeline-list");
    const empty = document.querySelector(".timeline-empty");
    const search = document.querySelector("[data-filter-search]");
    const date = document.querySelector("[data-filter-date]");
    let current = "all";

    filters.forEach((filter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = filter.label;
      button.dataset.filter = filter.value;
      button.className = filter.value === current ? "is-active" : "";
      button.addEventListener("click", () => {
        current = filter.value;
        tabs.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
        applyFilters();
      });
      tabs.append(button);
    });

    data.events.forEach((item) => list.append(timelineItem(item)));

    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      const day = date.value;
      let visible = 0;
      list.querySelectorAll(".timeline-item").forEach((item) => {
        const groupMatch = current === "all" || item.dataset.group === current;
        const queryMatch = !query || item.dataset.search.includes(query);
        const dateMatch = !day || item.dataset.date === day;
        const show = groupMatch && queryMatch && dateMatch;
        item.hidden = !show;
        if (show) visible += 1;
      });
      empty.hidden = visible !== 0;
    }

    search.addEventListener("input", applyFilters);
    date.addEventListener("change", applyFilters);
    applyFilters();
  }

  try {
    const [releases, ota, timeline] = await Promise.all([
      loadJson("/public-data/releases.json"),
      loadJson("/public-data/ota.json"),
      loadJson("/public-data/timeline.json"),
    ]);

    if (counts.release) counts.release.textContent = String(releases.length);
    if (counts.ota) counts.ota.textContent = String(ota.length);
    renderRecent(timeline.events || []);
    setActiveNav("overview");

    if (location.pathname === "/release/" || location.pathname === "/release") {
      renderListing("release", releases);
    } else if (location.pathname === "/ota/" || location.pathname === "/ota") {
      renderListing("ota", ota);
    } else if (location.pathname === "/timeline/" || location.pathname === "/timeline") {
      renderTimeline(timeline);
    }
  } catch (error) {
    const target = document.querySelector(".cards") || document.querySelector(".list") || document.querySelector(".shell");
    const box = document.createElement("div");
    box.className = "error";
    box.textContent = error.message;
    target.append(box);
  }
})();
