# Rato

Rato is a local-first finance dashboard for comparing monthly household costs between two partners. Financial data is stored in this browser's IndexedDB; no account or server is required.

## Development

```sh
npm install
npm run dev
```

## GitHub Pages

The GitHub Actions workflow builds and deploys the site to GitHub Pages when changes are pushed to `main`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** once. You can also start a deployment from the workflow's **Run workflow** button.

The workflow reads the Pages base path when it builds the app, so repository pages and custom domains use the right asset URLs. Rato stores data in the browser's IndexedDB; each browser and site origin has its own separate data.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The initial release creates a generic baseline with two empty profiles. Scenario editing and the dashboard are planned for later development phases.
