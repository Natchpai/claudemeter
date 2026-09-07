---
description: Preview every claudemeter theme, meter style and layout against a sample reading
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/preview.sh"`

Show the picker above to the user exactly as it is — the colours *are* the
content, so do not summarise it, re-describe the options in prose, or drop any
rows. Every option is rendered at the same sample reading (78% of the 5-hour
window, 34% of the weekly) so the themes can be compared.

If the user names one they want, tell them the line to add to their shell
profile — `export CLAUDEMETER_THEME=<name>` — and that it takes effect on the
next Claude Code launch.
