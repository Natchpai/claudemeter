---
description: Turn off the claude-meter status line and restore any previous one
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/wire.sh" disable`

Report the result above to the user in one line. Also mention that the plugin
re-enables itself on the next session start unless they either disable the
plugin with `/plugin` or set `CLAUDE_METER_NO_AUTO=1`.
