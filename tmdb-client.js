const TMDB_IMG = "https://image.tmdb.org/t/p";

async function fetchTmdb(path, params) {
  const qs = new URLSearchParams(params || {});
  qs.set("path", path);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(`/.netlify/functions/tmdb?${qs.toString()}`, { signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timed out reaching TMDB (${path})`);
    throw new Error(`Network error reaching TMDB (${path}): ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    throw new Error("TMDB is rate-limiting requests right now — wait a moment and try again.");
  }
  if (!res.ok || !data || data.error) {
    throw new Error((data && data.error) || `TMDB request failed (${res.status}) for ${path}`);
  }
  return data;
}

// Runs async tasks with at most `limit` in flight at once, instead of firing
// everything in parallel — avoids bursting past TMDB's rate limit when a show
// has many seasons.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function searchTmdbShows(query) {
  const data = await fetchTmdb("/search/tv", { query, include_adult: "false" });
  return (data.results || [])
    .filter(r => r.name)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 20);
}

async function fetchFullShow(tmdbId, options) {
  const includeCast = !!(options && options.includeCast);
  const appendParts = ["external_ids"];
  if (includeCast) appendParts.push("credits");
  const details = await fetchTmdb(`/tv/${tmdbId}`, { append_to_response: appendParts.join(",") });

  const imdbId = details.external_ids && details.external_ids.imdb_id;
  const tvMazeTimes = await fetchTVMazeEpisodeTimes(imdbId);

  const seasonNumbers = (details.seasons || [])
    .map(s => s.season_number)
    .filter(n => n > 0); // skip "Specials" (season 0)

  const seasonPayloads = await mapWithConcurrency(
    seasonNumbers, 4,
    n => fetchTmdb(`/tv/${tmdbId}/season/${n}`).catch(() => null)
  );

  const seasons = seasonPayloads
    .filter(Boolean)
    .map(sd => ({
      seasonNumber: sd.season_number,
      episodes: (sd.episodes || []).map(e => {
        const realAirstamp = tvMazeTimes && (
          tvMazeTimes.byNumber[`${sd.season_number}-${e.episode_number}`] ||
          (e.air_date && tvMazeTimes.byDate[e.air_date])
        );
        return {
          id: `tmdb${tmdbId}s${sd.season_number}e${e.episode_number}`,
          episodeNumber: e.episode_number,
          title: e.name || `Episode ${e.episode_number}`,
          airDate: realAirstamp ? new Date(realAirstamp).toISOString() : episodeAirDateTimeFallback(e.air_date),
          airTimeKnown: !!realAirstamp,
          watched: false,
          overview: e.overview || "",
          stillPath: e.still_path || null
        };
      })
    }))
    .filter(s => s.episodes.length > 0);

  const cast = includeCast && details.credits && details.credits.cast
    ? details.credits.cast.slice(0, 10).map(c => ({ name: c.name, character: c.character || "" }))
    : [];

  return {
    id: `tmdb-${tmdbId}`,
    tmdbId,
    title: details.name,
    posterPath: details.poster_path,
    network: (details.networks && details.networks[0] && details.networks[0].name) || "Unknown network",
    status: details.status || "Unknown",
    runtimeMinutes: (details.episode_run_time && details.episode_run_time[0]) || 30,
    synopsis: details.overview || "No synopsis available.",
    cast,
    seasons
  };
}

function posterUrl(path, size) {
  return path ? `${TMDB_IMG}/${size || "w300"}${path}` : null;
}
