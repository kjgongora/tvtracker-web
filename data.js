// ---- Icons (inline SVG strings) ----
const ICONS = {
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 20h8M12 17v3" stroke-linecap="round"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2c1 4-4 5-4 9a4 4 0 008 0c0-1.5-1-2.5-1-2.5s2 1 2 4.5a5 5 0 01-10 0c0-6 5-6 5-11z" stroke-linejoin="round"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="13" cy="4" r="2"/><path d="M10 22l2-7 3 3 2 4M7 13l3-3 2 2M9 10l1-4 4 1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2v20M4 7l16 10M20 7L4 17" stroke-linecap="round"/></svg>',
  radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 000 8M16 8a6 6 0 010 8M5 5a10 10 0 000 14M19 5a10 10 0 010 14" stroke-linecap="round"/></svg>',
  mind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke-linecap="round"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18 14 14 0 010-18z"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16l1.5-5A2 2 0 017.4 9.5h9.2A2 2 0 0118.5 11L20 16" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7.5" cy="20" r="1.3"/><circle cx="16.5" cy="20" r="1.3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a6 6 0 00-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 00-6-6zm0 8a2 2 0 110-4 2 2 0 010 4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  circle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9.2"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  plusCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9.2"/><path d="M12 8v8M8 12h8" stroke-linecap="round"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-5-5" stroke-linecap="round"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M7 9l5-5 5 5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4v12M7 11l5 5 5-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20h16" stroke-linecap="round"/></svg>'
};

const POSTER_ICONS = {
  brain: ICONS.mind, flame: ICONS.flame, walk: ICONS.walk, snow: ICONS.snow,
  radio: ICONS.radio, mind: ICONS.mind, globe: ICONS.globe, car: ICONS.car, tv: ICONS.tv
};

function iconFor(name) {
  return POSTER_ICONS[name] || ICONS.tv;
}

// ---- Date helpers ----
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

// Converts a wall-clock time in America/New_York (handles EST/EDT automatically,
// no timezone library needed) into the correct UTC instant.
function easternTimeToUTC(dateStr, hour, minute) {
  const naiveUTC = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const asEasternWallClock = new Date(naiveUTC.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = naiveUTC.getTime() - asEasternWallClock.getTime();
  return new Date(naiveUTC.getTime() + offsetMs);
}

// Fallback ONLY: used when we have no real per-episode broadcast time (see
// tvmaze-client.js, which supplies the actual air time for most shows). This
// deliberately does NOT guess a time of day — it marks the episode available
// from the start of its air date in Eastern time, since assuming everything
// airs at some fixed hour (e.g. 9pm) is wrong for most shows.
function episodeAirDateTimeFallback(dateOnlyStr) {
  if (!dateOnlyStr) return null;
  return easternTimeToUTC(dateOnlyStr, 0, 0).toISOString();
}

function hasAired(isoDate) {
  if (!isoDate) return false;
  return new Date(isoDate) <= new Date();
}

function fmtShort(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtMed(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTimeET(isoDate) {
  return new Date(isoDate).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
}

// ---- Persistence ----
const STORAGE_KEY = "tvtracker_shows_v2";
const SETTINGS_KEY = "tvtracker_settings_v1";

function loadShows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveShows(shows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shows));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    notifyNewEpisode: true,
    notifySeasonPremiere: true,
    notifySeasonFinale: false,
    notifyShowReturning: true,
    lastBackup: null
  };
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
