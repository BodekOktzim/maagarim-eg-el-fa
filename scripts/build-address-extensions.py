#!/usr/bin/env python3
"""Build address/area sidecar indexes while preserving all existing indexes."""
from __future__ import annotations

import csv
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
_spec = importlib.util.spec_from_file_location("build_search_extensions", Path(__file__).with_name("build-search-extensions.py"))
assert _spec and _spec.loader
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
POSTING_RECORD_BYTES = 16


def add_postings(path: Path, source: Path, rows, label: str) -> dict[str, object]:
    count = 0
    with path.open("wb") as out:
        for offset, length, address in rows:
            for gram in base.bigrams(address):
                base.write_post(out, base.hash32(gram), offset, length)
                count += 1
    base.sort_index(path, "postings")
    segment_limit = 1_900_000_000 - (1_900_000_000 % POSTING_RECORD_BYTES)
    index_files: list[str] = []
    sparse_files: list[str] = []
    index_bytes: list[int] = []
    remaining = path.stat().st_size
    with path.open("rb") as src:
        segment = 0
        while remaining:
            size = min(remaining, segment_limit)
            name = f"{label}-{segment}.bin"
            segment_path = base.OUT / name
            with segment_path.open("wb") as out:
                left = size
                while left:
                    chunk = src.read(min(left, 64 * 1024 * 1024))
                    if not chunk:
                        raise RuntimeError(f"unexpected EOF while splitting {path}")
                    out.write(chunk)
                    left -= len(chunk)
            sparse_name = f"{label}-{segment}.sparse.bin"
            sparse_path = base.PUBLIC / sparse_name
            base.make_sparse(segment_path, sparse_path, "postings")
            index_files.append(name)
            sparse_files.append(sparse_name)
            index_bytes.append(size)
            remaining -= size
            segment += 1
    path.unlink()
    sparse_bytes = sum((base.PUBLIC / name).stat().st_size for name in sparse_files)
    return {
        "records": count,
        "indexFile": index_files[0],
        "indexFiles": index_files,
        "kind": "postings",
        "indexBytes": sum(index_bytes),
        "indexBytesByFile": index_bytes,
        "sparseFile": sparse_files[0],
        "sparseFiles": sparse_files,
        "sparseBytes": sparse_bytes,
        "blockRecords": base.BLOCK,
    }


def agron_rows(source: Path):
    with source.open("rb") as src:
        offset = 0
        for line_number, line in enumerate(src):
            row_offset = offset
            offset += len(line)
            if line_number < 2:
                continue
            values = [part.decode("utf-8", errors="replace").strip() for part in line.rstrip(b"\r\n").split(b"\t")]
            if len(values) <= 25:
                continue
            address = " ".join(part for part in values[7:12] if part)
            if address:
                yield row_offset, len(line), address


def elector_rows(source: Path):
    with source.open("rb") as src:
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
            if len(row) < 8:
                continue
            address = " ".join(part.strip() for part in row[5:8] if part.strip())
            if address:
                yield row_offset, len(line), address


def main() -> None:
    base.OUT.mkdir(exist_ok=True)
    base.PUBLIC.mkdir(parents=True, exist_ok=True)
    specs = [
        ("text-agron-address", "AGRON 2006", "AGRON2006.txt", agron_rows),
        ("text-elector-address", "Elector", "Elector.txt", elector_rows),
    ]
    manifest_paths = [base.OUT / "extensions-manifest.json", base.PUBLIC / "extensions-manifest.json"]
    manifests = [json.loads(path.read_text(encoding="utf-8")) for path in manifest_paths]
    for key, source_label, file_name, row_reader in specs:
        print(f"Building {key}...", flush=True)
        meta = add_postings(base.OUT / f"{key}.bin", base.DATA / file_name, row_reader(base.DATA / file_name), key)
        meta.update({"source": source_label, "dataFile": file_name})
        for manifest in manifests:
            manifest.setdefault("indexes", {})[key] = meta
    for path, manifest in zip(manifest_paths, manifests):
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Address indexes and manifests updated.", flush=True)


if __name__ == "__main__":
    main()
