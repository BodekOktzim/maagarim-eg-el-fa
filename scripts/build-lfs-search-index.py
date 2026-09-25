#!/usr/bin/env python3
"""Build compact ID-to-byte-offset indexes for GitHub LFS range search.

The LFS index stores only normalized numeric IDs, byte offsets and row lengths; it
never copies complete source rows. Small sparse directories are copied by Vite to the
public GitHub Pages output.
"""
from __future__ import annotations

import csv
import json
import os
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets"
OUT = ROOT / "search-index-full"
PUBLIC_OUT = ROOT / "client" / "public" / "index-seek"
RECORD = struct.Struct("<IQI")  # uint32 ID, uint64 byte offset/ordinal, uint32 row bytes
DTYPE = np.dtype([("id", "<u4"), ("offset", "<u8"), ("length", "<u4")], align=False)
BLOCK_RECORDS = 4096
assert RECORD.size == DTYPE.itemsize == 16


def emit(out, national_id: str, offset: int, length: int) -> bool:
    digits = national_id.strip()
    if not digits.isdigit() or not 5 <= len(digits) <= 9:
        return False
    normalized = digits.zfill(9)
    out.write(RECORD.pack(int(normalized), offset, length))
    return True


def sort_fixed_width_file(path: Path) -> int:
    size = path.stat().st_size
    if size % RECORD.size:
        raise RuntimeError(f"Corrupt index size: {path.name}")
    count = size // RECORD.size
    if not count:
        return 0
    arr = np.fromfile(path, dtype=DTYPE)
    order = np.argsort(arr["id"], kind="quicksort")
    sorted_arr = arr[order]
    temp = path.with_suffix(".sorted.tmp")
    sorted_arr.tofile(temp)
    os.replace(temp, path)
    del arr, order, sorted_arr
    return count


def build_agron(target: Path) -> int:
    source = DATA / "AGRON2006.txt"
    count = 0
    previous = -1
    with source.open("rb") as src, target.open("wb") as out:
        offset = 0
        for line_number, line in enumerate(src):
            start = offset
            offset += len(line)
            if line_number == 0:  # UTF-8 BOM + Hebrew header row
                continue
            fields = line.rstrip(b"\r\n").split(b"\t")
            if not fields:
                continue
            try:
                value = fields[0].decode("ascii").strip()
            except UnicodeDecodeError:
                continue
            if not value.isdigit() or not 5 <= len(value) <= 9:
                continue
            key = int(value)
            if key < previous:
                raise RuntimeError("AGRON identity column is not sorted; refusing to build a binary-search index")
            previous = key
            if emit(out, value, start, len(line)):
                count += 1
    return count


def build_elector(target: Path) -> int:
    source = DATA / "Elector.txt"
    raw = target.with_suffix(".raw")
    count = 0
    with source.open("rb") as src, raw.open("wb") as out:
        offset = 0
        for line_number, line in enumerate(src):
            start = offset
            offset += len(line)
            if line_number < 5:  # Metadata rows, blank row, then header
                continue
            try:
                row = next(csv.reader([line.decode("utf-8", errors="replace")], delimiter=",", quotechar="'"))
            except (csv.Error, StopIteration):
                continue
            if len(row) <= 3:
                continue
            if emit(out, row[3], start, len(line)):
                count += 1
    os.replace(raw, target)
    sort_fixed_width_file(target)
    return count


def build_facebook(target: Path) -> int:
    source = DATA / "Facebook.txt"
    raw = target.with_suffix(".raw")
    count = 0
    with source.open("rb") as src, raw.open("wb") as out:
        offset = 0
        for line in src:
            start = offset
            offset += len(line)
            fields = line.rstrip(b"\r\n").split(b":")
            # The source has no header; column 2 is indexed as a numeric candidate.
            if len(fields) <= 1:
                continue
            try:
                value = fields[1].decode("ascii").strip()
            except UnicodeDecodeError:
                continue
            if emit(out, value, start, len(line)):
                count += 1
    os.replace(raw, target)
    sort_fixed_width_file(target)
    return count


def write_sparse(full_path: Path, sparse_path: Path) -> tuple[int, int]:
    count = full_path.stat().st_size // RECORD.size
    sparse_path.parent.mkdir(parents=True, exist_ok=True)
    if not count:
        sparse_path.write_bytes(b"")
        return 0, 0
    full = np.memmap(full_path, dtype=DTYPE, mode="r")
    ordinals = np.arange(0, count, BLOCK_RECORDS, dtype=np.int64)
    sparse = np.zeros(len(ordinals), dtype=DTYPE)
    sparse["id"] = full["id"][ordinals]
    sparse["offset"] = ordinals
    sparse.tofile(sparse_path)
    del sparse, ordinals, full
    return count, sparse_path.stat().st_size


def main() -> None:
    OUT.mkdir(exist_ok=True)
    PUBLIC_OUT.mkdir(parents=True, exist_ok=True)
    builders = [
        ("agron2006", "AGRON2006.txt", build_agron),
        ("elector", "Elector.txt", build_elector),
        ("facebook", "Facebook.txt", build_facebook),
    ]
    manifest = {
        "format": "u32le-normalized-id-u64le-offset-u32le-row-bytes",
        "recordBytes": RECORD.size,
        "blockRecords": BLOCK_RECORDS,
        "generatedFrom": "Git LFS source files; full source rows are not copied into the index",
        "sources": [],
    }
    for key, file_name, builder in builders:
        full_path = OUT / f"{key}.bin"
        sparse_path = PUBLIC_OUT / f"{key}.sparse.bin"
        print(f"Building {key} index...", flush=True)
        count = builder(full_path)
        _, sparse_bytes = write_sparse(full_path, sparse_path)
        source_path = DATA / file_name
        manifest["sources"].append({
            "key": key,
            "file": file_name,
            "records": count,
            "indexBytes": full_path.stat().st_size,
            "sparseBytes": sparse_bytes,
            "sourceBytes": source_path.stat().st_size,
        })
        print(f"{key}: indexed_records={count}, index_bytes={full_path.stat().st_size}, sparse_bytes={sparse_bytes}", flush=True)
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (PUBLIC_OUT / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (OUT / "manifest.json").write_text(manifest_text, encoding="utf-8")
    print("All ID indexes built.", flush=True)


if __name__ == "__main__":
    main()
