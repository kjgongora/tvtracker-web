// TVMaze tracks each episode's actual broadcast time (as a precise UTC
// timestamp, "airstamp") rather than just a date. Its API is public and
// CORS-enabled, so this is called directly from the browser — no proxy needed.
//
// We match shows by IMDb ID (via TMDB's external_ids) rather than by name,
// since fuzzy title matching is unreliable for common show names.

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTVMazeEpisodeTimes(imdbId) {
  if (!imdbId) return null;
  try {
    const showRes = await fetchWithTimeout(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, 6000);
    if (!showRes.ok) return null; // no TVMaze match for this show
    const show = await showRes.json();
    if (!show || !show.id) return null;

    const episodesRes = await fetchWithTimeout(`https://api.tvmaze.com/shows/${show.id}/episodes`, 6000);
    if (!episodesRes.ok) return null;
    const episodes = await episodesRes.json();

    const map = {};
    (episodes || []).forEach(ep => {
      if (ep && ep.airstamp && typeof ep.season === "number" && typeof ep.number === "number") {
        map[`${ep.season}-${ep.number}`] = ep.airstamp;
      }
    });
    return map;
  } catch (err) {
    // Network failure, timeout, CORS issue, or malformed response — treat as
    // "no data", never let this block adding/tracking the show.
    return null;
  }
}
