#!/usr/bin/env python3
"""Install the MINGW64 compiler with the retained Cypher runtime DLL packages."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request


PACKAGE_BASE_URL = "https://repo.msys2.org/mingw/mingw64/"
# GCC requires matching libgcc/libstdc++; winpthreads requires its matching DLL.
# Runtime package identities and hashes remain owned by the retained provenance.
TOOLCHAIN_PACKAGES = (
    (
        "mingw-w64-x86_64-gcc-16.2.0-4-any.pkg.tar.zst",
        "7928a168fe0827e6ba41ea672a9957a5bfa47f732f6922e86cf0f24dd61e5d0c",
    ),
    (
        "mingw-w64-x86_64-winpthreads-14.0.0.r426.g4564ee4b5-1-any.pkg.tar.zst",
        "f8e8cea030192fedc17a41167a868c4de909ebf01ea9730d8d1133641b208785",
    ),
)
RUNTIME_DLLS = {
    "libcrypto-3-x64.dll",
    "libgmp-10.dll",
    "libstdc++-6.dll",
    "libgcc_s_seh-1.dll",
    "libwinpthread-1.dll",
}


def valid_sha256(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value)


def read_runtime_packages():
    provenance = Path(__file__).resolve().parents[1] / "cypher/provenance/msys2/packages.json"
    packages = json.loads(provenance.read_text(encoding="utf-8"))
    if not isinstance(packages, list) or len(packages) != len(RUNTIME_DLLS):
        raise SystemExit("Expected the five retained MSYS2 runtime packages.")
    filenames = set()
    dlls = set()
    for package in packages:
        filename = package.get("package")
        if (
            not isinstance(filename, str)
            or not re.fullmatch(r"mingw-w64-x86_64-[A-Za-z0-9.+_-]+\.pkg\.tar\.zst", filename)
            or filename in filenames
            or package.get("url") != PACKAGE_BASE_URL + filename
            or not valid_sha256(package.get("sha256"))
        ):
            raise SystemExit("Invalid retained MSYS2 package URL, filename, or checksum.")
        filenames.add(filename)
        files = package.get("files")
        if not isinstance(files, list) or len(files) != 1:
            raise SystemExit("Expected one retained runtime DLL per MSYS2 package.")
        dll = files[0].get("path", "").removeprefix("build/bin/")
        if (
            files[0].get("path") != "build/bin/" + dll
            or dll not in RUNTIME_DLLS
            or dll in dlls
            or not valid_sha256(files[0].get("sha256"))
        ):
            raise SystemExit("Invalid retained MSYS2 runtime DLL identity or checksum.")
        dlls.add(dll)
    return packages


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def cygpath(path, mode):
    return subprocess.run(
        ["cygpath", mode, str(path)], check=True, capture_output=True, text=True
    ).stdout.strip()


def main():
    if os.environ.get("MSYSTEM") != "MINGW64" or not all(
        shutil.which(command) for command in ("pacman", "cygpath")
    ):
        raise SystemExit("Run this helper in the GitHub Actions MINGW64 MSYS2 shell.")
    runtime_packages = read_runtime_packages()
    archives = [(item["package"], item["sha256"]) for item in runtime_packages]
    archives.extend(TOOLCHAIN_PACKAGES)
    with tempfile.TemporaryDirectory(prefix="cypherclaw-msys2-") as directory:
        paths = []
        for filename, checksum in archives:
            path = Path(directory) / filename
            print(f"Downloading {filename}", flush=True)
            with urllib.request.urlopen(PACKAGE_BASE_URL + filename, timeout=60) as source:
                with path.open("wb") as target:
                    shutil.copyfileobj(source, target)
            if file_sha256(path) != checksum:
                raise SystemExit(f"MSYS2 package checksum mismatch: {filename}")
            paths.append(cygpath(path, "-u"))
        # One transaction lets pacman resolve the compiler's normal dependencies
        # while preserving both exact runtime dependency pairs.
        subprocess.run(["pacman", "--noconfirm", "-U", *paths], check=True)
    for package in runtime_packages:
        retained = package["files"][0]
        dll = Path(retained["path"]).name
        installed = Path(cygpath("/mingw64/bin/" + dll, "-m" if sys.platform == "win32" else "-u"))
        if file_sha256(installed) != retained["sha256"]:
            raise SystemExit(f"Installed MSYS2 runtime DLL checksum mismatch: {dll}")
    print("Installed pinned GCC and verified all five retained Cypher runtime DLLs.")


if __name__ == "__main__":
    main()
