#!/usr/bin/env bash
set -uo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./runtime.sh
. "$here/runtime.sh"

runtime="$(claude_meter_runtime)" || {
  echo "claude-meter: node or bun not found on PATH; cannot configure the status line"
  exit 0
}
exec "$runtime" "$here/wire.mjs" "$@"
