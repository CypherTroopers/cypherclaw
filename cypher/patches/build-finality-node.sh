#!/usr/bin/env bash

# Bash 5.3+ on macOS can deadlock heredoc pipes; retain the system interpreter.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi

set -Eeuo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

SOURCE_DIR=""
OUTPUT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-dir|--output-dir)
      [[ $# -ge 2 ]] || die "Missing value for $1"
      if [[ "$1" == --source-dir ]]; then SOURCE_DIR="$2"; else OUTPUT_DIR="$2"; fi
      shift 2
      ;;
    *) die "Usage: build-finality-node.sh --source-dir <Cypher checkout> --output-dir <new build directory>" ;;
  esac
done
[[ -n "${SOURCE_DIR}" && -n "${OUTPUT_DIR}" ]] ||
  die "Both --source-dir and --output-dir are required"
for command in git python3 mktemp; do
  command -v "${command}" >/dev/null 2>&1 || die "Required command not found: ${command}"
done

PATCH_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_DIR="$(cd -- "${SOURCE_DIR}" && pwd -P)"
[[ ! -e "${OUTPUT_DIR}" ]] || die "Output directory already exists: ${OUTPUT_DIR}"
mkdir -p -- "${OUTPUT_DIR}"
OUTPUT_DIR="$(cd -- "${OUTPUT_DIR}" && pwd -P)"

BASE_COMMIT="$(python3 - "${PATCH_DIR}" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
metadata = json.loads((root / "transaction-finality-source.json").read_text())
patch = root / metadata["patch"]
if hashlib.sha256(patch.read_bytes()).hexdigest() != metadata["patchSha256"]:
    raise SystemExit("Transaction finality patch checksum mismatch")
print(metadata["baseCommit"])
PY
)"
git -C "${SOURCE_DIR}" cat-file -e "${BASE_COMMIT}^{commit}" ||
  die "Source checkout does not contain pinned commit ${BASE_COMMIT}"

WORK_DIR="$(mktemp -d "${OUTPUT_DIR}/.source.XXXXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT
  rm -rf -- "${WORK_DIR}"
  exit "${status}"
}
trap cleanup EXIT

# The operator's checkout remains untouched. The native builder receives an
# exact private tree; its manifest is extended with the reviewed patch identity.
git clone --quiet --shared --no-checkout -- "${SOURCE_DIR}" "${WORK_DIR}"
git -C "${WORK_DIR}" config core.autocrlf false
git -C "${WORK_DIR}" checkout --quiet --detach "${BASE_COMMIT}"
git -C "${WORK_DIR}" apply --check --whitespace=error "${PATCH_DIR}/transaction-finality-ipc.patch"
git -C "${WORK_DIR}" apply --whitespace=error "${PATCH_DIR}/transaction-finality-ipc.patch"

env SOURCE_SHA="${BASE_COMMIT}" GOWORK=off \
  BINDIR="${OUTPUT_DIR}/bin" \
  STAGE_ROOT="${OUTPUT_DIR}/stage" \
  BUILD_TMPDIR="${OUTPUT_DIR}/tmp" \
  "${BASH}" "${WORK_DIR}/build/build-cypher.sh"

python3 - "${PATCH_DIR}" "${OUTPUT_DIR}" <<'PY'
import json, pathlib, sys
patch_root, output = map(pathlib.Path, sys.argv[1:])
metadata = json.loads((patch_root / "transaction-finality-source.json").read_text())
manifests = list((output / "stage").glob("*/manifest.txt"))
if len(manifests) != 1:
    raise SystemExit("Expected one native target manifest")
with manifests[0].open("a", encoding="utf-8") as stream:
    stream.write(f"source_patch_sha256={metadata['patchSha256']}\n")
    stream.write(f"ipc_transaction_finality_method={metadata['method']}\n")
(output / "transaction-finality-source.json").write_text(json.dumps(metadata, indent=2) + "\n")
PY

for target_dir in "${OUTPUT_DIR}"/stage/*; do
  case "${target_dir##*/}" in
    linux-amd64) native_binary=cypher-linux-amd64 ;;
    darwin-arm64) native_binary=cypher-darwin-arm64 ;;
    windows-amd64) native_binary=cypher.exe ;;
    *) die "Unexpected native target: ${target_dir}" ;;
  esac
  "${GO:-go}" version -m "${target_dir}/${native_binary}" > "${target_dir}/go-build-info.txt"
  # The upstream ledger predates the appended patch identity. Seal the actual
  # staged bytes after adding that identity and the embedded Go build record.
  python3 - "${target_dir}" <<'PY'
import hashlib, pathlib, sys
root = pathlib.Path(sys.argv[1])
entries = []
for path in sorted(root.iterdir()):
    if path.name == "SHA256SUMS":
        continue
    if path.is_symlink() or not path.is_file():
        raise SystemExit(f"Unexpected native artifact: {path.name}")
    entries.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n")
(root / "SHA256SUMS").write_text("".join(entries), encoding="utf-8")
PY
done
printf 'Finality node artifacts: %s/stage\n' "${OUTPUT_DIR}"
