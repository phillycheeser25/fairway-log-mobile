# Fairway Log Mobile

This is a static, offline-capable companion for the Mac app. It has no server,
account, analytics, or API connection.

## Daily sync workflow

1. On the Mac, open **Data Center → Free Mobile Sync**.
2. Choose or create `FairwayLog-Sync.json` in iCloud Drive.
3. On the phone, import that file before entering data.
4. Log a round, putting set, or launch-session summary.
5. Press **Share sync file**, choose **Save to Files**, and replace the file in
   iCloud Drive.
6. On the Mac, press **Sync Now**. The Mac also checks when it becomes active.

Sync is additive. New record IDs merge safely. Editing or deleting a record that
already exists on the other device does not propagate in this version.

## Install on an iPhone

The folder must be served over HTTPS for normal Home Screen installation and
offline caching. It can be hosted free as a static site using GitHub Pages,
Cloudflare Pages, or Netlify. The host receives only these application files;
golf data remains in the browser and in files you explicitly import or share.

After opening the HTTPS site in Safari:

1. Tap **Share**.
2. Tap **Add to Home Screen**.
3. Open Fairway Log from the new icon.

## Local preview

From the project root:

```sh
./scripts/serve_mobile.sh
```

Then open `http://localhost:8080`.
