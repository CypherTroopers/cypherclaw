#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---write}"
if [[ "$MODE" != "--write" && "$MODE" != "--check" ]]; then
  echo "Usage: /bin/bash scripts/generate-mac-app-icons.sh [--write|--check]" >&2
  exit 1
fi

# Native icon masters belong to the independent CypherClaw fork.
# The app packaging step still uses actool for the system-managed .icon artwork.
node "$ROOT_DIR/scripts/generate-cypherclaw-native-icons.mjs" "$MODE"
