#!/usr/bin/env bash
# SessionStart hook: make the status line show up on install without the user
# having to run anything. Set CLAUDEMETER_NO_AUTO=1 to opt out and drive it
# manually with /claudemeter:enable.
set -uo pipefail
[ "${CLAUDEMETER_NO_AUTO:-0}" = "1" ] && exit 0
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$here/wire.sh" ensure --quiet
