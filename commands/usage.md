---
description: Show the full Claude usage breakdown — plan limits, context window, session cost
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/report.sh"`

Present the report above to the user as-is. Do not re-run anything or go looking
for other usage numbers: this snapshot comes from the status line payload, which
is the only place Claude Code exposes plan limits.
