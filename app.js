// ---- App state ----
let shows = loadShows();
let settings = loadSettings();
let activeTab = "watching";
let previousTab = "watching";
let detailShowId = null;
let detailSeasonNum = {};
let searchQuery = "";
let searchResults = [];
let searchLoading = false;
let searchError = null;
let searchDebounceTimer = null;
let addingShowId = null;

// ---- Derived helpers ----
function findShow(id) {
  return shows.find(s => s.id === id);
}

function currentSeason(show) {
  const sorted = [...show.seasons].sort((a, b) => b.seasonNumber - a.seasonNumber);
  return sorted[0];
}

function seasonProgress(season) {
  const watched = season.episodes.filter(e => e.watched).length;
  const total = season.episodes.length;
  return { watched, total, pct: total ? Math.round((watched / total) * 100) : 0 };
}

// Finds the earliest season (in air order) that still has an aired, unwatched
// episode waiting — i.e. where the person actually has something new to watch.
// Returns null if every aired episode across every season has been watched.
function activeSeasonAndEpisode(show) {
  const sorted = [...show.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
  for (const season of sorted) {
    const episode = season.episodes.find(e => !e.watched && hasAired(e.airDate));
    if (episode) return { season, episode };
  }
  return null;
}

// The season to default to when opening a show or showing its card: wherever
// the person needs to catch up, falling back to the latest season if caught up.
function defaultSeasonFor(show) {
  const active = activeSeasonAndEpisode(show);
  return active ? active.season : currentSeason(show);
}

function persist() {
  saveShows(shows);
}

// ---- Toast ----
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---- Bottom sheet ----
function openSheet(title, buttons) {
  closeSheet();
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.id = "active-sheet";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  let html = `<div class="sheet-title">${title}</div>`;
  buttons.forEach((b, i) => {
    html += `<button class="sheet-btn${b.destructive ? " destructive" : ""}" data-i="${i}">${b.label}</button>`;
  });
  html += `<button class="sheet-btn cancel" data-i="cancel">Cancel</button>`;
  sheet.innerHTML = html;
  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSheet(); });
  sheet.querySelectorAll(".sheet-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = btn.getAttribute("data-i");
      closeSheet();
      if (i !== "cancel") buttons[+i].action();
    });
  });
  document.body.appendChild(overlay);
}

function closeSheet() {
  const existing = document.getElementById("active-sheet");
  if (existing) existing.remove();
}

// Rich episode detail sheet: air date, synopsis, and (if aired) watch actions.
// onDone is called after any state change so the calling screen can re-render.
function openEpisodeSheet(show, season, episode, onDone) {
  closeSheet();
  const aired = hasAired(episode.airDate);

  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.id = "active-sheet";
  const sheet = document.createElement("div");
  sheet.className = "sheet";

  let html = `
    <div class="episode-sheet-header">
      <p class="episode-sheet-eyebrow">${escapeHtml(show.title)} &middot; Season ${season.seasonNumber}</p>
      <p class="episode-sheet-title">Episode ${episode.episodeNumber} &middot; ${escapeHtml(episode.title)}</p>
      <p class="episode-sheet-date">${aired ? fmtMed(episode.airDate) : (episode.airDate ? "Airs " + fmtMed(episode.airDate) : "Air date TBA")}</p>
    </div>
    <p class="episode-sheet-synopsis">${escapeHtml(episode.overview && episode.overview.trim() ? episode.overview : "No synopsis available for this episode yet.")}</p>`;

  if (aired) {
    html += `
      <div style="border-top: 0.5px solid var(--divider); margin-top: 8px;">
        <button class="sheet-btn" id="ep-sheet-toggle">${episode.watched ? "Mark unwatched" : "Mark watched"}</button>
        <button class="sheet-btn" id="ep-sheet-prev">Mark all before this watched</button>
      </div>`;
  }
  html += `<button class="sheet-btn cancel" id="ep-sheet-close">Close</button>`;

  sheet.innerHTML = html;
  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSheet(); });
  document.body.appendChild(overlay);

  document.getElementById("ep-sheet-close").addEventListener("click", closeSheet);

  const toggleBtn = document.getElementById("ep-sheet-toggle");
  if (toggleBtn) toggleBtn.addEventListener("click", () => {
    episode.watched = !episode.watched;
    persist();
    closeSheet();
    if (onDone) onDone();
  });

  const prevBtn = document.getElementById("ep-sheet-prev");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    for (const e of season.episodes) {
      if (e.episodeNumber === episode.episodeNumber) break;
      if (hasAired(e.airDate)) e.watched = true;
    }
    persist();
    closeSheet();
    if (onDone) onDone();
  });
}

// ---- Tab navigation ----
function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`screen-${tab}`).classList.add("active");
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderActive();
}

function openDetail(showId) {
  previousTab = activeTab;
  detailShowId = showId;
  if (!(showId in detailSeasonNum)) {
    detailSeasonNum[showId] = defaultSeasonFor(findShow(showId)).seasonNumber;
  }
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-detail").classList.add("active");
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  renderDetail();
}

function closeDetail() {
  detailShowId = null;
  setActiveTab(previousTab);
}

function renderActive() {
  if (activeTab === "watching") renderWatching();
  else if (activeTab === "library") renderLibrary();
  else if (activeTab === "upcoming") renderUpcoming();
  else if (activeTab === "search") renderSearch();
  else if (activeTab === "settings") renderSettings();
}

// ---- Watching screen ----
function renderWatching() {
  const el = document.getElementById("screen-watching");
  const watching = shows
    .filter(s => s.state === "watching")
    .map(s => ({ show: s, active: activeSeasonAndEpisode(s) }))
    .filter(entry => entry.active) // hide shows with nothing new to watch yet
    .sort((a, b) => (b.show.isPinned - a.show.isPinned) || a.show.title.localeCompare(b.show.title));

  if (watching.length === 0) {
    el.innerHTML = `<h1 class="page-title">Watching</h1>` + emptyState(
      ICONS.tv, "Nothing to watch right now", "Shows appear here once there's a new episode ready. Add a show from Search, or check Upcoming for what's airing next."
    );
    return;
  }

  let html = `<h1 class="page-title">Watching</h1><div class="poster-grid">`;
  watching.forEach(({ show, active }) => {
    const p = seasonProgress(active.season);
    html += `
      <button class="poster-card" data-id="${show.id}">
        <div class="poster-art">
          ${posterMarkup(show, "w342")}
          ${show.isPinned ? `<div class="poster-pin">${ICONS.pin}</div>` : ""}
          <div class="poster-progress"><div class="poster-progress-fill" style="width:${p.pct}%"></div></div>
        </div>
        <p class="poster-title">${escapeHtml(show.title)}</p>
        <p class="poster-sub">S${active.season.seasonNumber}E${active.episode.episodeNumber} ready</p>
      </button>`;
  });
  html += `</div>`;
  el.innerHTML = html;
  el.querySelectorAll(".poster-card").forEach(card => {
    card.addEventListener("click", () => openDetail(card.getAttribute("data-id")));
  });
}

function emptyState(icon, title, body) {
  return `<div class="empty-state">${icon}<h3>${title}</h3><p>${body}</p></div>`;
}

// ---- Library screen: every show, regardless of status ----
function renderLibrary() {
  const el = document.getElementById("screen-library");

  if (shows.length === 0) {
    el.innerHTML = `<h1 class="page-title">Library</h1>` + emptyState(
      ICONS.tv, "No shows yet", "Anything you add from Search will show up here."
    );
    return;
  }

  const readyToWatch = [];
  const caughtUp = [];
  const watchlist = [];
  shows.forEach(show => {
    if (show.state === "notStarted") {
      watchlist.push(show);
    } else if (activeSeasonAndEpisode(show)) {
      readyToWatch.push(show);
    } else {
      caughtUp.push(show);
    }
  });

  const byTitle = (a, b) => (b.isPinned - a.isPinned) || a.title.localeCompare(b.title);
  readyToWatch.sort(byTitle);
  caughtUp.sort(byTitle);
  watchlist.sort(byTitle);

  let html = `<h1 class="page-title">Library</h1>`;
  html += librarySection("New episodes ready", readyToWatch);
  html += librarySection("Caught up", caughtUp);
  html += librarySection("Watchlist", watchlist);
  el.innerHTML = html;

  el.querySelectorAll(".library-row").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest(".library-more")) return;
      openDetail(row.getAttribute("data-id"));
    });
  });

  el.querySelectorAll(".library-more").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const show = findShow(btn.getAttribute("data-id"));
      openShowActionSheet(show, () => renderLibrary());
    });
  });
}

function librarySection(label, list) {
  if (list.length === 0) return "";
  let html = `<div class="section-label">${label}</div>`;
  list.forEach(show => {
    let status;
    if (show.state === "notStarted") {
      status = "Not started";
    } else {
      const active = activeSeasonAndEpisode(show);
      status = active
        ? `S${active.season.seasonNumber}E${active.episode.episodeNumber} ready`
        : `Caught up &middot; S${currentSeason(show).seasonNumber}`;
    }
    html += `
      <div class="library-row" data-id="${show.id}">
        <div class="upcoming-poster">${posterMarkup(show, "w154")}</div>
        <div class="upcoming-info">
          <p class="upcoming-show-title">${escapeHtml(show.title)}${show.isPinned ? ` <span class="inline-pin">${ICONS.pin}</span>` : ""}</p>
          <p class="upcoming-ep-title">${status}</p>
        </div>
        <button class="library-more" data-id="${show.id}" aria-label="Show options">${ICONS.more}</button>
      </div>`;
  });
  return html;
}

// Shared "pin / move / stop watching" sheet for a show.
// onChange(wasRemoved) is called after any action so the caller can decide
// how to update the screen — re-render in place, or navigate back if removed.
function openShowActionSheet(show, onChange) {
  const buttons = [
    { label: show.isPinned ? "Unpin" : "Pin to top", action: () => { show.isPinned = !show.isPinned; persist(); onChange(false); } }
  ];
  if (show.state === "notStarted") {
    buttons.push({ label: "Start watching", action: () => { show.state = "watching"; persist(); showToast(`${show.title} moved to Watching`); onChange(false); } });
  } else {
    buttons.push({ label: "Move to watchlist", action: () => { show.state = "notStarted"; persist(); showToast(`${show.title} moved to Watchlist`); onChange(false); } });
  }
  const stopLabel = show.state === "notStarted" ? "Remove from watchlist" : "Stop watching";
  buttons.push({
    label: stopLabel, destructive: true,
    action: () => {
      shows = shows.filter(s => s.id !== show.id);
      persist();
      showToast(`${show.title} removed`);
      onChange(true);
    }
  });
  openSheet(show.title, buttons);
}

function posterMarkup(show, size) {
  if (show.posterPath) {
    return `<img class="poster-img" src="${posterUrl(show.posterPath, size)}" alt="" loading="lazy">`;
  }
  return iconFor(show.icon);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Detail screen ----
function renderDetail() {
  const el = document.getElementById("screen-detail");
  const show = findShow(detailShowId);
  if (!show) return;
  const seasonNum = detailSeasonNum[show.id];
  const season = show.seasons.find(s => s.seasonNumber === seasonNum) || currentSeason(show);
  const p = seasonProgress(season);

  let html = `
    <div class="detail-topbar">
      <button class="back-btn" id="detail-back">${ICONS.chevronLeft}Back</button>
      <button class="detail-more" id="detail-more" aria-label="Show options">${ICONS.more}</button>
    </div>`;
  html += `<div class="detail-header">
      <div class="detail-poster">${posterMarkup(show, "w300")}</div>
      <div>
        <p class="detail-title">${escapeHtml(show.title)}</p>
        <p class="detail-meta">${escapeHtml(show.network)} &middot; ${escapeHtml(show.status)}</p>
        <p class="detail-meta">${show.runtimeMinutes} min episodes</p>
      </div>
    </div>
    <p class="detail-synopsis">${escapeHtml(show.synopsis)}</p>`;

  html += `<div class="season-chips">`;
  [...show.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber).forEach(s => {
    html += `<button class="season-chip${s.seasonNumber === season.seasonNumber ? " active" : ""}" data-n="${s.seasonNumber}">Season ${s.seasonNumber}</button>`;
  });
  html += `</div>`;

  html += `<div class="season-actions">
      <span>${p.watched}/${p.total} watched</span>
      <button id="mark-season-btn" ${p.watched === p.total ? "disabled" : ""}>${p.watched === p.total ? "Season complete" : "Mark season watched"}</button>
    </div>`;

  html += `<div class="episode-list">`;
  season.episodes.forEach(ep => {
    const aired = hasAired(ep.airDate);
    html += `
      <div class="episode-row" data-n="${ep.episodeNumber}">
        <button class="ep-toggle ${ep.watched ? "watched" : "unwatched"}${aired ? "" : " unaired"}" data-n="${ep.episodeNumber}" ${aired ? "" : "disabled"} aria-label="Toggle watched">
          ${ep.watched ? ICONS.check : ICONS.circle}
        </button>
        <div class="episode-info">
          <p class="episode-title${ep.watched ? " watched" : ""}">Episode ${ep.episodeNumber} &middot; ${ep.title}</p>
          <p class="episode-date">${aired ? fmtMed(ep.airDate) : (ep.airDate ? "Airs " + fmtMed(ep.airDate) : "Air date TBA")}</p>
        </div>
      </div>`;
  });
  html += `</div>`;

  el.innerHTML = html;

  document.getElementById("detail-back").addEventListener("click", closeDetail);

  document.getElementById("detail-more").addEventListener("click", () => {
    openShowActionSheet(show, wasRemoved => {
      if (wasRemoved) closeDetail();
      else renderDetail();
    });
  });

  el.querySelectorAll(".season-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      detailSeasonNum[show.id] = parseInt(chip.getAttribute("data-n"));
      renderDetail();
    });
  });

  const markBtn = document.getElementById("mark-season-btn");
  if (markBtn && !markBtn.disabled) {
    markBtn.addEventListener("click", () => {
      season.episodes.forEach(e => { if (hasAired(e.airDate)) e.watched = true; });
      persist();
      renderDetail();
    });
  }

  el.querySelectorAll(".ep-toggle").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const n = parseInt(btn.getAttribute("data-n"));
      const ep = season.episodes.find(x => x.episodeNumber === n);
      ep.watched = !ep.watched;
      persist();
      renderDetail();
    });
  });

  el.querySelectorAll(".episode-row").forEach(row => {
    row.addEventListener("click", () => {
      const n = parseInt(row.getAttribute("data-n"));
      const ep = season.episodes.find(x => x.episodeNumber === n);
      openEpisodeSheet(show, season, ep, renderDetail);
    });
  });
}

// ---- Upcoming screen ----
function renderUpcoming() {
  const el = document.getElementById("screen-upcoming");
  const items = [];
  shows.forEach(show => {
    show.seasons.forEach(season => {
      const sorted = [...season.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
      sorted.forEach(ep => {
        if (!ep.watched && !hasAired(ep.airDate)) {
          items.push({
            show, episode: ep, seasonNumber: season.seasonNumber,
            isPremiere: ep.episodeNumber === 1,
            isFinale: ep.episodeNumber === sorted[sorted.length - 1].episodeNumber
          });
        }
      });
    });
  });
  items.sort((a, b) => new Date(a.episode.airDate) - new Date(b.episode.airDate));

  if (items.length === 0) {
    el.innerHTML = `<h1 class="page-title">Upcoming</h1>` + emptyState(
      ICONS.calendar, "Nothing scheduled", "New episodes for your shows will appear here as they're announced."
    );
    return;
  }

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 86400000);
  const groups = { Today: [], "This week": [], Later: [] };
  items.forEach(item => {
    const d = new Date(item.episode.airDate);
    if (d.toDateString() === now.toDateString()) groups.Today.push(item);
    else if (d <= weekOut) groups["This week"].push(item);
    else groups.Later.push(item);
  });

  let html = `<h1 class="page-title">Upcoming</h1>`;
  Object.entries(groups).forEach(([label, list]) => {
    if (list.length === 0) return;
    html += `<div class="section-label">${label}</div>`;
    list.forEach(item => {
      html += `
        <div class="upcoming-row" data-show="${item.show.id}" data-season="${item.seasonNumber}" data-ep="${item.episode.episodeNumber}">
          <div class="upcoming-poster">${posterMarkup(item.show, "w154")}</div>
          <div class="upcoming-info">
            <p class="upcoming-show-title">${escapeHtml(item.show.title)}</p>
            <p class="upcoming-ep-title">E${item.episode.episodeNumber} &middot; ${escapeHtml(item.episode.title)}</p>
            ${item.isPremiere ? `<span class="tag premiere">Season premiere</span>` : ""}
            ${item.isFinale ? `<span class="tag finale">Season finale</span>` : ""}
          </div>
          <div class="upcoming-date">${fmtShort(item.episode.airDate)}</div>
        </div>`;
    });
  });
  el.innerHTML = html;

  el.querySelectorAll(".upcoming-row").forEach(row => {
    row.addEventListener("click", () => {
      const show = findShow(row.getAttribute("data-show"));
      const seasonNum = parseInt(row.getAttribute("data-season"));
      const epNum = parseInt(row.getAttribute("data-ep"));
      const season = show.seasons.find(s => s.seasonNumber === seasonNum);
      const episode = season.episodes.find(e => e.episodeNumber === epNum);
      openEpisodeSheet(show, season, episode, renderUpcoming);
    });
  });
}

// ---- Search screen (backed by TMDB via the Netlify function) ----
function renderSearch() {
  const el = document.getElementById("screen-search");
  el.innerHTML = `
    <h1 class="page-title">Search</h1>
    <div class="search-input-wrap">
      <input type="text" class="search-input" id="search-input" placeholder="Search shows" value="${escapeHtml(searchQuery)}">
    </div>
    <div id="search-results"></div>`;

  const input = document.getElementById("search-input");
  // Move cursor to the end without re-triggering input events
  input.focus();
  const v = input.value;
  input.value = "";
  input.value = v;

  input.addEventListener("input", e => {
    searchQuery = e.target.value;
    clearTimeout(searchDebounceTimer);
    if (!searchQuery.trim()) {
      searchResults = [];
      searchError = null;
      searchLoading = false;
      renderSearchResults();
      return;
    }
    searchLoading = true;
    renderSearchResults();
    searchDebounceTimer = setTimeout(() => performSearch(searchQuery), 350);
  });

  renderSearchResults();
}

async function performSearch(query) {
  try {
    const results = await searchTmdbShows(query);
    if (query !== searchQuery) return; // stale response, a newer query has since fired
    searchResults = results;
    searchError = null;
  } catch (err) {
    if (query !== searchQuery) return;
    searchResults = [];
    searchError = "Couldn't reach the show database. Check your connection, or that TMDB_API_KEY is set on this Netlify site, and try again.";
  }
  searchLoading = false;
  renderSearchResults();
}

function renderSearchResults() {
  const el = document.getElementById("search-results");
  if (!el) return;

  if (!searchQuery.trim()) {
    el.innerHTML = emptyState(ICONS.search, "Search for a show", "Find a show to start tracking your progress.");
    return;
  }
  if (searchLoading) {
    el.innerHTML = `<div class="search-loading">Searching&hellip;</div>`;
    return;
  }
  if (searchError) {
    el.innerHTML = `<div class="search-error">${escapeHtml(searchError)}</div>`;
    return;
  }
  if (searchResults.length === 0) {
    el.innerHTML = emptyState(ICONS.search, "No results", `No shows found for "${escapeHtml(searchQuery)}".`);
    return;
  }

  let html = "";
  searchResults.forEach(r => {
    const year = r.first_air_date ? r.first_air_date.slice(0, 4) : "";
    html += `
      <button class="search-result-row" data-id="${r.id}">
        <div class="search-poster">${r.poster_path ? `<img class="poster-img" src="${posterUrl(r.poster_path, "w92")}" alt="" loading="lazy">` : ICONS.tv}</div>
        <div>
          <p class="search-result-title">${escapeHtml(r.name)}</p>
          <p class="search-result-sub">${year}</p>
        </div>
        <div class="plus-icon">${ICONS.plusCircle}</div>
      </button>`;
  });
  el.innerHTML = html;

  el.querySelectorAll(".search-result-row").forEach(row => {
    row.addEventListener("click", () => {
      const result = searchResults.find(x => String(x.id) === row.getAttribute("data-id"));
      openSheet("How do you want to track this?", [
        { label: "Start from the beginning", action: () => addShowFromTmdb(result, "beginning") },
        { label: "Mark all previous watched", action: () => addShowFromTmdb(result, "caughtUp") },
        { label: "Add to watchlist only", action: () => addShowFromTmdb(result, "watchlist") }
      ]);
    });
  });
}

async function addShowFromTmdb(result, mode) {
  showToast(`Adding ${result.name}\u2026`);
  try {
    const fullShow = await fetchFullShow(result.id);
    if (mode === "caughtUp") {
      fullShow.seasons.forEach(season => season.episodes.forEach(ep => {
        if (hasAired(ep.airDate)) ep.watched = true;
      }));
    }
    fullShow.isPinned = false;
    fullShow.state = mode === "watchlist" ? "notStarted" : "watching";

    shows = shows.filter(s => s.id !== fullShow.id);
    shows.push(fullShow);
    persist();
    searchQuery = "";
    showToast(`${fullShow.title} added to your shows`);
    setActiveTab("watching");
  } catch (err) {
    showToast("Couldn't add that show. Try again.");
  }
}

// ---- Settings screen ----
function renderSettings() {
  const el = document.getElementById("screen-settings");
  el.innerHTML = `
    <h1 class="page-title">Settings</h1>

    <div class="settings-section">
      <p class="settings-section-label">Data</p>
      <div class="settings-group">
        <div class="settings-row"><button class="row-btn" id="backup-btn">Back up data</button></div>
        <div class="settings-row"><button class="row-btn" id="restore-btn">Restore from backup</button></div>
      </div>
      <p class="settings-footer" id="backup-footer">
        ${settings.lastBackup ? `Last backup: ${new Date(settings.lastBackup).toLocaleString()}` : "Your watch history and progress are stored on this device. Back up to export a copy."}
      </p>
      <input type="file" id="restore-file" accept="application/json" style="display:none">
    </div>

    <div class="settings-section">
      <p class="settings-section-label">Notifications</p>
      <div class="settings-group">
        ${toggleRow("New episode airing", "notifyNewEpisode")}
        ${toggleRow("Season premiere", "notifySeasonPremiere")}
        ${toggleRow("Season finale", "notifySeasonFinale")}
        ${toggleRow("Show returning from hiatus", "notifyShowReturning")}
      </div>
      <p class="settings-footer">Notifications require a native app shell to fire in the background; this toggles the preference only.</p>
    </div>

    <div class="settings-section">
      <p class="settings-section-label">About</p>
      <div class="settings-group">
        <div class="settings-row"><span class="settings-label">Theme</span><span class="settings-value">Dark</span></div>
        <div class="settings-row"><span class="settings-label">Version</span><span class="settings-value">1.0.0</span></div>
      </div>
    </div>`;

  document.querySelectorAll(".settings-toggle").forEach(input => {
    input.addEventListener("change", () => {
      settings[input.getAttribute("data-key")] = input.checked;
      saveSettings(settings);
    });
  });

  document.getElementById("backup-btn").addEventListener("click", performBackup);
  document.getElementById("restore-btn").addEventListener("click", () => {
    openSheet("Restore from backup", [
      { label: "Choose backup file", action: () => document.getElementById("restore-file").click() }
    ]);
  });
  document.getElementById("restore-file").addEventListener("change", handleRestoreFile);
}

function toggleRow(label, key) {
  const checked = settings[key] ? "checked" : "";
  return `
    <div class="settings-row">
      <span class="settings-label">${label}</span>
      <label class="switch">
        <input type="checkbox" class="settings-toggle" data-key="${key}" ${checked}>
        <span class="switch-track"></span>
        <span class="switch-thumb"></span>
      </label>
    </div>`;
}

function performBackup() {
  const payload = { exportedAt: new Date().toISOString(), shows, settings };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tvtracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  settings.lastBackup = new Date().toISOString();
  saveSettings(settings);
  showToast("Backup file downloaded");
  renderSettings();
}

function handleRestoreFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.shows)) {
        shows = data.shows;
        persist();
      }
      if (data.settings) {
        settings = data.settings;
        saveSettings(settings);
      }
      showToast("Backup restored");
      setActiveTab("watching");
    } catch (err) {
      showToast("Couldn't read that file");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

// ---- Init ----
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => setActiveTab(btn.getAttribute("data-tab")));
});

renderActive();
