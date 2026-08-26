"""A4 - Terrain derivatives from the Copernicus 30 m DEM.

Structure is a first-order control on where manganese sits in the Sausar Group, so
terrain carries real predictive signal independent of anything spectral. The
multi-azimuth hillshades are specifically for lineament extraction downstream -
a single sun angle systematically hides lineaments running parallel to it.

    python -m src.gee.terrain --aoi belt_sausar
"""

from __future__ import annotations

import argparse

import ee

from src.config import cfg
from src.gee import auth
from src.gee.common import analysis_region, submit_export


def dem(region: ee.Geometry) -> ee.Image:
    """Copernicus GLO-30 elevation, mosaicked and clipped.

    setDefaultProjection is essential, not cosmetic. Mosaicking an ImageCollection
    produces an image with Earth Engine's default projection - WGS84 at 1 degree per
    pixel. ee.Algorithms.Terrain and ee.Terrain.hillshade both derive their output
    from the image's OWN projection, so on a 1-degree grid they return all-NaN.

    Slope, aspect and every hillshade came back empty in the first export because of
    exactly this. Elevation, TPI, TRI and curvature survived, because
    reduceNeighborhood and convolve use the requested output scale instead.
    """
    conf = cfg()["gee"]["terrain"]
    collection = ee.ImageCollection(conf["primary"]).select(conf["primary_band"])
    projection = collection.first().projection()
    return (
        collection.mosaic()
        .setDefaultProjection(projection)
        .rename("elevation")
        .clip(region)
    )


def build_stack(region: ee.Geometry) -> ee.Image:
    """Elevation plus the derived terrain layers used as model features."""
    conf = cfg()["gee"]["terrain"]
    elevation = dem(region)
    terrain = ee.Algorithms.Terrain(elevation)

    slope = terrain.select("slope").rename("slope")
    aspect = terrain.select("aspect").rename("aspect")

    # Aspect is circular; sin/cos avoid the 359->0 discontinuity that would otherwise
    # confuse any distance-based anomaly detector.
    aspect_rad = aspect.multiply(3.141592653589793 / 180.0)
    aspect_sin = aspect_rad.sin().rename("aspect_sin")
    aspect_cos = aspect_rad.cos().rename("aspect_cos")

    # Topographic Position Index: elevation relative to a local neighbourhood.
    # Positive = ridge, negative = valley. Ridge-capping laterite is a Mn indicator.
    neighbourhood = ee.Kernel.circle(radius=5, units="pixels")
    local_mean = elevation.reduceNeighborhood(ee.Reducer.mean(), neighbourhood)
    tpi = elevation.subtract(local_mean).rename("tpi")

    # Terrain Ruggedness Index.
    tri = (
        elevation.subtract(local_mean)
        .abs()
        .reduceNeighborhood(ee.Reducer.mean(), neighbourhood)
        .rename("tri")
    )

    # Curvature via a Laplacian - concentrates on breaks of slope.
    laplacian = ee.Kernel.laplacian8(normalize=False)
    curvature = elevation.convolve(laplacian).rename("curvature")

    hillshades = []
    for azimuth in conf["hillshade_azimuths"]:
        shade = ee.Terrain.hillshade(
            elevation, azimuth=azimuth, elevation=conf["hillshade_elevation"]
        ).rename(f"hillshade_{azimuth:03d}")
        hillshades.append(shade)

    return ee.Image.cat(
        [elevation, slope, aspect_sin, aspect_cos, tpi, tri, curvature, *hillshades]
    ).clip(region)


def export(aoi: str, *, dry_run: bool = False) -> None:
    region = analysis_region(aoi)
    conf = cfg()["gee"]["terrain"]

    print(f"Terrain stack (Copernicus GLO-30): {aoi}")
    stack = build_stack(region)
    submit_export(
        stack.toFloat(),
        f"TERRAIN_glo30_{aoi}",
        region,
        conf["scale_m"],
        dry_run=dry_run,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="belt_sausar")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    auth.init()
    export(args.aoi, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
