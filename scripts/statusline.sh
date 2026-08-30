#!/usr/bin/env bash
# Entry point wired into settings.json as the statusLine command.
set -uo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./runtime.sh
. "$here/runtime.sh"

runtime="$(claude_meter_runtime)" || {
  echo "claude-meter: node or bun not found on PATH"
  exit 0
}
exec "$runtime" "$here/statusline.mjs"
