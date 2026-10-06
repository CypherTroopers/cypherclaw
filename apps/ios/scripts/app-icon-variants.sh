#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
case "${1:-check}" in
  generate)
    node "$repo_root/scripts/generate-cypherclaw-native-icons.mjs" --write
    ;;
  check)
    node "$repo_root/scripts/generate-cypherclaw-native-icons.mjs" --check
    ;;
  *)
    echo "usage: $0 [generate|check]" >&2
    exit 2
    ;;
esac
