"""Model B - manganese signature matching.

Learns what ground KNOWN to host manganese looks like, then scores every pixel for
similarity. This is the primary targeting product.

THREE SCORERS, RANK-FUSED
    Mahalanobis   - distance to the positive distribution, accounting for covariance.
                    Ledoit-Wolf shrinkage, because with ~5 independent sites a raw
                    sample covariance over tens of features is badly conditioned.
    One-class SVM - non-linear boundary the Gaussian assumption cannot represent.
    Spectral Angle- angle to the mean positive spectrum. Illumination-invariant, so
                    it is insensitive to slope and shadow in a way the other two are not.

    Their raw outputs are not comparable, so each is rank-normalised to [0, 1] before
    averaging. Rank fusion also stops one scorer's outliers dominating the result.

WHAT THE POSITIVES ARE
    Pixels from the HALO around each mine - 500 m to 2000 m out, pit excised. Never
    pixels from inside the workings: those describe excavation, and a model trained on
    them rediscovers coal mines.

STANDARDISATION
    The scaler is fitted on background/landscape pixels, never on the positives, so it
    carries no label information into the transform.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf
from sklearn.preprocessing import RobustScaler
from sklearn.svm import OneClassSVM


def _rank_normalise(values: np.ndarray) -> np.ndarray:
    """Map to [0, 1] by rank. NaNs stay NaN."""
    out = np.full(values.shape, np.nan, dtype="float64")
    finite = np.isfinite(values)
    if finite.sum() == 0:
        return out
    ranks = pd.Series(values[finite]).rank(method="average").to_numpy()
    out[finite] = (ranks - 1) / max(len(ranks) - 1, 1)
    return out


@dataclass
class SignatureModel:
    """One-class similarity model fitted on known-manganese halo pixels."""

    nu: float = 0.1
    gamma: str | float = "scale"
    random_state: int = 26009

    def __post_init__(self) -> None:
        self.features_: list[str] = []
        self.scaler_: RobustScaler | None = None
        self.mean_: np.ndarray | None = None
        self.precision_: np.ndarray | None = None
        self.svm_: OneClassSVM | None = None
        self.sam_reference_: np.ndarray | None = None

    # ------------------------------------------------------------------ fitting

    def fit(
        self,
        positives: pd.DataFrame,
        features: list[str],
        background: pd.DataFrame | None = None,
    ) -> "SignatureModel":
        """Fit on positive (halo) samples.

        `background` is used only to fit the scaler. If omitted the positives are used,
        which is acceptable but slightly leaks their spread into the transform.
        """
        self.features_ = list(features)

        pos = positives[self.features_].astype("float64")
        pos = pos.dropna()
        if len(pos) < 10:
            raise ValueError(f"Only {len(pos)} usable positive rows after dropping NaN.")

        scaler_source = (
            background[self.features_].astype("float64").dropna()
            if background is not None and len(background) >= 50
            else pos
        )
        self.scaler_ = RobustScaler().fit(scaler_source)

        X = self.scaler_.transform(pos)

        # Mahalanobis with shrinkage - a raw covariance over this many features from
        # so few independent sites would be near-singular.
        lw = LedoitWolf().fit(X)
        self.mean_ = lw.location_
        self.precision_ = lw.precision_

        self.svm_ = OneClassSVM(nu=self.nu, gamma=self.gamma, kernel="rbf").fit(X)

        # SAM reference is the mean spectrum in ORIGINAL units - spectral angle is
        # defined on the raw vector, and robust-scaling would distort the geometry.
        self.sam_reference_ = pos.to_numpy().mean(axis=0)
        return self

    # ------------------------------------------------------------------ scoring

    def _mahalanobis(self, X: np.ndarray) -> np.ndarray:
        delta = X - self.mean_
        return np.einsum("ij,jk,ik->i", delta, self.precision_, delta)

    def _sam(self, raw: np.ndarray) -> np.ndarray:
        """Spectral angle between each row and the reference spectrum, in radians."""
        ref = self.sam_reference_
        ref_norm = np.linalg.norm(ref)
        row_norm = np.linalg.norm(raw, axis=1)
        with np.errstate(invalid="ignore", divide="ignore"):
            cosine = (raw @ ref) / (row_norm * ref_norm)
        return np.arccos(np.clip(cosine, -1.0, 1.0))

    def score(self, frame: pd.DataFrame, fuse: bool = True) -> pd.DataFrame:
        """Score rows for similarity to the learned signature.

        Returns one column per scorer plus `signature_score`, all rank-normalised to
        [0, 1] where 1 is most manganese-like.
        """
        if self.scaler_ is None:
            raise RuntimeError("fit() must be called first")

        raw = frame[self.features_].astype("float64").to_numpy()
        valid = np.isfinite(raw).all(axis=1)

        n = len(frame)
        maha = np.full(n, np.nan)
        svm = np.full(n, np.nan)
        sam = np.full(n, np.nan)

        if valid.any():
            X = self.scaler_.transform(raw[valid])
            # All three are inverted so that HIGHER always means more similar.
            maha[valid] = -self._mahalanobis(X)
            svm[valid] = self.svm_.decision_function(X)
            sam[valid] = -self._sam(raw[valid])

        out = pd.DataFrame(
            {
                "maha": _rank_normalise(maha),
                "ocsvm": _rank_normalise(svm),
                "sam": _rank_normalise(sam),
            },
            index=frame.index,
        )
        if fuse:
            out["signature_score"] = out[["maha", "ocsvm", "sam"]].mean(axis=1)
        return out


def fit_score_loco(
    positives: pd.DataFrame,
    features: list[str],
    cluster_col: str = "cluster",
    background: pd.DataFrame | None = None,
    evaluation_sets: dict[str, pd.DataFrame] | None = None,
) -> pd.DataFrame:
    """Leave-one-cluster-out cross-validation.

    Holds out whole spatial clusters, not individual sites. Munsar, Mansar, Kandri and
    Beldongri sit within a few kilometres of each other; training on one and testing on
    another would measure spatial autocorrelation and report it as skill.

    Returns one row per fold: the held-out cluster's mean percentile among the
    background, plus the same statistic for any extra evaluation sets (negative
    controls, within-belt points).
    """
    clusters = sorted(positives[cluster_col].dropna().unique())
    if len(clusters) < 2:
        raise ValueError(f"Need at least 2 clusters, found {len(clusters)}")

    rows = []
    for held_out in clusters:
        train = positives[positives[cluster_col] != held_out]
        test = positives[positives[cluster_col] == held_out]

        model = SignatureModel().fit(train, features, background=background)

        # Score held-out positives and the background on one common scale, so
        # percentile is meaningful.
        pieces = {"heldout": test}
        if background is not None:
            pieces["background"] = background
        for name, frame in (evaluation_sets or {}).items():
            pieces[name] = frame

        combined = pd.concat(pieces.values(), ignore_index=True)
        marker = np.concatenate(
            [np.full(len(f), name) for name, f in pieces.items()]
        )
        scored = model.score(combined)
        scored["_set"] = marker

        bg = scored.loc[scored["_set"] == "background", "signature_score"].dropna()
        row = {"held_out_cluster": held_out, "n_train": len(train), "n_test": len(test)}

        for name in pieces:
            if name == "background":
                continue
            vals = scored.loc[scored["_set"] == name, "signature_score"].dropna()
            if len(vals) == 0 or len(bg) == 0:
                row[f"{name}_pct"] = np.nan
                continue
            # Percentile of this set's median score within the background distribution.
            row[f"{name}_pct"] = float((bg < vals.median()).mean() * 100)

        rows.append(row)

    return pd.DataFrame(rows)
