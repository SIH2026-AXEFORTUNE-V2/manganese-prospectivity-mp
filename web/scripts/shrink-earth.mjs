// One-off: shrink the 12 baked 2048x1024 PNG textures in earth_breathing.glb down to
// 1024x512 JPEG so the globe model ships at a sane size. Uses jimp (pure JS) because
// sharp/libvips is broken for these PNGs on this machine.
//
//   node scripts/shrink-earth.mjs ../earth_breathing.glb public/models/earth.glb
//
// Safe to delete after the optimized earth.glb is committed.

import { NodeIO } from "@gltf-transform/core";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Jimp = require("jimp");

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node scripts/shrink-earth.mjs <in.glb> <out.glb>");
  process.exit(1);
}

const io = new NodeIO();
const doc = await io.read(inPath);

let n = 0;
for (const tex of doc.getRoot().listTextures()) {
  const img = tex.getImage();
  if (!img) continue;
  const jimg = await Jimp.read(Buffer.from(img));
  jimg.resize(1024, 512);
  jimg.quality(82);
  const out = await jimg.getBufferAsync(Jimp.MIME_JPEG);
  tex.setImage(new Uint8Array(out));
  tex.setMimeType("image/jpeg");
  n++;
}

await io.write(outPath, doc);
console.log(`rewrote ${n} textures -> ${outPath}`);
