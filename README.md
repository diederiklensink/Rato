# Rato

Rato is a local-first finance dashboard for comparing monthly household costs for two selected participants. Financial data is stored in this browser's IndexedDB; no account or server is required.

## Development

```sh
npm install
npm run dev
```

## GitHub Pages

The GitHub Actions workflow builds and deploys the site to GitHub Pages when changes are pushed to `main`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** once. You can also start a deployment from the workflow's **Run workflow** button.

The workflow reads the Pages base path when it builds the app, so repository pages and custom domains use the right asset URLs. Rato stores data in IndexedDB in the current browser, scoped to the site's origin. Another browser, device, or origin has separate data.

Use **Settings → Backup and restore** to download a versioned JSON backup or restore one. Keep the downloaded file somewhere safe if you need to move data between browsers or devices. Restoring a backup replaces the data currently stored for this browser and site origin. Changing the app currency only changes the display; it does not convert stored amounts.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The initial release creates a generic baseline with two empty profiles. The Ledger page edits profile and joint income and expenses, while Overview compares settlement results and forecasts across scenarios.
