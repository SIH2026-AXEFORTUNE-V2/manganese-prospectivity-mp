"""Model A - unsupervised anomaly detection.

Runs alongside Model B and answers a different question. B asks "does this look like
the known nine?"; A asks "is this unusual at all?". A is the weaker scorer, but it is
the only component capable of flagging a deposit that resembles nothing already mined.

NO LABELS ANYWHERE IN HERE
    Everything is fitted on the landscape itself. Nothing from data/validation/ is
    read, which is what keeps the blind-validation claim intact.

SCORERS
    PCA + Mahalanobis - distance from the bulk of the landscape in PCA space.
    Isolation Forest  - tree-based outlier score, no distributional assumption.
    Crosta directed PCA - the classic mineral-exploration technique: pick the
                    principal component loading iron-oxide and hydroxyl features with
                    opposite signs, which isolates alteration from albedo and vegetation.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler

from src.models.signature import _rank_normalise

# Substrings identifying alteration-related features, for the Crosta step.
IRON_HINTS = ("IRON", "FERRIC", "FERROUS", "GOSSAN")
HYDROXYL_HINTS = ("CLAY", "ALOH", "MGOH", "HYDROXYL", "ALTERATION")


@dataclass
class AnomalyModel:
    n_components: int = 10
    contamination: float = 0.05
    random_state: int = 26009

    def __post_init__(self) -> None:
        self.features_: list[str] = []
        self.scaler_: RobustScaler | None = None
        self.pca_: PCA | None = None
        self.mean_: np.ndarray | None = None
        self.inv_var_: np.ndarray | None = None
        self.iforest_: IsolationForest | None = None
        self.crosta_component_: int | None = None
        self.crosta_sign_: float = 1.0

    def fit(self, landscape: pd.DataFrame, features: list[str]) -> "AnomalyModel":
        self.features_ = list(features)
        X = landscape[self.features_].astype("float64").dropna()
        if len(X) < 100:
            raise ValueError(f"Only {len(X)} usable landscape rows; need >= 100.")

        self.scaler_ = RobustScaler().fit(X)
        Xs = self.scaler_.transform(X)

        n_comp = min(self.n_components, Xs.shape[1])
        self.pca_ = PCA(n_components=n_comp, random_state=self.random_state).fit(Xs)
        scores = self.pca_.transform(Xs)

        # Diagonal Mahalanobis in PCA space: components are already uncorrelated, so
        # the covariance is diagonal and no matrix inversion is needed.
        self.mean_ = scores.mean(axis=0)
        var = scores.var(axis=0)
        self.inv_var_ = 1.0 / np.where(var > 1e-12, var, 1e-12)

        self.iforest_ = IsolationForest(
            contamination=self.contamination,
            random_state=self.random_state,
            n_estimators=200,
        ).fit(Xs)

        self._pick_crosta_component()
        return self

    def _pick_crosta_component(self) -> None:
        """Find the component that contrasts iron-oxide against hydroxyl features.

        The Crosta method looks for a component where the two groups load with
        OPPOSITE signs - that component isolates alteration mineralogy rather than
        overall brightness, which otherwise dominates PC1.
        """
        iron_idx = [
            i for i, f in enumerate(self.features_)
            if any(h in f.upper() for h in IRON_HINTS)
        ]
        hydroxyl_idx = [
            i for i, f in enumerate(self.features_)
            if any(h in f.upper() for h in HYDROXYL_HINTS)
        ]
        if not iron_idx or not hydroxyl_idx:
            self.crosta_component_ = None
            return

        best, best_contrast = None, 0.0
        for c, loading in enumerate(self.pca_.components_):
            iron_load = loading[iron_idx].mean()
            hydroxyl_load = loading[hydroxyl_idx].mean()
            if iron_load * hydroxyl_load >= 0:
                continue  # same sign - brightness, not alteration
            contrast = abs(iron_load - hydroxyl_load)
            if contrast > best_contrast:
                best, best_contrast = c, contrast
                self.crosta_sign_ = 1.0 if iron_load > 0 else -1.0

        self.crosta_component_ = best

    def score(self, frame: pd.DataFrame, fuse: bool = True) -> pd.DataFrame:
        if self.scaler_ is None:
            raise RuntimeError("fit() must be called first")

        raw = frame[self.features_].astype("float64").to_numpy()
        valid = np.isfinite(raw).all(axis=1)
        n = len(frame)

        pca_maha = np.full(n, np.nan)
        iforest = np.full(n, np.nan)
        crosta = np.full(n, np.nan)

        if valid.any():
            Xs = self.scaler_.transform(raw[valid])
            scores = self.pca_.transform(Xs)
            delta = scores - self.mean_
            pca_maha[valid] = (delta**2 * self.inv_var_).sum(axis=1)
            # Isolation Forest returns HIGHER for normal; invert so high = anomalous.
            iforest[valid] = -self.iforest_.score_samples(Xs)
            if self.crosta_component_ is not None:
                crosta[valid] = self.crosta_sign_ * scores[:, self.crosta_component_]

        out = pd.DataFrame(
            {
                "pca_maha": _rank_normalise(pca_maha),
                "iforest": _rank_normalise(iforest),
            },
            index=frame.index,
        )
        if self.crosta_component_ is not None:
            out["crosta"] = _rank_normalise(crosta)

        if fuse:
            out["anomaly_score"] = out[[c for c in out.columns]].mean(axis=1)
        return out


def fuse_scores(
    signature: pd.Series, anomaly: pd.Series, weight_signature: float = 0.7
) -> pd.Series:
    """Combine B and A into one map.

    Weighted geometric mean, so a pixel must do reasonably well on BOTH to rank
    highly - an arithmetic mean would let a single extreme score carry a pixel. B is
    weighted higher because it is the targeted scorer; A contributes the ability to
    flag something unlike the known deposits.
    """
    w_a = 1.0 - weight_signature
    s = signature.clip(lower=1e-6)
    a = anomaly.clip(lower=1e-6)
    return np.exp(weight_signature * np.log(s) + w_a * np.log(a))
