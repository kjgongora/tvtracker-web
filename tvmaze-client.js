// TVMaze tracks each episode's actual broadcast time (as a precise UTC
// timestamp, "airstamp") rather than just a date. Its API is public and
// CORS-enabled (confirmed in TVMaze's own docs), so this is called directly
// from the browser — no proxy needed.
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

// TVMaze rate-limits per IP. A 429 is transient — worth one short retry
// rather than immediately giving up and silently falling back.
async function fetchWithRetry(url, timeoutMs) {
  let res = await fetchWithTimeout(url, timeoutMs);
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 1200));
    res = await fetchWithTimeout(url, timeoutMs);
  }
  return res;
}

async function fetchTVMazeEpisodeTimes(imdbId) {
  if (!imdbId) {
    console.warn("[tvmaze] no IMDb ID from TMDB for this show — can't cross-reference, falling back to date-only.");
    return null;
  }
  try {
    const showRes = await fetchWithRetry(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, 6000);
    if (showRes.status === 429) {
      console.warn(`[tvmaze] still rate-limited after retry for ${imdbId} — falling back to date-only.`);
      return null;
    }
    if (!showRes.ok) {
      console.warn(`[tvmaze] no show match for ${imdbId} (status ${showRes.status}) — falling back to date-only.`);
      return null;
    }
    const show = await showRes.json();
    if (!show || !show.id) return null;

    const episodesRes = await fetchWithRetry(`https://api.tvmaze.com/shows/${show.id}/episodes`, 6000);
    if (!episodesRes.ok) {
      console.warn(`[tvmaze] found show ${show.id} but episode list failed (status ${episodesRes.status}).`);
      return null;
    }
    const episodes = await episodesRes.json();

    // Two lookup maps: by season/episode number (the common case), and by
    // calendar date (fallback for when TMDB and TVMaze number seasons
    // differently for the same show — a real, fairly common mismatch,
    // especially for anime or shows split into "parts").
    const byNumber = {};
    const byDate = {};
    (episodes || []).forEach(ep => {
      if (!ep || !ep.airstamp) return;
      if (typeof ep.season === "number" && typeof ep.number === "number") {
        byNumber[`${ep.season}-${ep.number}`] = ep.airstamp;
      }
      if (ep.airdate) {
        byDate[ep.airdate] = ep.airstamp;
      }
    });
    return { byNumber, byDate };
  } catch (err) {
    console.warn(`[tvmaze] request failed for ${imdbId}: ${err.message} — falling back to date-only.`);
    return null;
  }
}
