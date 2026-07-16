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
let infoShowCache = null; // full fetched show data for the currently open info screen
let infoSeasonNum = null;

// ---- Derived helpers ----
function findShow(id) {
  return shows.find(s => s.id === id);
}

// Adds `show` to the tracked list if it isn't already there, returning
// whichever object should now be treated as canonical (the existing one if
// present, so we never clobber real progress with fresh preview data).
function ensureShowTracked(show, defaultState) {
  const existing = findShow(show.id);
  if (existing) return existing;
  show.isPinned = false;
  show.state = defaultState || "watching";
  show.dateAdded = show.dateAdded || new Date().toISOString();
  shows.push(show);
  persist();
  return show;
}

function currentSeason(show) {
  const sorted = [...show.seasons].sort((a, b) => b.seasonNumber - a.seasonNumber);
  // A show should always have at least one season by the time it's added, but
  // guard anyway — a data hiccup here shouldn't crash whatever screen renders next.
  return sorted[0] || { seasonNumber: 0, episodes: [] };
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
    <div class="episode-sheet-image">${episodeImageMarkup(show, episode, "w300")}</div>
    <div class="episode-sheet-header">
      <p class="episode-sheet-eyebrow">${escapeHtml(show.title)} &middot; Season ${season.seasonNumber}</p>
      <p class="episode-sheet-title">Episode ${episode.episodeNumber} &middot; ${escapeHtml(episode.title)}</p>
      <p class="episode-sheet-date">${aired ? fmtMed(episode.airDate) : (episode.airDate ? "Airs " + fmtMed(episode.airDate) + (episode.airTimeKnown ? " at " + fmtTimeET(episode.airDate) : "") : "Air date TBA")}</p>
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
    setEpisodeWatched(episode, !episode.watched, show);
    persist();
    closeSheet();
    if (onDone) onDone();
  });

  const prevBtn = document.getElementById("ep-sheet-prev");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    for (const e of season.episodes) {
      if (e.episodeNumber === episode.episodeNumber) break;
      if (hasAired(e.airDate)) setEpisodeWatched(e, true, show);
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

function openShowInfo(result) {
  previousTab = activeTab;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-show-info").classList.add("active");
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  renderShowInfo(result);
}

function closeShowInfo() {
  setActiveTab(previousTab);
}

function renderActive() {
  if (activeTab === "watching") renderWatching();
  else if (activeTab === "library") renderLibrary();
  else if (activeTab === "upcoming") renderUpcoming();
  else if (activeTab === "search") renderSearch();
  else if (activeTab === "settings") renderSettings();
  updateFirstRunHint();
}

function updateFirstRunHint() {
  const searchTab = document.querySelector('.tab-btn[data-tab="search"]');
  if (!searchTab) return;
  searchTab.classList.toggle("tab-hint", shows.length === 0);
}

// ---- Watching screen ----
function hasAnyWatchedEpisode(show) {
  return show.seasons.some(season => season.episodes.some(ep => ep.watched));
}

// Sets watched state and records when, so "Paused" (no activity in 30 days)
// can be computed later. Always use this instead of setting ep.watched directly.
// Pass `show` when available so marking something watched also clears a
// manual pause — every call site that has the show in scope should pass it.
function setEpisodeWatched(ep, watched, show) {
  ep.watched = watched;
  ep.watchedDate = watched ? new Date().toISOString() : null;
  if (watched && show) show.manuallyPaused = false;
}

function mostRecentWatchedDate(show) {
  let latest = null;
  show.seasons.forEach(season => season.episodes.forEach(ep => {
    if (ep.watched && ep.watchedDate) {
      const d = new Date(ep.watchedDate);
      if (!latest || d > latest) latest = d;
    }
  }));
  return latest;
}

function daysSince(dateStr) {
  // Missing dateAdded means this show predates this feature — treat as "long
  // ago" so existing Not Started shows don't unexpectedly jump back into
  // Watching after this update ships.
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

// A show with progress is "paused" after 30 days of no new episodes watched,
// or if manually paused via the Pause action.
function isPaused(show) {
  if (show.manuallyPaused) return true;
  const latest = mostRecentWatchedDate(show);
  if (!latest) return false; // never watched — handled by isNotStarted, not here
  return daysSince(latest.toISOString()) >= 30;
}

// A never-watched show only counts as "Not Started" once a month has passed
// since it was added with zero engagement — until then it sits in Watching
// like anything else, so a fresh add isn't immediately buried in a cold section.
function isNotStarted(show) {
  if (hasAnyWatchedEpisode(show)) return false;
  if (show.manuallyPaused) return false; // manual pause always wins, shown in Paused instead
  return daysSince(show.dateAdded) >= 30;
}

function renderWatching() {
  const el = document.getElementById("screen-watching");
  const eligible = shows
    .filter(s => s.state === "watching")
    .map(s => ({ show: s, active: activeSeasonAndEpisode(s) }))
    .filter(entry => entry.active); // hide shows with nothing new to watch yet

  const notStarted = eligible.filter(e => isNotStarted(e.show));
  const remaining = eligible.filter(e => !isNotStarted(e.show));
  const paused = remaining.filter(e => e.show.manuallyPaused || (hasAnyWatchedEpisode(e.show) && isPaused(e.show)));
  const inProgress = remaining.filter(e => !paused.includes(e));

  // Pinned first, then by the air date of the waiting episode — most recent first
  const byRecency = (a, b) =>
    (b.show.isPinned - a.show.isPinned) ||
    (new Date(b.active.episode.airDate) - new Date(a.active.episode.airDate));
  inProgress.sort(byRecency);
  paused.sort(byRecency);
  notStarted.sort(byRecency);

  const viewMode = settings.watchingViewMode || "grid";
  const toggleBtn = `
    <div class="watching-topbar">
      <h1 class="page-title" style="margin:0;">Watching</h1>
      <button class="view-toggle-btn" id="view-toggle-btn" aria-label="${viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}">
        ${viewMode === "grid" ? ICONS.list : ICONS.grid}
      </button>
    </div>`;

  if (inProgress.length === 0 && paused.length === 0 && notStarted.length === 0) {
    el.innerHTML = toggleBtn + emptyState(
      ICONS.tv, "Nothing to watch right now", "Shows appear here once there's a new episode ready. Add a show from Search, or check Upcoming for what's airing next."
    );
    wireViewToggle();
    return;
  }

  let html = toggleBtn;
  if (viewMode === "list") {
    html += watchingListSection("Watch Next", inProgress);
    html += watchingListSection("Paused", paused);
    html += watchingListSection("Not Started", notStarted);
  } else {
    html += watchingSection("Watch Next", inProgress, "watching");
    html += watchingSection("Paused", paused, "paused");
    html += watchingSection("Not Started", notStarted, "notstarted");
  }
  el.innerHTML = html;
  wireViewToggle();

  if (viewMode === "list") {
    el.querySelectorAll(".watch-list-row").forEach(row => wireSwipeableRow(row));
  } else {
    el.querySelectorAll(".poster-card").forEach(card => {
      wireCardTapAndLongPress(card);
    });
  }
}

function wireViewToggle() {
  const btn = document.getElementById("view-toggle-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    settings.watchingViewMode = (settings.watchingViewMode || "grid") === "grid" ? "list" : "grid";
    saveSettings(settings);
    renderWatching();
  });
}

function watchingListSection(label, entries) {
  if (entries.length === 0) return "";
  let html = `<div class="section-label">${label}</div>`;
  entries.forEach(({ show, active }) => {
    html += `
      <div class="watch-list-row" data-show-id="${show.id}">
        <div class="watch-list-bg-left">${ICONS.check}<span>Watched</span></div>
        <div class="watch-list-bg-right">
          <button class="watch-list-action pause" data-action="pause">Pause</button>
          <button class="watch-list-action stop" data-action="stop">Stop</button>
        </div>
        <div class="watch-list-content">
          <div class="upcoming-poster">${posterMarkup(show, "w154")}</div>
          <div class="upcoming-info">
            <p class="upcoming-show-title">${escapeHtml(show.title)}</p>
            <p class="upcoming-ep-title">S${active.season.seasonNumber}E${active.episode.episodeNumber} &middot; ${fmtRelative(active.episode.airDate)}</p>
          </div>
        </div>
      </div>`;
  });
  return html;
}

// TV Time-style swipeable row: drag right past the threshold to mark the
// waiting episode watched; drag left to reveal Pause / Stop actions for the
// show. Uses pointer events so it works the same for touch and mouse.
function wireSwipeableRow(row) {
  const content = row.querySelector(".watch-list-content");
  const ACTION_WIDTH = 132;
  const MARK_WATCHED_THRESHOLD = 76;

  let settledX = 0;
  let startClientX = 0;
  let dragging = false;
  let didDrag = false;

  function setX(x, animate) {
    content.style.transition = animate ? "transform 0.22s ease-out" : "none";
    content.style.transform = `translateX(${x}px)`;
    const leftBg = row.querySelector(".watch-list-bg-left");
    leftBg.style.opacity = x > 8 ? Math.min(x / MARK_WATCHED_THRESHOLD, 1) : 0;
  }

  content.addEventListener("pointerdown", e => {
    dragging = true;
    didDrag = false;
    startClientX = e.clientX;
    content.setPointerCapture(e.pointerId);
  });

  content.addEventListener("pointermove", e => {
    if (!dragging) return;
    const delta = e.clientX - startClientX;
    if (Math.abs(delta) > 8) didDrag = true;
    const next = Math.max(Math.min(settledX + delta, 90), -ACTION_WIDTH - 16);
    setX(next, false);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    const delta = e.clientX - startClientX;
    const finalX = Math.max(Math.min(settledX + delta, 90), -ACTION_WIDTH - 16);

    if (finalX >= MARK_WATCHED_THRESHOLD) {
      setX(300, true);
      const showId = row.getAttribute("data-show-id");
      setTimeout(() => markNextEpisodeWatchedFromList(showId), 180);
      return;
    }
    if (finalX < -ACTION_WIDTH / 2) {
      settledX = -ACTION_WIDTH;
      setX(settledX, true);
    } else {
      settledX = 0;
      setX(settledX, true);
    }
  }

  content.addEventListener("pointerup", endDrag);
  content.addEventListener("pointercancel", endDrag);

  content.addEventListener("click", () => {
    if (settledX !== 0) { settledX = 0; setX(0, true); return; } // tap to close if open
    if (didDrag) return; // aborted swipe that snapped back — not a real tap
    const show = findShow(row.getAttribute("data-show-id"));
    if (!show) return;
    const active = activeSeasonAndEpisode(show);
    if (!active) return;
    openEpisodeSheet(show, active.season, active.episode, () => renderWatching());
  });

  row.querySelectorAll(".watch-list-action").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const showId = row.getAttribute("data-show-id");
      const show = findShow(showId);
      if (!show) return;
      if (btn.getAttribute("data-action") === "pause") {
        show.manuallyPaused = true;
        persist();
        showToast(`${show.title} paused`);
        renderWatching();
      } else {
        shows = shows.filter(s => s.id !== show.id);
        persist();
        showToast(`${show.title} removed`);
        renderWatching();
      }
    });
  });
}

function markNextEpisodeWatchedFromList(showId) {
  const show = findShow(showId);
  if (!show) return;
  const active = activeSeasonAndEpisode(show);
  if (!active) return;
  setEpisodeWatched(active.episode, true, show);
  persist();
  showToast(`${show.title} S${active.season.seasonNumber}E${active.episode.episodeNumber} marked watched`);
  renderWatching();
}

function watchingSection(label, entries, variant) {
  if (entries.length === 0) return "";
  let html = `<div class="section-label">${label}</div><div class="poster-grid">`;
  entries.forEach(({ show, active }) => {
    const p = seasonProgress(active.season);
    const sortedEps = [...active.season.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    const isPremiere = active.episode.episodeNumber === 1;
    const isFinale = active.episode.episodeNumber === sortedEps[sortedEps.length - 1].episodeNumber;
    const isNew = isRecentlyAired(active.episode.airDate) && !isPremiere && !isFinale;
    html += `
      <button class="poster-card${variant === "paused" ? " poster-paused" : ""}" data-id="${show.id}">
        <div class="poster-art">
          ${posterMarkup(show, "w342")}
          ${show.isPinned ? `<div class="poster-pin">${ICONS.pin}</div>` : ""}
          ${isNew ? `<div class="poster-new-dot" title="Aired in the last 48 hours"></div>` : ""}
          ${isPremiere ? `<div class="poster-flag premiere">Premiere</div>` : isFinale ? `<div class="poster-flag finale">Finale</div>` : ""}
          <div class="poster-ep-badge">S${active.season.seasonNumber}E${active.episode.episodeNumber}</div>
          <div class="poster-progress"><div class="poster-progress-fill" style="width:${p.pct}%"></div></div>
        </div>
        <p class="poster-title">${escapeHtml(show.title)}</p>
        <p class="poster-sub">${fmtRelative(active.episode.airDate)}</p>
      </button>`;
  });
  html += `</div>`;
  return html;
}

function emptyState(icon, title, body) {
  return `<div class="empty-state">${icon}<h3>${title}</h3><p>${body}</p></div>`;
}

function showOverallProgress(show) {
  let watched = 0, total = 0;
  show.seasons.forEach(season => season.episodes.forEach(ep => {
    total++;
    if (ep.watched) watched++;
  }));
  return { watched, total, pct: total ? Math.round((watched / total) * 100) : 0 };
}

function progressRing(pct) {
  return `<div class="progress-ring" style="background: conic-gradient(var(--accent) ${pct * 3.6}deg, var(--card-2) 0deg);" title="${pct}% watched"><div class="progress-ring-inner">${pct}</div></div>`;
}

// ---- Library screen: every show, regardless of status ----
let libraryFilter = "";

function renderLibrary() {
  const el = document.getElementById("screen-library");

  if (shows.length === 0) {
    el.innerHTML = `<h1 class="page-title">Library</h1>` + emptyState(
      ICONS.tv, "No shows yet", "Anything you add from Search will show up here."
    );
    return;
  }

  const filtered = libraryFilter.trim()
    ? shows.filter(s => s.title.toLowerCase().includes(libraryFilter.trim().toLowerCase()))
    : shows;

  const readyToWatch = [];
  const caughtUp = [];
  const watchlist = [];
  filtered.forEach(show => {
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

  let html = `<h1 class="page-title">Library</h1>
    <div class="search-input-wrap">
      <input type="text" class="search-input" id="library-filter" placeholder="Filter your shows" value="${escapeHtml(libraryFilter)}">
    </div>`;

  if (readyToWatch.length === 0 && caughtUp.length === 0 && watchlist.length === 0) {
    html += emptyState(ICONS.search, "No matches", `No shows in your library match "${escapeHtml(libraryFilter)}".`);
  } else {
    html += librarySection(null, readyToWatch);
    html += librarySection("Caught up", caughtUp);
    html += librarySection("Watchlist", watchlist);
  }
  el.innerHTML = html;

  const filterInput = document.getElementById("library-filter");
  filterInput.focus();
  const v = filterInput.value;
  filterInput.value = "";
  filterInput.value = v;
  filterInput.addEventListener("input", e => {
    libraryFilter = e.target.value;
    renderLibrary();
  });

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
  let html = label ? `<div class="section-label">${label}</div>` : "";
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
    const progress = showOverallProgress(show);
    html += `
      <div class="library-row" data-id="${show.id}">
        <div class="upcoming-poster">${posterMarkup(show, "w154")}</div>
        <div class="upcoming-info">
          <p class="upcoming-show-title">${escapeHtml(show.title)}${show.isPinned ? ` <span class="inline-pin">${ICONS.pin}</span>` : ""}</p>
          <p class="upcoming-ep-title">${status}</p>
        </div>
        ${progressRing(progress.pct)}
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
  if (show.tmdbId) {
    buttons.push({
      label: "Refresh episode data",
      action: async () => {
        showToast(`Refreshing ${show.title}\u2026`);
        try {
          await refreshShowData(show);
          showToast(`${show.title} updated`);
        } catch (err) {
          showToast("Couldn't refresh that show. Try again.");
        }
        onChange(false);
      }
    });
  }
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

// Re-fetches a show's season/episode data from TMDB + TVMaze — picking up
// corrected air times, new episodes, or a TVMaze match that failed the first
// time around — while preserving every episode's watched state and date,
// matched by episode ID (which is stable across fetches).
async function refreshShowData(show) {
  const fresh = await fetchFullShow(show.tmdbId, { includeCast: true });

  const watchedById = {};
  show.seasons.forEach(season => season.episodes.forEach(ep => {
    if (ep.watched) watchedById[ep.id] = ep.watchedDate || null;
  }));

  fresh.seasons.forEach(season => season.episodes.forEach(ep => {
    if (ep.id in watchedById) {
      ep.watched = true;
      ep.watchedDate = watchedById[ep.id];
    }
  }));

  show.seasons = fresh.seasons;
  show.synopsis = fresh.synopsis;
  show.status = fresh.status;
  show.network = fresh.network;
  show.posterPath = fresh.posterPath;
  if (fresh.cast && fresh.cast.length) show.cast = fresh.cast;
  persist();
}

// Tap opens the show; a ~500ms press-and-hold instead opens a quick-actions
// sheet (mark next episode watched, pin/unpin) without leaving the screen.
function wireCardTapAndLongPress(card) {
  let pressTimer = null;
  let longPressed = false;

  function startTimer() {
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      if (navigator.vibrate) navigator.vibrate(10);
      openCardQuickActions(card.getAttribute("data-id"));
    }, 500);
  }
  function cancelTimer() {
    clearTimeout(pressTimer);
  }

  card.addEventListener("pointerdown", startTimer);
  card.addEventListener("pointerup", cancelTimer);
  card.addEventListener("pointerleave", cancelTimer);
  card.addEventListener("pointercancel", cancelTimer);
  card.addEventListener("click", e => {
    if (longPressed) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    openDetail(card.getAttribute("data-id"));
  });
}

function openCardQuickActions(showId) {
  const show = findShow(showId);
  if (!show) return;
  const active = activeSeasonAndEpisode(show);
  const buttons = [];
  if (active) {
    buttons.push({
      label: `Mark S${active.season.seasonNumber}E${active.episode.episodeNumber} watched`,
      action: () => {
        setEpisodeWatched(active.episode, true, show);
        persist();
        showToast(`${show.title} S${active.season.seasonNumber}E${active.episode.episodeNumber} marked watched`);
        renderActive();
      }
    });
  }
  buttons.push({
    label: show.isPinned ? "Unpin" : "Pin to top",
    action: () => { show.isPinned = !show.isPinned; persist(); renderActive(); }
  });
  openSheet(show.title, buttons);
}

function posterMarkup(show, size) {
  if (show.posterPath) {
    return `<img class="poster-img" src="${posterUrl(show.posterPath, size)}" alt="" loading="lazy">`;
  }
  return iconFor(show.icon);
}

// Prefers the actual episode still (a real screenshot from that episode,
// from TMDB), falling back to the show's poster, then the icon set.
function episodeImageMarkup(show, episode, size) {
  if (episode && episode.stillPath) {
    return `<img class="episode-still-img" src="${posterUrl(episode.stillPath, size || "w300")}" alt="" loading="lazy">`;
  }
  return posterMarkup(show, size || "w300");
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
          <p class="episode-title${ep.watched ? " watched" : ""}">Episode ${ep.episodeNumber} &middot; ${escapeHtml(ep.title)}</p>
          <p class="episode-date">${aired ? fmtMed(ep.airDate) : (ep.airDate ? "Airs " + fmtMed(ep.airDate) + (ep.airTimeKnown ? " at " + fmtTimeET(ep.airDate) : "") : "Air date TBA")}</p>
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
  if (markBtn) {
    markBtn.addEventListener("click", () => {
      season.episodes.forEach(e => { if (hasAired(e.airDate)) setEpisodeWatched(e, true, show); });
      persist();
      renderDetail();
    });
  }

  el.querySelectorAll(".ep-toggle").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const n = parseInt(btn.getAttribute("data-n"));
      const ep = season.episodes.find(x => x.episodeNumber === n);
      setEpisodeWatched(ep, !ep.watched, show);
      persist();
      updateEpisodeToggleInPlace(btn, ep);
      updateSeasonHeaderInPlace(season);
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

// Updates a single episode's toggle button and title in place, instead of
// rebuilding the whole episode list — avoids replacing the exact button the
// person just clicked mid-interaction, which was a real source of the
// checkmark not reliably appearing.
function updateEpisodeToggleInPlace(btn, ep) {
  btn.classList.toggle("watched", ep.watched);
  btn.classList.toggle("unwatched", !ep.watched);
  btn.innerHTML = ep.watched ? ICONS.check : ICONS.circle;
  const row = btn.closest(".episode-row");
  const title = row && row.querySelector(".episode-title");
  if (title) title.classList.toggle("watched", ep.watched);
}

function updateSeasonHeaderInPlace(season) {
  const p = seasonProgress(season);
  const countEl = document.querySelector(".season-actions span");
  if (countEl) countEl.textContent = `${p.watched}/${p.total} watched`;
  const markBtn = document.getElementById("mark-season-btn");
  if (markBtn) {
    markBtn.disabled = p.watched === p.total;
    markBtn.textContent = p.watched === p.total ? "Season complete" : "Mark season watched";
  }
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
  // Episodes with no announced air date yet must sort to the end, not to
  // the epoch (new Date(null) === 1970-01-01, which is always "this week")
  items.sort((a, b) => {
    const ad = a.episode.airDate ? new Date(a.episode.airDate).getTime() : Infinity;
    const bd = b.episode.airDate ? new Date(b.episode.airDate).getTime() : Infinity;
    return ad - bd;
  });

  if (items.length === 0) {
    el.innerHTML = `<h1 class="page-title">Upcoming</h1>` + emptyState(
      ICONS.calendar, "Nothing scheduled", "New episodes for your shows will appear here as they're announced."
    );
    return;
  }

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 86400000);
  const groups = { Today: [], "This week": [], Later: [], "Date TBA": [] };
  items.forEach(item => {
    if (!item.episode.airDate) {
      groups["Date TBA"].push(item);
      return;
    }
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
          <div class="upcoming-date">${item.episode.airDate ? fmtShort(item.episode.airDate) : "TBA"}</div>
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
    const alreadyAdded = !!findShow(`tmdb-${r.id}`);
    html += `
      <div class="search-result-row" data-id="${r.id}">
        <div class="search-poster">${r.poster_path ? `<img class="poster-img" src="${posterUrl(r.poster_path, "w92")}" alt="" loading="lazy">` : ICONS.tv}</div>
        <div class="search-result-text">
          <p class="search-result-title">${escapeHtml(r.name)}</p>
          <p class="search-result-sub">${year}</p>
        </div>
        <button class="plus-icon${alreadyAdded ? " added" : ""}" data-id="${r.id}" aria-label="${alreadyAdded ? "Already added" : "Quick add"}">${alreadyAdded ? ICONS.check : ICONS.plusCircle}</button>
      </div>`;
  });
  el.innerHTML = html;

  el.querySelectorAll(".search-result-row").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest(".plus-icon")) return;
      const result = searchResults.find(x => String(x.id) === row.getAttribute("data-id"));
      openShowInfo(result);
    });
  });

  el.querySelectorAll(".plus-icon").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const result = searchResults.find(x => String(x.id) === btn.getAttribute("data-id"));
      const existing = findShow(`tmdb-${result.id}`);
      if (existing) {
        openDetail(existing.id);
        return;
      }
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

  let fullShow;
  try {
    // If the person just previewed this exact show on the info screen, reuse
    // that fetch instead of hitting TMDB + TVMaze again for the same data.
    fullShow = (infoShowCache && infoShowCache.tmdbId === result.id)
      ? infoShowCache
      : await fetchFullShow(result.id);
  } catch (err) {
    showToast("Couldn't add that show. Try again.");
    return null;
  }

  if (!fullShow.seasons || fullShow.seasons.length === 0) {
    showToast("Couldn't load season data for that show. Try again.");
    return null;
  }

  if (mode === "caughtUp") {
    fullShow.seasons.forEach(season => season.episodes.forEach(ep => {
      if (hasAired(ep.airDate)) setEpisodeWatched(ep, true, fullShow);
    }));
  }
  fullShow.isPinned = false;
  fullShow.state = mode === "watchlist" ? "notStarted" : "watching";
  fullShow.dateAdded = new Date().toISOString();

  // The show is fully saved as of here — everything below is display only.
  shows = shows.filter(s => s.id !== fullShow.id);
  shows.push(fullShow);
  persist();
  searchQuery = "";
  showToast(`${fullShow.title} added${mode === "watchlist" ? " to your Watchlist" : ""}`);

  try {
    setActiveTab(mode === "watchlist" ? "library" : "watching");
  } catch (renderErr) {
    // The add already succeeded — a display hiccup here must never be
    // reported to the person as "couldn't add that show".
    console.error("Render after add failed:", renderErr);
  }

  return fullShow;
}

async function renderShowInfo(result) {
  const el = document.getElementById("screen-show-info");
  const backBtn = `<div class="detail-topbar"><button class="back-btn" id="info-back">${ICONS.chevronLeft}Back</button></div>`;

  // Re-fetch only if this is a different show than whatever's cached
  if (!infoShowCache || infoShowCache.tmdbId !== result.id) {
    el.innerHTML = `${backBtn}<div class="search-loading">Loading show info&hellip;</div>`;
    document.getElementById("info-back").addEventListener("click", closeShowInfo);
    try {
      infoShowCache = await fetchFullShow(result.id, { includeCast: true });
      infoSeasonNum = currentSeason(infoShowCache).seasonNumber;
    } catch (err) {
      el.innerHTML = `${backBtn}<div class="search-error">Couldn't load info for this show.<br><span style="color: var(--text-muted); font-size: 12px;">${escapeHtml(err.message || "Unknown error")}</span></div>`;
      document.getElementById("info-back").addEventListener("click", closeShowInfo);
      return;
    }
  }

  const previewShow = infoShowCache;
  const tracked = findShow(previewShow.id);
  const alreadyAdded = !!tracked;
  const season = previewShow.seasons.find(s => s.seasonNumber === infoSeasonNum) || currentSeason(previewShow);

  let html = `${backBtn}
    <div class="detail-header">
      <div class="detail-poster">${posterMarkup(previewShow, "w300")}</div>
      <div>
        <p class="detail-title">${escapeHtml(previewShow.title)}</p>
        <p class="detail-meta">${escapeHtml(previewShow.network)} &middot; ${escapeHtml(previewShow.status)}</p>
        <p class="detail-meta">${previewShow.runtimeMinutes} min episodes</p>
      </div>
    </div>
    <p class="detail-synopsis">${escapeHtml(previewShow.synopsis)}</p>`;

  if (previewShow.cast && previewShow.cast.length) {
    const castNames = previewShow.cast.map(c => c.character ? `${c.name} as ${c.character}` : c.name);
    html += `<div class="section-label">Cast</div><p class="cast-list">${escapeHtml(castNames.join(", "))}</p>`;
  }

  html += `<div class="season-chips">`;
  [...previewShow.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber).forEach(s => {
    html += `<button class="season-chip${s.seasonNumber === season.seasonNumber ? " active" : ""}" data-n="${s.seasonNumber}">Season ${s.seasonNumber}</button>`;
  });
  html += `</div>`;

  html += `<div class="episode-list">`;
  season.episodes.forEach(ep => {
    const aired = hasAired(ep.airDate);
    // Reflect real watched state if this show is already tracked, since
    // infoShowCache itself never carries watched progress.
    const watched = tracked
      ? !!(tracked.seasons.find(s => s.seasonNumber === season.seasonNumber) || {}).episodes
          ?.find(e => e.episodeNumber === ep.episodeNumber)?.watched
      : false;
    html += `
      <div class="episode-row" data-n="${ep.episodeNumber}">
        <button class="ep-toggle ${watched ? "watched" : "unwatched"}${aired ? "" : " unaired"}" data-n="${ep.episodeNumber}" ${aired ? "" : "disabled"} aria-label="Toggle watched">
          ${watched ? ICONS.check : ICONS.circle}
        </button>
        <div class="episode-info">
          <p class="episode-title${watched ? " watched" : ""}">Episode ${ep.episodeNumber} &middot; ${escapeHtml(ep.title)}</p>
          <p class="episode-date">${aired ? fmtMed(ep.airDate) : (ep.airDate ? "Airs " + fmtMed(ep.airDate) + (ep.airTimeKnown ? " at " + fmtTimeET(ep.airDate) : "") : "Air date TBA")}</p>
        </div>
      </div>`;
  });
  html += `</div>`;

  html += `<div class="info-add-wrap">
      <button id="info-add-watchlist" class="info-add-btn" ${alreadyAdded ? "disabled" : ""}>
        ${alreadyAdded ? "Already in your library" : "Add to Watchlist"}
      </button>
    </div>`;

  el.innerHTML = html;
  document.getElementById("info-back").addEventListener("click", closeShowInfo);

  el.querySelectorAll(".season-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      infoSeasonNum = parseInt(chip.getAttribute("data-n"));
      renderShowInfo(result);
    });
  });

  el.querySelectorAll(".ep-toggle").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const n = parseInt(btn.getAttribute("data-n"));
      const ep = season.episodes.find(x => x.episodeNumber === n);
      handleInfoEpisodeToggle(previewShow, season.seasonNumber, ep);
    });
  });

  el.querySelectorAll(".episode-row").forEach(row => {
    row.addEventListener("click", () => {
      const n = parseInt(row.getAttribute("data-n"));
      const ep = season.episodes.find(x => x.episodeNumber === n);
      openInfoEpisodeSheet(previewShow, season, ep);
    });
  });

  const addBtn = document.getElementById("info-add-watchlist");
  if (addBtn && !alreadyAdded) {
    addBtn.addEventListener("click", async () => {
      addBtn.disabled = true;
      addBtn.textContent = "Adding\u2026";
      const added = await addShowFromTmdb(result, "watchlist");
      if (added) closeShowInfo();
      else {
        addBtn.disabled = false;
        addBtn.textContent = "Add to Watchlist";
      }
    });
  }
}

// Marking an episode watched from the info/preview screen means the person
// wants to actually track this show — so add it first if it isn't tracked
// yet, then apply the toggle, then hand off to the real tracked detail view.
function handleInfoEpisodeToggle(previewShow, seasonNumber, episode) {
  const wasTracked = !!findShow(previewShow.id);
  const tracked = ensureShowTracked(previewShow, "watching");
  if (!wasTracked) showToast(`${tracked.title} added to your shows`);
  const season = tracked.seasons.find(s => s.seasonNumber === seasonNumber);
  const ep = season.episodes.find(e => e.episodeNumber === episode.episodeNumber);
  setEpisodeWatched(ep, !ep.watched, tracked);
  persist();
  // `tracked` and `infoShowCache` are the same object when this is a fresh
  // add, so re-rendering the current screen (rather than navigating to the
  // full detail view) correctly shows the checkmark change in place.
  renderShowInfo({ id: tracked.tmdbId });
}

function openInfoEpisodeSheet(previewShow, season, episode) {
  const tracked = findShow(previewShow.id);
  const trackedEpisode = tracked
    ? tracked.seasons.find(s => s.seasonNumber === season.seasonNumber)?.episodes.find(e => e.episodeNumber === episode.episodeNumber)
    : null;
  const watched = trackedEpisode ? trackedEpisode.watched : false;
  const aired = hasAired(episode.airDate);

  closeSheet();
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.id = "active-sheet";
  const sheet = document.createElement("div");
  sheet.className = "sheet";

  let html = `
    <div class="episode-sheet-image">${episodeImageMarkup(previewShow, episode, "w300")}</div>
    <div class="episode-sheet-header">
      <p class="episode-sheet-eyebrow">${escapeHtml(previewShow.title)} &middot; Season ${season.seasonNumber}</p>
      <p class="episode-sheet-title">Episode ${episode.episodeNumber} &middot; ${escapeHtml(episode.title)}</p>
      <p class="episode-sheet-date">${aired ? fmtMed(episode.airDate) : (episode.airDate ? "Airs " + fmtMed(episode.airDate) + (episode.airTimeKnown ? " at " + fmtTimeET(episode.airDate) : "") : "Air date TBA")}</p>
    </div>
    <p class="episode-sheet-synopsis">${escapeHtml(episode.overview && episode.overview.trim() ? episode.overview : "No synopsis available for this episode yet.")}</p>`;

  if (aired) {
    html += `
      <div style="border-top: 0.5px solid var(--divider); margin-top: 8px;">
        <button class="sheet-btn" id="info-ep-sheet-toggle">${watched ? "Mark unwatched" : "Mark watched"}</button>
      </div>`;
  }
  html += `<button class="sheet-btn cancel" id="info-ep-sheet-close">Close</button>`;

  sheet.innerHTML = html;
  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSheet(); });
  document.body.appendChild(overlay);

  document.getElementById("info-ep-sheet-close").addEventListener("click", closeSheet);
  const toggleBtn = document.getElementById("info-ep-sheet-toggle");
  if (toggleBtn) toggleBtn.addEventListener("click", () => {
    closeSheet();
    handleInfoEpisodeToggle(previewShow, season.seasonNumber, episode);
  });
}

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

// ---- Pull to refresh (Watching / Upcoming only) ----
(function setupPullToRefresh() {
  const indicator = document.getElementById("pull-refresh-indicator");
  indicator.innerHTML = ICONS.refresh;

  const PULL_THRESHOLD = 70;
  let startY = null;
  let pulling = false;
  let refreshing = false;

  function eligibleScreen() {
    return activeTab === "watching" || activeTab === "upcoming";
  }

  document.addEventListener("touchstart", e => {
    if (!eligibleScreen() || refreshing) return;
    if (window.scrollY > 0) return; // only trigger when already at the top
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!pulling || startY === null) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) return;
    const capped = Math.min(delta, PULL_THRESHOLD * 1.6);
    indicator.style.opacity = Math.min(capped / PULL_THRESHOLD, 1);
    indicator.style.transform = `translateY(${-40 + capped}px) rotate(${capped * 3}deg)`;
    indicator.classList.toggle("spinning", capped >= PULL_THRESHOLD);
  }, { passive: true });

  document.addEventListener("touchend", e => {
    if (!pulling) return;
    const reachedThreshold = indicator.classList.contains("spinning");
    pulling = false;
    startY = null;

    if (reachedThreshold) {
      refreshing = true;
      indicator.style.opacity = "1";
      indicator.style.transform = "translateY(6px) rotate(0deg)";
      setTimeout(() => {
        renderActive();
        showToast("Refreshed");
        indicator.style.opacity = "0";
        indicator.style.transform = "translateY(-40px) rotate(0deg)";
        indicator.classList.remove("spinning");
        refreshing = false;
      }, 500);
    } else {
      indicator.style.opacity = "0";
      indicator.style.transform = "translateY(-40px) rotate(0deg)";
      indicator.classList.remove("spinning");
    }
  }, { passive: true });
})();

renderActive();
