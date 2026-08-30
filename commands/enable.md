---
description: Turn on the claudemeter status line (writes statusLine into ~/.claude/settings.json)
allowed-tools: Bash(bash:*)
argument-hint: "[--force]"
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/wire.sh" enable $ARGUMENTS`

Report the result above to the user in one line. If it says an existing status
line was left alone, mention that `/claudemeter:enable --force` will replace it
and that the previous value is backed up. If the status line was just enabled,
tell the user it appears on the line directly above the mode indicator.
