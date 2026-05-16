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
