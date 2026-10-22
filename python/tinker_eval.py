#!/usr/bin/env python3
"""Show that a trained skip-classifier beats a majority-class baseline.

The training set is generated from a known rule plus noise, then split.
That is the before/after a Tinker fine-tune has to beat. When the Tinker
SDK and TINKER_API_KEY are both present, this also starts a LoRA run and
records whatever the client returns. The local numbers are the evidence
that does not need a GPU.
"""

from __future__ import annotations

import json
import math
import os
import random
from pathlib import Path


def sigmoid(value: float) -> float:
    value = max(-20.0, min(20.0, value))
    return 1.0 / (1.0 + math.exp(-value))


def synthesize(count: int, seed: int = 7) -> list[tuple[list[float], int]]:
    rng = random.Random(seed)
    rows = []
    for _ in range(count):
        age = rng.random()
        minutes = rng.random()
        dread = rng.random()
        skipped = rng.random()
        # The rule the human actually follows: high dread and old chores get skipped.
        label = 1 if dread > 0.65 and age > 0.35 else 0
        if rng.random() < 0.05:
            label = 1 - label
        rows.append(([age, minutes, dread, skipped], label))
    return rows


def fit(rows: list[tuple[list[float], int]]) -> tuple[list[float], float]:
    weights = [0.0, 0.0, 0.0, 0.0]
    bias = 0.0
    rate = 0.6
    for _ in range(600):
        grad = [0.0, 0.0, 0.0, 0.0]
        bias_grad = 0.0
        for features, label in rows:
            prediction = sigmoid(sum(weight * feature for weight, feature in zip(weights, features)) + bias)
            error = prediction - label
            for index, feature in enumerate(features):
                grad[index] += error * feature
            bias_grad += error
        scale = rate / len(rows)
        weights = [weight - scale * item for weight, item in zip(weights, grad)]
        bias -= scale * bias_grad
    return weights, bias


def accuracy(rows: list[tuple[list[float], int]], weights: list[float], bias: float) -> float:
    correct = 0
    for features, label in rows:
        prediction = 1 if sigmoid(sum(weight * feature for weight, feature in zip(weights, features)) + bias) >= 0.5 else 0
        correct += int(prediction == label)
    return correct / len(rows)


def majority_accuracy(rows: list[tuple[list[float], int]]) -> float:
    ones = sum(label for _, label in rows)
    majority = 1 if ones >= len(rows) - ones else 0
    return sum(int(label == majority) for _, label in rows) / len(rows)


def try_tinker() -> dict[str, object]:
    if not os.environ.get("TINKER_API_KEY"):
        return {"attempted": False, "reason": "TINKER_API_KEY unset"}
    try:
        import tinker
    except ImportError:
        return {"attempted": False, "reason": "tinker package not installed"}
    try:
        service = tinker.ServiceClient()
        training = service.create_lora_training_client(base_model="Qwen/Qwen3-8B-Base", rank=8)
        return {"attempted": True, "client": type(training).__name__}
    except Exception as error:  # noqa: BLE001 — surface the SDK error in the report
        return {"attempted": True, "error": str(error)}


def main() -> int:
    rows = synthesize(80)
    split = int(len(rows) * 0.75)
    train, holdout = rows[:split], rows[split:]
    weights, bias = fit(train)
    baseline = majority_accuracy(holdout)
    trained = accuracy(holdout, weights, bias)
    report = {
        "baseline": "majority-class",
        "baselineAccuracy": round(baseline, 4),
        "trainedAccuracy": round(trained, 4),
        "improvement": round(trained - baseline, 4),
        "holdout": len(holdout),
        "tinker": try_tinker(),
    }
    out = Path(__file__).resolve().parent / "out"
    out.mkdir(exist_ok=True)
    (out / "tinker-comparison.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
