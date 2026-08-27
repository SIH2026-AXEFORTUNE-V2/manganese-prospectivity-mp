// MapLibre's worker is loaded by URL, not by import, so Turbopack never sees it and never
// bundles it - src/components/CommandMap.tsx and MnHexMap.tsx both call
// setWorkerUrl("/maplibre-gl-worker.mjs"), which only resolves if the file is sitting in
// public/. That much was already set up by hand.
//
// The part that was missing: maplibre-gl-worker.mjs *imports* ./maplibre-gl-shared.mjs, its
// 480 KB sibling chunk. Without that second file the worker 404s on load, and the failure is
// close to invisible - deck.gl overlays keep drawing perfectly, so the map looks alive while
// the basemap underneath it stays permanently black. Both files, always, from the installed
// version, so a maplibre upgrade can't leave a stale hand-copied worker behind either.
//
// Runs from package.json's postinstall - nobody should need to remember this.

import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "node_modules", "maplibre-gl", "dist");
const dest = path.join(here, "..", "public");

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

if (!existsSync(src)) {
  console.warn(`[copy-maplibre-worker] ${src} not found - is maplibre-gl installed?`);
  process.exit(0); // don't fail `npm install` over this
}

mkdirSync(dest, { recursive: true });
for (const file of FILES) {
  const from = path.join(src, file);
  if (!existsSync(from)) {
    console.warn(`[copy-maplibre-worker] missing ${file} in maplibre-gl/dist - skipping`);
    continue;
  }
  copyFileSync(from, path.join(dest, file));
}
console.log(`[copy-maplibre-worker] copied ${FILES.join(", ")} to public/`);
