#!/usr/bin/env python3
"""Rank chores by skip risk.

Uses TabPFN when the package imports. Otherwise reports that the TypeScript
logistic baseline in src/nap/forecast.ts is what the nap is running.
TabPFN-3.5 wants the non-commercial license from platform.priorlabs.ai.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: tabpfn_forecast.py chores.csv", file=sys.stderr)
        return 2
    rows = load_rows(Path(sys.argv[1]))
    features = [
        [
            float(row["age_days"]) / 30,
            float(row["minutes"]) / 60,
            float(row["dread"]) / 5,
            float(row["skipped_last_4"]) / 4,
        ]
        for row in rows
    ]
    labels = [1 if int(row["skipped_last_4"]) >= 3 else 0 for row in rows]
    try:
        from tabpfn import TabPFNClassifier
    except ImportError:
        print(json.dumps({"ok": False, "model": "not-installed", "rows": len(rows)}))
        return 0

    model = TabPFNClassifier()
    model.fit(features, labels)
    probabilities = model.predict_proba(features)
    skip_index = list(model.classes_).index(1) if 1 in list(model.classes_) else -1
    ranked = []
    for row, probability in zip(rows, probabilities):
        skip = float(probability[skip_index]) if skip_index >= 0 else 0.0
        ranked.append({"task": row["task"], "skipProbability": round(skip, 4), "model": "tabpfn"})
    ranked.sort(key=lambda item: item["skipProbability"], reverse=True)
    print(json.dumps({"ok": True, "model": "tabpfn", "forecast": ranked}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
