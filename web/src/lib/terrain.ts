// Terrain decoding, shared by every screen that needs a real ground elevation.
//
// Lifted out of CommandMap so the Mn hex grid can ask "how high is this hexagon?" against
// exactly the same heightmap the 3D view renders. Two copies of this would eventually give
// two different elevations for one point, and the depth-to-ore figure on the hex popup is
// only meaningful if it agrees with the terrain the user is looking at.

import type { LatLonBounds, TerrainData } from "./contract";

export interface DecodedTerrain {
  width: number;
  height: number;
  bounds: LatLonBounds;
  min: number;
  max: number;
  heights: Uint16Array;
}

/** Decode the base64 uint16 heightmap written by the pipeline into terrain.json. */
export function decodeTerrain(t: TerrainData | null): DecodedTerrain | null {
  if (!t || !t.data) return null;
  try {
    const bin = atob(t.data);
    const u16 = new Uint16Array(bin.length / 2);
    for (let i = 0; i < u16.length; i++) {
      u16[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    }
    return { width: t.width, height: t.height, bounds: t.bounds, min: t.min, max: t.max, heights: u16 };
  } catch (err) {
    console.error("Failed to decode terrain data:", err);
    return null;
  }
}

/** Bilinear elevation sample, metres above sea level, at an exact (lon, lat). */
export function sampleElevation(lon: number, lat: number, terrain: DecodedTerrain | null): number {
  if (!terrain) return 0;
  const [west, south, east, north] = terrain.bounds;
  if (lon < west || lon > east || lat < south || lat > north) {
    return terrain.min;
  }
  const u = (lon - west) / (east - west);
  const v = (north - lat) / (north - south); // row 0 corresponds to the northern boundary

  const x = Math.max(0, Math.min(terrain.width - 1, u * (terrain.width - 1)));
  const y = Math.max(0, Math.min(terrain.height - 1, v * (terrain.height - 1)));
  const x0 = Math.floor(x);
  const x1 = Math.min(terrain.width - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(terrain.height - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;

  const w = terrain.width;
  const h00 = terrain.min + (terrain.heights[y0 * w + x0] / 65535) * (terrain.max - terrain.min);
  const h10 = terrain.min + (terrain.heights[y0 * w + x1] / 65535) * (terrain.max - terrain.min);
  const h01 = terrain.min + (terrain.heights[y1 * w + x0] / 65535) * (terrain.max - terrain.min);
  const h11 = terrain.min + (terrain.heights[y1 * w + x1] / 65535) * (terrain.max - terrain.min);

  const top = h00 * (1 - dx) + h10 * dx;
  const bot = h01 * (1 - dx) + h11 * dx;
  return top * (1 - dy) + bot * dy;
}
