"""Full validation harness for Model B + Model A.

Runs every check from docs/02-modelling-plan.md and prints one report.

WHAT EACH NUMBER MEANS
    held-out percentile  Where a held-out cluster's halo lands in the background
                         distribution. 50 = chance. This is the headline.
    capture efficiency   Share of held-out sites in the top 5/10/20% of area.
    negative controls    Coal, copper and sand mines. If these score HIGH the model
                         learned "excavation" rather than "manganese", and the map is
                         worthless however good the headline looks.
    random-location null Same pipeline run on 9 FAKE sites drawn at random inside the
                         belt. Answers the question that matters: would any nine
                         patches of belt ground have scored this well? Shuffling
                         cluster labels does NOT test this - it leaves train and test
                         inside the same nine halos, which is leakage.

NOTE ON THE BACKGROUND
    Background points are drawn from inside the Sausar belt, not from all of Madhya
    Pradesh. That makes this the strict test: the model must separate mine
    neighbourhoods from ORDINARY BELT GROUND, not merely separate the belt from
    Rajasthan. Scoring against statewide random points would look far better and mean
    much less.

    python -m src.validate.score
    python -m src.validate.score --quick     # fewer pixels, for iteration
"""

from __future__ import annotations

import argparse
import json
import warnings

import geopandas as gpd
import numpy as np
import pandas as pd

from src.config import ROOT, cfg
from src.features.stack import FeatureStack, prune_correlated
from src.models.anomaly import AnomalyModel, fuse_scores
from src.models.signature import SignatureModel, _rank_normalise

warnings.filterwarnings("ignore")

VAL = ROOT / "data" / "validation"


def load_sets(fs: FeatureStack, per_polygon: int, n_background: int, seed: int = 26009):
    """Sample every evaluation set onto the feature stack."""
    halos = gpd.read_file(VAL / "validation_halos.geojson")
    clusters = gpd.read_file(VAL / "site_clusters.geojson")[["name", "cluster"]]
    halos = halos.merge(clusters, on="name", how="left")

    print(f"  positives:  {len(halos)} halos, {halos['cluster'].nunique()} clusters")
    positives = fs.sample_polygons(halos, max_per_polygon=per_polygon, seed=seed)

    bg_points = gpd.read_file(VAL / "background_points.geojson")
    if len(bg_points) > n_background:
        bg_points = bg_points.sample(n_background, random_state=seed)
    print(f"  background: {len(bg_points)} points (inside the belt - strict test)")
    background = fs.sample_points(bg_points)

    neg_path = VAL / "negative_control_halos.geojson"
    negatives = None
    if neg_path.exists():
        neg = gpd.read_file(neg_path)
        print(f"  negatives:  {len(neg)} non-Mn mine halos "
              f"({', '.join(sorted(neg['commodity'].unique()))})")
        negatives = fs.sample_polygons(neg, label_col="name", max_per_polygon=per_polygon, seed=seed)

    return positives, background, negatives


def capture_efficiency(scores_pos: pd.Series, scores_bg: pd.Series) -> dict:
    """Share of positives above the background's top-N% thresholds."""
    out = {}
    for pct in (5, 10, 20):
        threshold = np.nanpercentile(scores_bg, 100 - pct)
        out[f"top{pct}"] = float((scores_pos >= threshold).mean() * 100)
    return out


def score_together(model, *frames) -> list[pd.Series]:
    """Score several frames on ONE common scale, then split them back apart.

    Necessary because scores are rank-normalised within whatever frame they are given.
    Scoring positives and background separately makes each uniform on [0, 1] by
    construction, and any comparison between them then lands exactly on chance no
    matter how good or bad the model is.
    """
    combined = pd.concat(frames, ignore_index=True)
    scored = model.score(combined)
    column = "signature_score" if "signature_score" in scored else "anomaly_score"
    out, start = [], 0
    for frame in frames:
        out.append(scored[column].iloc[start:start + len(frame)].reset_index(drop=True))
        start += len(frame)
    return out


def random_location_null(
    fs: FeatureStack, positives: pd.DataFrame, features: list[str],
    background: pd.DataFrame, observed: float,
    n_rounds: int = 20, per_polygon: int = 250, seed: int = 26009,
) -> float:
    """P-value against a RANDOM-LOCATION null.

    The right null hypothesis is "any 9 patches of belt ground would score this well",
    not "the labels were shuffled". Shuffling cluster labels leaves train and test
    inside the same nine halos, which is leakage: it makes the task EASIER than the
    real spatial holdout and returns a meaningless p near 1.

    So: draw fake mine sites at random inside the belt, build identical halos, run the
    identical leave-one-cluster-out pipeline, and count how often chance matches the
    observed score.
    """
    from shapely.geometry import Point

    from src.models.signature import fit_score_loco
    from src.validate.clusters import assign_clusters

    conf = cfg()["validation"]
    rng = np.random.default_rng(seed)
    real = gpd.read_file(VAL / "known_mn_occurrences.geojson").to_crs(fs.crs)
    n_sites = len(real)
    left, bottom, right, top = fs.bounds

    beaten = 0
    completed = 0
    for _ in range(n_rounds):
        pts = [
            Point(rng.uniform(left, right), rng.uniform(bottom, top))
            for _ in range(n_sites)
        ]
        fake = gpd.GeoDataFrame(
            {"name": [f"fake_{i}" for i in range(n_sites)]}, geometry=pts, crs=fs.crs
        )
        fake = assign_clusters(fake.to_crs("EPSG:4326"))
        fake_proj = fake.to_crs(fs.crs)
        halos = fake_proj.geometry.buffer(conf["halo_outer_m"]).difference(
            fake_proj.geometry.buffer(conf["halo_inner_m"])
        )
        fake_halos = gpd.GeoDataFrame(
            fake_proj.drop(columns="geometry"), geometry=halos, crs=fs.crs
        ).to_crs("EPSG:4326")

        try:
            sampled = fs.sample_polygons(fake_halos, max_per_polygon=per_polygon)
            if sampled["cluster"].nunique() < 2:
                continue
            res = fit_score_loco(sampled, features, background=background)
            completed += 1
            if res["heldout_pct"].mean() >= observed:
                beaten += 1
        except Exception:
            continue

    if completed == 0:
        return float("nan")
    return (beaten + 1) / (completed + 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true", help="fewer pixels, faster")
    parser.add_argument("--per-polygon", type=int)
    parser.add_argument("--background", type=int)
    parser.add_argument("--permutations", type=int, default=30)
    parser.add_argument("--out", default="data/processed/validation_report.json")
    args = parser.parse_args()

    per_polygon = args.per_polygon or (250 if args.quick else 1500)
    n_background = args.background or (1500 if args.quick else 8000)

    print("=" * 78)
    print("VALIDATION REPORT - Model B (signature) + Model A (anomaly)")
    print("=" * 78)

    fs = FeatureStack()
    print(f"\nFeature stack: {fs}")
    print(fs.describe().to_string(index=False))

    print("\nSampling:")
    positives, background, negatives = load_sets(fs, per_polygon, n_background)

    pool = pd.concat([positives, background], ignore_index=True)

    # A band that is entirely NaN carries no information, and because the models
    # require every feature to be finite, one such band silently drops EVERY row.
    # Report and exclude rather than letting it wipe the sample out.
    usable = []
    empty = []
    for band in fs.band_names:
        if pool[band].notna().mean() < 0.01:
            empty.append(band)
        else:
            usable.append(band)
    if empty:
        print(f"\nWARNING: {len(empty)} band(s) are entirely empty and were excluded:")
        print(f"  {', '.join(empty)}")
        print("  Check the export that produced them.")

    features, dropped = prune_correlated(pool, usable, 0.95)
    print(f"\nFeatures: {len(fs.band_names)} -> {len(features)} after correlation pruning")
    for a, b, r in dropped:
        print(f"  dropped {a:<24} r={r:.3f} with {b}")

    # ---------------------------------------------------------------- Model B
    from src.models.signature import fit_score_loco

    print("\n" + "-" * 78)
    print("MODEL B - signature matching, leave-one-cluster-out")
    print("-" * 78)
    eval_sets = {"negatives": negatives} if negatives is not None else {}
    loco = fit_score_loco(positives, features, background=background, evaluation_sets=eval_sets)
    print(loco.to_string(index=False))

    # Vegetation diagnostic. Optical prospectivity degrades under canopy: dense
    # vegetation hides the ground, so a signature learned on exposed sites does not
    # transfer to a forested one. Reporting NDVI per fold turns "this fold failed"
    # into "this fold is under forest", which is a finding rather than a mystery.
    if "NDVI" in positives.columns:
        veg = (
            positives.groupby("cluster")["NDVI"]
            .median()
            .rename("median_NDVI")
            .reset_index()
            .rename(columns={"cluster": "held_out_cluster"})
        )
        loco = loco.merge(veg, on="held_out_cluster", how="left")

    heldout_mean = float(loco["heldout_pct"].mean())
    heldout_sd = float(loco["heldout_pct"].std())
    print(f"\n  held-out percentile: {heldout_mean:.1f} +/- {heldout_sd:.1f}   (50 = chance)")
    if "negatives_pct" in loco:
        neg_mean = float(loco["negatives_pct"].mean())
        print(f"  negative controls:   {neg_mean:.1f}   (want LOW - high means it learned 'mine')")

    if "median_NDVI" in loco and loco["median_NDVI"].notna().sum() >= 3:
        r = loco[["heldout_pct", "median_NDVI"]].corr().iloc[0, 1]
        print(f"  fold score vs NDVI:  r = {r:+.2f}", end="")
        print("   (strongly negative = canopy is limiting the model)"
              if r < -0.5 else "")

    # ------------------------------------------------- full-fit maps for the rest
    model_b = SignatureModel().fit(positives, features, background=background)
    # Scored together, never separately - see score_together().
    pos_b, bg_b = score_together(model_b, positives, background)

    cap_b = capture_efficiency(pos_b, bg_b)
    print(f"\n  capture efficiency: top5 {cap_b['top5']:.0f}%  "
          f"top10 {cap_b['top10']:.0f}%  top20 {cap_b['top20']:.0f}%")

    # ---------------------------------------------------------------- Model A
    print("\n" + "-" * 78)
    print("MODEL A - unsupervised anomaly (no labels)")
    print("-" * 78)
    model_a = AnomalyModel().fit(background, features)
    crosta = model_a.crosta_component_
    print(f"  Crosta component: PC{crosta}" if crosta is not None else "  Crosta component: none found")
    pos_a, bg_a = score_together(model_a, positives, background)
    cap_a = capture_efficiency(pos_a, bg_a)
    print(f"  capture efficiency: top5 {cap_a['top5']:.0f}%  "
          f"top10 {cap_a['top10']:.0f}%  top20 {cap_a['top20']:.0f}%")

    # ---------------------------------------------------------------- Fusion
    print("\n" + "-" * 78)
    print("FUSED  (0.7 x signature, 0.3 x anomaly, geometric)")
    print("-" * 78)
    pos_f = fuse_scores(pos_b, pos_a)
    bg_f = fuse_scores(bg_b, bg_a)
    cap_f = capture_efficiency(pos_f, bg_f)
    print(f"  capture efficiency: top5 {cap_f['top5']:.0f}%  "
          f"top10 {cap_f['top10']:.0f}%  top20 {cap_f['top20']:.0f}%")

    # ---------------------------------------------------------------- Permutation
    print("\n" + "-" * 78)
    print(f"RANDOM-LOCATION NULL ({args.permutations} rounds)")
    print("-" * 78)
    print("  drawing fake mine sites at random inside the belt...")
    p_value = random_location_null(
        fs, positives, features, background, heldout_mean,
        n_rounds=args.permutations, per_polygon=per_polygon,
    )
    print(f"  p = {p_value:.3f}   "
          f"(share of random 9-site sets matching or beating {heldout_mean:.1f})")

    # ---------------------------------------------------------------- Verdict
    print("\n" + "=" * 78)
    print("VERDICT")
    print("=" * 78)
    verdict = []
    if heldout_mean < 60:
        verdict.append("WEAK: held-out sites barely separate from ordinary belt ground.")
    elif heldout_mean < 75:
        verdict.append("MODEST: real but limited separation from ordinary belt ground.")
    else:
        verdict.append("STRONG: held-out sites clearly separate from ordinary belt ground.")

    if "negatives_pct" in loco and float(loco["negatives_pct"].mean()) > heldout_mean - 5:
        verdict.append(
            "FAILS the commodity test: non-manganese mines score about as high as\n"
            "  manganese ones, so the model is detecting excavation, not mineralogy."
        )
    if p_value > 0.05:
        verdict.append(
            f"NOT significant vs random locations (p={p_value:.3f}): random belt "
            "patches score about as well as real mine neighbourhoods."
        )

    for line in verdict:
        print(f"  - {line}")

    report = {
        "n_features": len(features),
        "features": features,
        "dropped": [{"dropped": a, "kept": b, "r": r} for a, b, r in dropped],
        "loco": loco.to_dict(orient="records"),
        "heldout_pct_mean": heldout_mean,
        "heldout_pct_sd": heldout_sd,
        "capture_signature": cap_b,
        "capture_anomaly": cap_a,
        "capture_fused": cap_f,
        "permutation_p": p_value,
    }
    dest = ROOT / args.out
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nwrote {dest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
