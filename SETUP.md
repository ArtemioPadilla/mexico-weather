# Setup guide

This document describes how to run and deploy this repository.

## Local setup

1. Clone the repository.
2. Install dependencies.
3. Start the development server.

```bash
git clone https://github.com/ArtemioPadilla/mexico-weather-site.git
cd mexico-weather-site
npm install
npm run dev
```

## Optional local environment variables

You can define build metadata in a `.env` file for local runs.

```env
PUBLIC_BUILD_SHA=local
PUBLIC_VERSION=dev
```

These values are displayed in diagnostics captured by the feedback modal.

## Error monitoring (optional, opt-in)

Error monitoring with Sentry is scaffolded but **completely inert by
default**. No script is rendered, and no network requests are made, unless a
DSN is provided at build time.

To enable it, set `PUBLIC_SENTRY_DSN` the same way as `PUBLIC_BUILD_SHA`:

- Locally, add it to your `.env`:

  ```env
  PUBLIC_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
  ```

- For deployments, add `PUBLIC_SENTRY_DSN` as a repository secret and expose
  it as a build-time environment variable in `.github/workflows/cd.yml`
  (mirroring how `PUBLIC_BUILD_SHA` is wired).

When set, `BaseLayout.astro` lazy-loads the Sentry browser CDN bundle and
calls `Sentry.init({ dsn })`. When unset, nothing is emitted into the HTML.

## GitHub Pages deployment

Deployment is configured in `.github/workflows/cd.yml` and runs automatically
on pushes to `main`.

Before first deployment, make sure GitHub Pages is enabled:

1. Open repository settings.
2. Go to **Pages**.
3. Set source to **GitHub Actions**.

The Astro site uses `base: '/mexico-weather-site'`, which must match the
repository name for Pages path routing.

## Feedback issue reporting

The floating feedback button opens prefilled GitHub issues.

Verify this value in `src/components/common/FeedbackFAB.astro`:

```ts
const repoSlug = 'ArtemioPadilla/mexico-weather-site';
```

## CI checks

The CI workflow runs these validations:

- `npm run check`
- `npm run build`

Run both locally before pushing changes.
