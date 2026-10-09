#!/usr/bin/env bash

# Bash 5.3+ on macOS can deadlock heredoc pipes. A piped installer cannot replay stdin.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  case "${BASH_SOURCE[0]:-}" in
    ""|bash|-bash|/dev/stdin)
      printf '%s\n' 'Run this installer with /bin/bash on macOS.' >&2
      exit 1
      ;;
    *) exec /bin/bash "$0" "$@" ;;
  esac
fi

set -euo pipefail

REPOSITORY="CypherTroopers/cypherclaw"
RELEASE_TAG="latest"
RELEASE_DIR=""
PREFIX="${HOME:-}/.cypherclaw"
NODE_VERSION="24.21.0"
NO_ONBOARD=0
DRY_RUN=0
STAGING_DIR=""

fail() {
  printf 'CypherClaw installation failed: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    'Usage: install.sh [options]' \
    '  --version <release-tag>  Install an immutable CypherClaw release (default: latest)' \
    '  --prefix <path>          Private install directory (default: ~/.cypherclaw)' \
    '  --release-dir <path>     Install verified release files from a local directory' \
    '  --no-onboard             Install without starting interactive setup' \
    '  --dry-run                Describe the installation without making changes' \
    '  --help                   Show this help'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|--prefix|--release-dir)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "Missing value for $1"
      case "$1" in
        --version) RELEASE_TAG="$2" ;;
        --prefix) PREFIX="$2" ;;
        --release-dir) RELEASE_DIR="$2" ;;
      esac
      shift 2
      ;;
    --no-onboard) NO_ONBOARD=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

[[ -n "${HOME:-}" ]] || fail 'HOME is unavailable. Run from your user account.'
case "$PREFIX" in
  \~) PREFIX="$HOME" ;;
  \~/*) PREFIX="$HOME/${PREFIX#\~/}" ;;
esac
case "$PREFIX" in
  /*) ;;
  *) PREFIX="$PWD/$PREFIX" ;;
esac
[[ "$PREFIX" != / && "$PREFIX" != "$HOME" ]] || fail 'Choose a private subdirectory for --prefix.'

if [[ "$RELEASE_TAG" != latest && ! "$RELEASE_TAG" =~ ^cypherclaw-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$ ]]; then
  fail 'Use a complete CypherClaw release tag, such as cypherclaw-v2026.9.9-0123456789ab.'
fi
if [[ -n "$RELEASE_DIR" ]]; then
  [[ -d "$RELEASE_DIR" ]] || fail "Release directory does not exist: $RELEASE_DIR"
  RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd -P)"
fi

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64|Linux/amd64|Darwin/arm64|Darwin/aarch64) ;;
  *) fail 'This release supports Linux x64 (including WSL2) and Apple Silicon macOS. Use install.ps1 for Windows x64.' ;;
esac

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'CypherClaw source: %s\n' "${RELEASE_DIR:-https://github.com/$REPOSITORY/releases/$RELEASE_TAG}"
  printf 'Private install directory: %s\n' "$PREFIX"
  printf 'Verify release checksums, provision private Node %s, and install the prebuilt package.\n' "$NODE_VERSION"
  if [[ "$NO_ONBOARD" -eq 0 ]]; then
    printf '%s\n' 'Then start the existing interactive setup with the cypherclaw profile.'
  fi
  exit 0
fi

command -v tar >/dev/null 2>&1 || fail 'tar is required. Install tar and rerun this command.'
if [[ -z "$RELEASE_DIR" ]]; then
  command -v curl >/dev/null 2>&1 || fail 'curl is required. Install curl and rerun this command.'
fi

download() {
  curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 300 --speed-limit 1 --speed-time 300 \
    --retry 3 --retry-delay 1 --retry-connrefused -o "$2" "$1"
}

if [[ -z "$RELEASE_DIR" && "$RELEASE_TAG" == latest ]]; then
  # Resolve once: every asset must come from the same immutable release.
  resolved_url="$(curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 300 --speed-limit 1 --speed-time 300 \
    -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest")" || \
    fail 'No release could be resolved. Check the CypherClaw Releases page and your network connection.'
  release_url_prefix="https://github.com/$REPOSITORY/releases/tag/"
  [[ "$resolved_url" == "$release_url_prefix"* ]] || fail 'GitHub did not return a CypherClaw release tag.'
  RELEASE_TAG="${resolved_url#"$release_url_prefix"}"
  [[ "$RELEASE_TAG" =~ ^cypherclaw-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$ ]] || fail 'The latest release does not have a valid CypherClaw tag.'
fi

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cypherclaw-install.XXXXXX")" || fail 'Cannot create an installation staging directory.'
trap 'rm -rf -- "$STAGING_DIR"' EXIT

get_asset() {
  local file="$1"
  if [[ -n "$RELEASE_DIR" ]]; then
    [[ -f "$RELEASE_DIR/$file" && ! -L "$RELEASE_DIR/$file" ]] || fail "Release asset is missing or is a symlink: $file"
    cp "$RELEASE_DIR/$file" "$STAGING_DIR/$file"
  else
    download "https://github.com/$REPOSITORY/releases/download/$RELEASE_TAG/$file" "$STAGING_DIR/$file" || fail "Cannot download release asset: $file"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    fail 'A SHA-256 tool is required: sha256sum, shasum, or openssl.'
  fi
}

verify_asset() {
  local file="$1" expected actual
  expected="$(awk -v name="$file" '{ candidate=$2; sub(/^\*/, "", candidate); sub(/\r$/, "", candidate); if (NF == 2 && candidate == name) { print $1; count++ } } END { if (count != 1) exit 1 }' "$STAGING_DIR/SHA256SUMS")" || fail "Expected one checksum for $file"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Invalid SHA-256 checksum for $file"
  actual="$(sha256_file "$STAGING_DIR/$file")"
  [[ "$(printf '%s' "$actual" | tr 'A-F' 'a-f')" == "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ]] || fail "SHA-256 verification failed for $file"
}

get_asset SHA256SUMS
for asset in cypherclaw-release.json install-node.sh install-runtime.mjs cypherclaw-contract.mjs cypherclaw.tgz; do
  get_asset "$asset"
  verify_asset "$asset"
done

printf 'Installing CypherClaw from %s\n' "${RELEASE_DIR:-$RELEASE_TAG}"
bash "$STAGING_DIR/install-node.sh" --node-only --prefix "$PREFIX" --node-version "$NODE_VERSION"
NODE="$PREFIX/tools/node/bin/node"
[[ -x "$NODE" ]] || fail "Private Node is unavailable at $NODE"
[[ "$("$NODE" --version)" == "v$NODE_VERSION" ]] || fail "Private Node must be exactly $NODE_VERSION for this release."
runtime_args=(--release-dir "$STAGING_DIR" --prefix "$PREFIX")
if [[ "$RELEASE_TAG" != latest ]]; then
  runtime_args+=(--release-tag "$RELEASE_TAG")
fi
if [[ "$NO_ONBOARD" -eq 1 ]]; then
  runtime_args+=(--no-onboard)
fi

# curl | bash leaves stdin at the script pipe; onboarding needs the user's terminal.
if [[ "$NO_ONBOARD" -eq 0 && -t 1 ]] && ( : </dev/tty ) 2>/dev/null; then
  "$NODE" "$STAGING_DIR/install-runtime.mjs" "${runtime_args[@]}" </dev/tty
else
  "$NODE" "$STAGING_DIR/install-runtime.mjs" "${runtime_args[@]}"
fi
