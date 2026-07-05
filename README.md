# Fairway Log — Caddie

A static, offline **read-only** companion for the Fairway Log Mac app. No server,
account, analytics, or API. Your Mac is the source of truth; this app just reads
`FairwayLog-Sync.json` so your numbers ride along in your pocket.

You enter and edit data through the Mac app's desktop imports. This viewer never
writes back — there is no export.

## What it shows

- **Home** — a Today's Playbook cheat sheet (makeable putt range, go-to clubs,
  approach bias, scoring by par type), a "Work on this" weakness spotlight, and
  personal bests.
- **Bag** — a yardage book: carry/total by club with gaps flagged, plus an
  approach distance-control section with a dispersion plot and in-circle rates.
- **Greens** — practice make-rate ladder by distance (with 3-putt rates on the
  longer bands) and on-course putting.
- **Rounds** — scoring average, best, putts, fairways, greens, scrambling, a
  scoring trend sparkline, average-to-par by hole type, and recent scorecards.
- **Sync** — load the latest sync file.

All figures are derived to match the Mac dashboards (mishit-filtered launch
averages, the same approach "circle" execution model, and identical putting /
approach distance bands).

## Daily use

1. On the Mac, do your normal desktop import after a session.
2. Make sure the updated `FairwayLog-Sync.json` is in your iCloud Drive folder.
3. On the phone, open the app, go to **Sync**, and load that file. The view
   refreshes. (Loading replaces this device's cached copy.)

Numbered iPhone copies (`FairwayLog-Sync 2.json`) are fine — just pick the newest
one when loading.

## Install on iPhone

Served over HTTPS (GitHub Pages / Cloudflare Pages / Netlify). In Safari: **Share
→ Add to Home Screen**. The host only ever receives these static files; your golf
data stays in the browser and in files you explicitly load.

## Local preview

```sh
./scripts/serve_mobile.sh
```
Then open `http://localhost:8080`.

## Files

`index.html`, `styles.css`, `app.js`, `service-worker.js` (cache
`fairway-log-caddie-v3`), `manifest.webmanifest`, `icon-192.png`, `icon-512.png`.
