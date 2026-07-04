# TV Tracker (web)

A personal TV tracking app — currently watching dashboard, per-episode tracking,
an upcoming episodes calendar, real show search (via TMDB), and settings with
local backup/restore. No build step, no framework: plain HTML/CSS/JS. Your
watch data is stored in the browser's localStorage on your device.

## 1. Get a free TMDB API key

Search now runs against [The Movie Database](https://www.themoviedb.org), the
same source recommended for this project from the start.

1. Create a free account at https://www.themoviedb.org/signup
2. Go to **Settings → API** → click **Create** / **Request an API Key** → choose
   **Developer** (free, personal use, usually approved instantly)
3. Copy the **API Key (v3 auth)** value — a long string, not the "Read Access
   Token" below it

## 2. Deploy to Netlify

**Drag and drop (fastest):**
1. Go to https://app.netlify.com/drop and drag this whole folder onto the page
2. Netlify gives you a live URL immediately

**Or connect a Git repo for auto-deploys:**
1. Push this folder to a GitHub repo
2. In Netlify: **Add new site → Import an existing project** → pick the repo
3. Build command: leave blank. Publish directory: `/`. Deploy.

## 3. Add your TMDB key as an environment variable

Search won't work until this step — the API key lives server-side in a Netlify
function, never in the public JS.

1. In your Netlify site: **Site configuration → Environment variables → Add a
   variable**
2. Key: `TMDB_API_KEY`, Value: the key from step 1
3. Go to **Deploys → Trigger deploy → Deploy site** so the function picks up
   the new variable

## Install it on your iPhone

1. Open your Netlify URL in **Safari** (must be Safari, not Chrome)
2. Tap **Share** → **Add to Home Screen**
3. It launches full-screen from your home screen like a native app

## Testing locally with search working

Opening `index.html` directly in a browser works for everything except
search, since search needs the Netlify function running. To test that
locally, install the Netlify CLI and run:

```
npm install -g netlify-cli
netlify dev
```

Create a `.env` file in this folder (don't commit it) with:
```
TMDB_API_KEY=your_key_here
```
`netlify dev` reads it automatically and serves the function at
`/.netlify/functions/tmdb`, matching production.

## What's real vs. simulated

- **Search** now queries TMDB's full show database, with real posters,
  synopses, and per-season episode lists pulled in when you add a show.
- **Episode tracking, seasons, progress bars, upcoming calendar** — fully
  functional, persisted to localStorage on your device.
- **Backup/restore** download and re-import a real `.json` file of your data.
- **Notification toggles** save your preference but can't fire real push
  notifications from a static site — that needs a native app shell (Xcode) or
  a service-worker push setup, a further step beyond this version.
- The four seed shows (Severance, The Bear, Slow Horses, Fargo) are still mock
  data so the app isn't empty on first load; anything you add through Search
  is real TMDB data.

## Next steps if you want to keep building this

- Add a service worker for offline support and real push notifications
- Sync localStorage to a small backend if you want data to follow you across
  devices
- Pull streaming availability from JustWatch or Watchmode alongside TMDB
