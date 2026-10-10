#!/usr/bin/env python3
"""Export the frozen Cypher repository source, without runtime or native binaries."""

import argparse
import gzip
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess


EXCLUDED_PATHS = (
    ".idea",
    ".artifacts",
    "browser-llm-lab",
    "build/bin",
    "build/stage",
    "build/provenance",
    "build/tmp",
    "build/nsis.simplefc.dll",
    "cmd/bootnode/bootnode",
    "cmd/bootnode/local.key",
    "cmd/cypher/cypher",
    "cmd/cypher/cypher.exe",
    "cmd/cypher/data",
    "crypto/bls/lib",
)


def git(source, *arguments):
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
    return subprocess.check_output(
        ["git", "-C", str(source), *arguments], env=environment, text=True
    ).strip()


def validate_source(source, sha):
    if Path(git(source, "rev-parse", "--show-toplevel")).resolve() != source:
        raise SystemExit("--source-dir must be the Cypher repository root.")
    if git(source, "rev-parse", "HEAD") != sha:
        raise SystemExit("Cypher checkout HEAD does not match the frozen source SHA.")
    if git(source, "status", "--porcelain=v1", "--untracked-files=no"):
        raise SystemExit("Cypher checkout contains modified tracked source files.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    options = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", options.source_sha):
        parser.error("--source-sha must be a full lowercase commit SHA")
    source = options.source_dir.resolve(strict=True)
    output = options.output_dir.resolve()
    if output == source or source in output.parents:
        parser.error("--output-dir must be outside the source checkout")
    validate_source(source, options.source_sha)
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        parser.error("--output-dir must be a new or empty directory")
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"cypher-source-{options.source_sha}.tar.gz"
    command = [
        "git", "-C", str(source), "archive", "--format=tar",
        f"--prefix=cypher-source-{options.source_sha}/", options.source_sha,
        "--", ".", *(f":(exclude){path}" for path in EXCLUDED_PATHS),
    ]
    # Git reads committed tree bytes; the gzip header has no host path or clock.
    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, env=dict(os.environ, GIT_OPTIONAL_LOCKS="0")
    )
    try:
        with archive.open("xb") as stream:
            with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as compressed:
                shutil.copyfileobj(process.stdout, compressed)
        process.stdout.close()
        if process.wait() != 0:
            raise SystemExit("Git source archive export failed.")
        validate_source(source, options.source_sha)
        digest = hashlib.sha256()
        with archive.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        (output / "SHA256SUMS").write_text(
            f"{digest.hexdigest()}  {archive.name}\n", encoding="utf-8"
        )
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    finally:
        if process.stdout:
            process.stdout.close()
        if process.poll() is None:
            process.terminate()
            process.wait()
    print(f"Exported repository source only: {archive}")
    print("Go module sources and external native dependency sources are not included.")


if __name__ == "__main__":
    main()
