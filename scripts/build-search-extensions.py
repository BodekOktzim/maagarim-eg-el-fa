#!/usr/bin/env python3
"""Build public, source-linked sidecar indexes without modifying source datasets.

Text postings store only a 32-bit bigram hash plus the source row byte offset/length.
Phone postings store only a normalized phone hash plus offset/length. Family edges store
parent/child IDs and the original child row offset. Original rows remain unchanged in LFS.
"""
from __future__ import annotations

import csv
import json
import os
import re
import struct
from contextlib import ExitStack
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets"
OUT = ROOT / "search-index-full"
PUBLIC = ROOT / "client" / "public" / "index-seek"
BLOCK = 4096
POST = struct.Struct("<IQI")  # uint32 search key, uint64 source offset, uint32 row bytes
POST_DTYPE = np.dtype([("key", "<u4"), ("offset", "<u8"), ("length", "<u4")], align=False)
FBID = struct.Struct("<QQI")  # uint64 Facebook numeric ID, uint64 offset, uint32 length
FBID_DTYPE = np.dtype([("key", "<u8"), ("offset", "<u8"), ("length", "<u4")], align=False)
EDGE = struct.Struct("<IIQI")  # uint32 parent, uint32 child, uint64 offset, uint32 length
EDGE_DTYPE = np.dtype([("key", "<u4"), ("related", "<u4"), ("offset", "<u8"), ("length", "<u4")], align=False)
assert POST.size == POST_DTYPE.itemsize == 16
assert FBID.size == FBID_DTYPE.itemsize == 20
assert EDGE.size == EDGE_DTYPE.itemsize == 20


def digits(value: str, lo: int = 5, hi: int = 9) -> str | None:
    value = value.strip()
    if not value.isdigit() or not lo <= len(value) <= hi:
        return None
    return value


def normalize_text(value: str) -> str:
    value = value.lower().replace("׳", "").replace("'", "").replace('"', "").replace(".", "").replace(",", "")
    return " ".join(value.split())


def bigrams(value: str) -> set[str]:
    normalized = normalize_text(value)
    return {normalized[i:i + 2] for i in range(max(0, len(normalized) - 1))}


def hash32(value: str) -> int:
    h = 2166136261
    for byte in value.encode("utf-8"):
        h ^= byte
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def phone_digits(value: str) -> str | None:
    raw = re.sub(r"\D", "", value)
    if raw.startswith("00972"):
        raw = "0" + raw[5:]
    elif raw.startswith("972"):
        raw = "0" + raw[3:]
    if not 7 <= len(raw) <= 15:
        return None
    return raw


def write_post(out, key: int, offset: int, length: int) -> None:
    out.write(POST.pack(key, offset, length))


def build_agron(indexes: dict[str, object]) -> None:
    source = DATA / "AGRON2006.txt"
    paths = {key: OUT / f"{key}.bin" for key in ("text-agron-first", "text-agron-last", "text-agron-city", "phone-agron", "age-agron")}
    counts = {key: 0 for key in paths}
    parent_path = OUT / "family-agron-parent-child.bin"
    edge_count = 0
    with source.open("rb") as src, ExitStack() as stack:
        outputs = {k: stack.enter_context(p.open("wb")) for k, p in paths.items()}
        edges = stack.enter_context(parent_path.open("wb"))
        offset = 0
        for line_number, line in enumerate(src):
            row_offset = offset
            offset += len(line)
            if line_number == 0:
                continue
            fields = line.rstrip(b"\r\n").split(b"\t")
            if len(fields) <= 25:
                continue
            try:
                values = [part.decode("utf-8", errors="replace").strip() for part in fields]
            except Exception:
                continue
            row_len = len(line)
            field_values = {
                "text-agron-first": values[1],
                "text-agron-last": values[2],
                "text-agron-city": values[11],
            }
            for key, text in field_values.items():
                for gram in bigrams(text):
                    write_post(outputs[key], hash32(gram), row_offset, row_len)
                    counts[key] += 1
            phone = phone_digits(values[13])
            if phone:
                write_post(outputs["phone-agron"], hash32(phone), row_offset, row_len)
                counts["phone-agron"] += 1
            age = values[14]
            if age.isdigit() and 1 <= int(age) <= 120:
                write_post(outputs["age-agron"], int(age), row_offset, row_len)
                counts["age-agron"] += 1
            child_text = digits(values[0])
            if child_text:
                child_id = int(child_text.zfill(9))
                for parent_index in (20, 22):
                    parent_text = digits(values[parent_index])
                    if parent_text:
                        edges.write(EDGE.pack(int(parent_text.zfill(9)), child_id, row_offset, row_len))
                        edge_count += 1
    for key, count in counts.items():
        indexes[key] = {"source": "AGRON 2006", "dataFile": "AGRON2006.txt", "records": count, "indexFile": paths[key].name, "kind": "age" if key == "age-agron" else "postings"}
    indexes["family-agron-parent-child"] = {"source": "AGRON 2006", "dataFile": "AGRON2006.txt", "records": edge_count, "indexFile": parent_path.name, "kind": "edges"}


def build_elector(indexes: dict[str, object]) -> None:
    source = DATA / "Elector.txt"
    paths = {key: OUT / f"{key}.bin" for key in ("text-elector-first", "text-elector-last", "phone-elector")}
    counts = {key: 0 for key in paths}
    with source.open("rb") as src, ExitStack() as stack:
        outputs = {k: stack.enter_context(p.open("wb")) for k, p in paths.items()}
        offset = 0
        for line_number, line in enumerate(src):
            row_offset = offset
            offset += len(line)
            if line_number < 5:
                continue
            try:
                row = next(csv.reader([line.decode("utf-8", errors="replace")], delimiter=",", quotechar="'"))
            except (csv.Error, StopIteration):
                continue
            if len(row) < 6:
                continue
            for key, text in (("text-elector-first", row[1]), ("text-elector-last", row[2])):
                for gram in bigrams(text):
                    write_post(outputs[key], hash32(gram), row_offset, len(line))
                    counts[key] += 1
            phone = phone_digits(row[4])
            if phone:
                write_post(outputs["phone-elector"], hash32(phone), row_offset, len(line))
                counts["phone-elector"] += 1
    for key, count in counts.items():
        indexes[key] = {"source": "Elector", "dataFile": "Elector.txt", "records": count, "indexFile": paths[key].name, "kind": "postings"}


def build_facebook(indexes: dict[str, object]) -> None:
    source = DATA / "Facebook.txt"
    paths = {key: OUT / f"{key}.bin" for key in ("text-facebook-first-candidate", "text-facebook-last-candidate", "phone-facebook-candidate")}
    counts = {key: 0 for key in paths}
    fbid_path = OUT / "facebook-id.bin"
    fbid_count = 0
    with source.open("rb") as src, ExitStack() as stack:
        outputs = {k: stack.enter_context(p.open("wb")) for k, p in paths.items()}
        fbid_out = stack.enter_context(fbid_path.open("wb"))
        offset = 0
        for line in src:
            row_offset = offset
            offset += len(line)
            fields = line.rstrip(b"\r\n").split(b":")
            if len(fields) < 12:
                continue
            values = [x.decode("utf-8", errors="replace").strip() for x in fields]
            for key, text in (("text-facebook-first-candidate", values[2]), ("text-facebook-last-candidate", values[3])):
                for gram in bigrams(text):
                    write_post(outputs[key], hash32(gram), row_offset, len(line))
                    counts[key] += 1
            phone = phone_digits(values[0])
            if phone:
                write_post(outputs["phone-facebook-candidate"], hash32(phone), row_offset, len(line))
                counts["phone-facebook-candidate"] += 1
            if values[1].isdigit() and len(values[1]) <= 18:
                fbid_out.write(FBID.pack(int(values[1]), row_offset, len(line)))
                fbid_count += 1
    for key, count in counts.items():
        indexes[key] = {"source": "Facebook (שדות מועמדים)", "dataFile": "Facebook.txt", "records": count, "indexFile": paths[key].name, "kind": "postings", "confidence": "candidate"}
    indexes["facebook-id"] = {"source": "Facebook", "dataFile": "Facebook.txt", "records": fbid_count, "indexFile": fbid_path.name, "kind": "facebook-id"}


def sort_index(path: Path, kind: str) -> int:
    dtype = {"postings": POST_DTYPE, "age": POST_DTYPE, "facebook-id": FBID_DTYPE, "edges": EDGE_DTYPE}[kind]
    size = path.stat().st_size
    if size % dtype.itemsize:
        raise RuntimeError(f"Corrupt index: {path.name}")
    count = size // dtype.itemsize
    if not count:
        return 0
    arr = np.fromfile(path, dtype=dtype)
    order = np.argsort(arr["key"], kind="quicksort")
    temp = path.with_suffix(".sorted.tmp")
    arr[order].tofile(temp)
    os.replace(temp, path)
    del arr, order
    return count


def make_sparse(path: Path, sparse_path: Path, kind: str) -> int:
    dtype = {"postings": POST_DTYPE, "age": POST_DTYPE, "facebook-id": FBID_DTYPE, "edges": EDGE_DTYPE}[kind]
    rec = struct.Struct("<QQ") if kind == "facebook-id" else struct.Struct("<IQ")
    count = path.stat().st_size // dtype.itemsize
    sparse_path.parent.mkdir(parents=True, exist_ok=True)
    if not count:
        sparse_path.write_bytes(b"")
        return 0
    full = np.memmap(path, dtype=dtype, mode="r")
    with sparse_path.open("wb") as f:
        for ordinal in range(0, count, BLOCK):
            f.write(rec.pack(int(full["key"][ordinal]), ordinal))
    del full
    return sparse_path.stat().st_size


def main() -> None:
    OUT.mkdir(exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    indexes: dict[str, object] = {}
    print("Building text, phone, age and family indexes from source streams...", flush=True)
    build_agron(indexes)
    build_elector(indexes)
    build_facebook(indexes)
    for key, meta in indexes.items():
        path = OUT / meta["indexFile"]
        count = sort_index(path, meta["kind"])
        meta["records"] = count
        meta["indexBytes"] = path.stat().st_size
        sparse_name = f"{key}.sparse.bin"
        sparse = PUBLIC / sparse_name
        meta["sparseFile"] = sparse_name
        meta["sparseBytes"] = make_sparse(path, sparse, meta["kind"])
        meta["blockRecords"] = BLOCK
        print(f"{key}: entries={count}, bytes={meta['indexBytes']}, sparse={meta['sparseBytes']}", flush=True)
    manifest = {
        "format": "fnv1a32-bigram-or-exact-numeric-range-index; little-endian",
        "postRecordBytes": POST.size,
        "facebookIdRecordBytes": FBID.size,
        "edgeRecordBytes": EDGE.size,
        "blockRecords": BLOCK,
        "indexes": indexes,
    }
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (OUT / "extensions-manifest.json").write_text(text, encoding="utf-8")
    (PUBLIC / "extensions-manifest.json").write_text(text, encoding="utf-8")
    print(f"All extension indexes built; index_count={len(indexes)}", flush=True)


if __name__ == "__main__":
    main()
