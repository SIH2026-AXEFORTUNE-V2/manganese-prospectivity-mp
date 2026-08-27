// Reads the pipeline's fused-score PNG back into actual numbers.
//
// This is the load-bearing piece of the Mn hex grid. The map could have been drawn from
// interpolated target centroids, which would look identical and mean nothing - every hexagon
// away from a target polygon would be an invention. Instead we decode the real raster the
// model wrote (`score_fused.png`, the same layer the prospectivity view drapes over terrain)
// and aggregate *that*. Every hexagon value is therefore the mean fused score over the ground
// it covers, and a hexagon with no score under it is dropped rather than filled in.
//
// How the decode works: the pipeline writes a colour-type-3 (palette-indexed) PNG - one byte
// per pixel, where the byte IS the score on a 0-255 scale, and the 256-entry PLTE is just the
// magma colour ramp used for display. Canvas hands back RGBA, not the index, so we parse the
// palette straight out of the PNG bytes and invert it. The tRNS chunk marks the nodata index
// (index 0 in the current fixture) transparent, which is how outside-AOI pixels are told apart
// from a genuine score of zero.

import type { LatLonBounds } from "./contract";

export interface ScoreGrid {
  width: number;
  height: number;
  bounds: LatLonBounds;
  /** Row-major, north-to-south. NaN where the raster has no data. */
  values: Float32Array;
  /** How many pixels carried a real score - the honest denominator for any coverage claim. */
  valid: number;
}

interface PngPalette {
  /** 256 entries of packed 0xRRGGBB. */
  rgb: Uint32Array;
  /** Palette indices the tRNS chunk marks fully transparent (nodata). */
  transparent: Set<number>;
}

/** Walks PNG chunks for PLTE + tRNS. Only handles colour type 3, which is all we write. */
function parsePalette(buf: ArrayBuffer): PngPalette | null {
  const b = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (u8.length < 8 || u8[0] !== 0x89 || u8[1] !== 0x50) return null;

  let off = 8;
  let rgb: Uint32Array | null = null;
  const transparent = new Set<number>();

  while (off + 8 <= u8.length) {
    const len = b.getUint32(off);
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
    const data = off + 8;
    if (type === "PLTE") {
      const n = Math.floor(len / 3);
      rgb = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        rgb[i] = (u8[data + i * 3] << 16) | (u8[data + i * 3 + 1] << 8) | u8[data + i * 3 + 2];
      }
    } else if (type === "tRNS") {
      for (let i = 0; i < len; i++) if (u8[data + i] === 0) transparent.add(i);
    } else if (type === "IEND") {
      break;
    }
    off = data + len + 4; // + CRC
  }
  return rgb ? { rgb, transparent } : null;
}

/**
 * Fetches and decodes a paletted score raster. Browser-only - it needs a canvas to expand the
 * PNG, and there is no server-side path that would want this.
 */
export async function loadScoreGrid(url: string, bounds: LatLonBounds): Promise<ScoreGrid> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();

  const palette = parsePalette(buf);
  const bitmap = await createImageBitmap(new Blob([buf], { type: "image/png" }));
  const { width, height } = bitmap;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable — cannot decode the score raster");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;

  // Invert the palette: packed RGB -> index. Duplicate colours in a colour ramp would make
  // this ambiguous, so the first index wins and the ramp's monotonicity keeps the error at
  // most one step - far smaller than the aggregation that follows.
  const toIndex = new Map<number, number>();
  if (palette) {
    for (let i = palette.rgb.length - 1; i >= 0; i--) toIndex.set(palette.rgb[i], i);
  }

  const values = new Float32Array(width * height);
  let valid = 0;
  const maxIndex = palette ? Math.max(1, palette.rgb.length - 1) : 255;

  for (let p = 0; p < width * height; p++) {
    const a = rgba[p * 4 + 3];
    if (a === 0) {
      values[p] = NaN;
      continue;
    }
    if (palette) {
      const key = (rgba[p * 4] << 16) | (rgba[p * 4 + 1] << 8) | rgba[p * 4 + 2];
      const idx = toIndex.get(key);
      if (idx === undefined || palette.transparent.has(idx)) {
        values[p] = NaN;
        continue;
      }
      values[p] = idx / maxIndex;
    } else {
      // Non-paletted fallback: luminance is a poor stand-in for a score, so treat it as
      // unusable rather than quietly ranking ground by how bright it looks.
      values[p] = NaN;
      continue;
    }
    valid++;
  }

  return { width, height, bounds, values, valid };
}

/** Nearest-pixel score at a coordinate. NaN outside the raster or over nodata. */
export function scoreAt(grid: ScoreGrid, lon: number, lat: number): number {
  const [west, south, east, north] = grid.bounds;
  if (lon < west || lon > east || lat < south || lat > north) return NaN;
  const x = Math.min(grid.width - 1, Math.floor(((lon - west) / (east - west)) * grid.width));
  const y = Math.min(grid.height - 1, Math.floor(((north - lat) / (north - south)) * grid.height));
  return grid.values[y * grid.width + x];
}
