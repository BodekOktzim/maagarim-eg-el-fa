#!/usr/bin/env python3
"""Verify generated LFS ID offsets match source rows without printing row values."""
from __future__ import annotations

import csv
import random
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
INDEX_DIR = ROOT / "search-index-full"
DATA_DIR = ROOT / "datasets"
DTYPE = np.dtype([("id", "<u4"), ("offset", "<u8"), ("length", "<u4")], align=False)

specs = [
    ("agron2006", "AGRON2006.txt", "agron", 0),
    ("elector", "Elector.txt", "elector", 3),
    ("facebook", "Facebook.txt", "facebook", 1),
]


def row_id(source: str, row: bytes) -> int | None:
    if source == "agron":
        parts = row.rstrip(b"\r\n").split(b"\t")
        if not parts:
            return None
        try:
            value = parts[0].decode("ascii").strip()
        except UnicodeDecodeError:
            return None
    elif source == "facebook":
        parts = row.rstrip(b"\r\n").split(b":")
        if len(parts) <= 1:
            return None
        try:
            value = parts[1].decode("ascii").strip()
        except UnicodeDecodeError:
            return None
    else:
        fields = next(csv.reader([row.decode("utf-8", errors="replace")], delimiter=",", quotechar="'"))
        if len(fields) <= 3:
            return None
        value = fields[3].strip()
    if not value.isdigit() or not 5 <= len(value) <= 9:
        return None
    return int(value.zfill(9))


rng = random.Random(72523)
for key, filename, source, _id_col in specs:
    path = INDEX_DIR / f"{key}.bin"
    index = np.memmap(path, dtype=DTYPE, mode="r")
    data = DATA_DIR / filename
    good = 0
    for _ in range(min(100, len(index))):
        rec = index[rng.randrange(len(index))]
        with data.open("rb") as f:
            f.seek(int(rec["offset"]))
            row = f.read(int(rec["length"]))
        if len(row) != int(rec["length"]) or row_id(source, row) != int(rec["id"]):
            raise SystemExit(f"FAILED: {key} index offset mismatch")
        good += 1
    if np.any(index["id"][1:] < index["id"][:-1]):
        raise SystemExit(f"FAILED: {key} index is not sorted")
    print(f"PASS {key}: {good} random offsets match source rows; index sorted; rows={len(index)}")
print("All LFS search indexes verified without printing source values.")
