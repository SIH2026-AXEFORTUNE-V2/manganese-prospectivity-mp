# Issue 7 — Deploy to Vercel

**Seat:** any — this is a half-hour task, not a specialism. Do it early so every other issue
gets a shareable preview URL on its own branch, not just at the end.

## Why

Nothing in this app needs a live backend — the map and every panel read static files under
`web/public/data/` (and eventually `web/public/tiles/`, issue #1). That means Vercel's static
+ serverless hosting is a straight fit with zero infrastructure decisions to make.

## Task

1. From `web/`, either use the Vercel CLI (`vercel link`, `vercel deploy`) or connect the repo
   through the Vercel dashboard. Root directory: `web/`.
2. Confirm the build command Vercel infers (`next build`) matches what
   `npm run build --prefix web` does locally — it should, we didn't customize it.
3. Make sure `web/public/data/*` and (once it exists) `web/public/tiles/*` are actually
   included in the deployed output — they're static files under `public/`, Next.js ships them
   automatically, but double check after the first deploy that `https://<preview-url>/data/manifest.json`
   actually resolves.
4. Every branch/PR gets its own preview URL automatically once the project is linked — that's
   the point of using Vercel for a 3-person build, use it instead of screen-sharing localhost.

## Acceptance criteria

- [ ] A preview URL loads the app and the map renders with real data, not a 404 on `/data/*`
- [ ] The team knows how to find their own branch's preview URL without asking
