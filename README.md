# Runway AI

Transaction-aware cash shortfall early-warning & cost-aware intervention prototype for MSME manufacturers (Innovasia 2026 — PS-04, Team Paradox).

## Local Development

```bash
npm install
npm run dev
```

## Verification & Production Build

```bash
npm test
npm run build
```

## GitHub Pages Deployment

Configured via `.github/workflows/deploy.yml` and relative asset paths (`base: './'` in `vite.config.ts`). Pushing to `main` builds, runs engine unit tests, and publishes `dist/` to GitHub Pages.
