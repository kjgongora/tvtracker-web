const TMDB_IMG = "https://image.tmdb.org/t/p";

async function fetchTmdb(path, params) {
  const qs = new URLSearchParams(params || {});
  qs.set("path", path);
  const res = await fetch(`/.netlify/functions/tmdb?${qs.toString()}`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw new Error((data && data.error) || `TMDB request failed (${res.status})`);
  }
  return data;
}

async function searchTmdbShows(query) {
  const data = await fetchTmdb("/search/tv", { query, include_adult: "false" });
  return (data.results || [])
    .filter(r => r.name)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 20);
}

async function fetchFullShow(tmdbId) {
  const details = await fetchTmdb(`/tv/${tmdbId}`);
  const seasonNumbers = (details.seasons || [])
    .map(s => s.season_number)
    .filter(n => n > 0); // skip "Specials" (season 0)

  const seasonPayloads = await Promise.all(
    seasonNumbers.map(n => fetchTmdb(`/tv/${tmdbId}/season/${n}`).catch(() => null))
  );

  const seasons = seasonPayloads
    .filter(Boolean)
    .map(sd => ({
      seasonNumber: sd.season_number,
      episodes: (sd.episodes || []).map(e => ({
        id: `tmdb${tmdbId}s${sd.season_number}e${e.episode_number}`,
        episodeNumber: e.episode_number,
        title: e.name || `Episode ${e.episode_number}`,
        airDate: e.air_date ? `${e.air_date}T12:00:00.000Z` : null,
        watched: false,
        overview: e.overview || ""
      }))
    }))
    .filter(s => s.episodes.length > 0);

  return {
    id: `tmdb-${tmdbId}`,
    tmdbId,
    title: details.name,
    posterPath: details.poster_path,
    network: (details.networks && details.networks[0] && details.networks[0].name) || "Unknown network",
    status: details.status || "Unknown",
    runtimeMinutes: (details.episode_run_time && details.episode_run_time[0]) || 30,
    synopsis: details.overview || "No synopsis available.",
    seasons
  };
}

function posterUrl(path, size) {
  return path ? `${TMDB_IMG}/${size || "w300"}${path}` : null;
}
