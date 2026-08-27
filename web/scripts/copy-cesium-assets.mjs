// Cesium's Assets/Workers/ThirdParty/Widgets folders (skybox textures, the IAU2006 star
// catalog, terrain-processing web workers, widget CSS/images) are ~90MB of generated static
// files - correctly gitignored (public/cesium, see .gitignore), but that means every fresh
// `npm install` needs this step to actually put them where CESIUM_BASE_URL="/cesium"
// (src/components/CesiumCutaway.tsx) expects to find them. Without it, /cutaway 404s on
// every Cesium asset request and Cesium's own renderer trips its "Rendering has stopped"
// safety halt - a confusing failure with no obvious cause if you don't know this step exists.
//
// Runs automatically via package.json's postinstall script - nobody should need to remember
// to run this by hand.

import { existsSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "node_modules", "cesium", "Build", "Cesium");
const dest = path.join(here, "..", "public", "cesium");

if (!existsSync(src)) {
  console.warn(`[copy-cesium-assets] ${src} not found - is the cesium package installed?`);
  process.exit(0); // don't fail `npm install` over this - just means /cutaway won't work yet
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-cesium-assets] copied Cesium static assets to ${path.relative(process.cwd(), dest)}`);
