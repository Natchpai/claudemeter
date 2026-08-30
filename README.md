# claude-meter

A Claude Code plugin that puts your plan usage on the status line:

```
daily usage █████░ 78%, resets in 1h 54m and weekly usage ██░░░░ 34%, resets in 4d 2h
⏵⏵ auto mode on
```

The numbers come straight from Claude's own rate-limit payload — the same source
`/usage` reads — so they match what actually throttles you.

## Requirements

| | |
| --- | --- |
| Claude Code | v2.0 or later (any version with `/plugin`) |
| `node` or `bun` | on your `PATH` — the renderer is a small ES module |
| Auth | a **Claude subscription** (Pro, Max, Team). See [API key users](#api-key-users) |

No other dependencies, no network calls, nothing to build.

## Install

In Claude Code:

```
/plugin marketplace add arifbsmrstu/claude-meter
/plugin install claude-meter@ariful-plugins
```

Claude Code asks for a scope — pick **User** to get it in every project.

Or from a shell:

```bash
claude plugin marketplace add arifbsmrstu/claude-meter
claude plugin install claude-meter@ariful-plugins
```

To pin a release instead of tracking `main`:

```
/plugin marketplace add arifbsmrstu/claude-meter@v0.3.0
```

### First run

Restart Claude Code (or run `/reload-plugins` if the install summary asks). On
session start the plugin writes a `statusLine` entry into
`~/.claude/settings.json` and the line appears on the row **directly above** the
mode indicator.

That settings edit is the one thing worth knowing before you install. It is
deliberate and reversible — see [Why it edits your settings](#why-it-edits-your-settings)
and [Uninstall](#uninstall).

### If you already have a status line

The plugin **will not touch it**. It backs off silently and logs why. To hand the
row over to claude-meter:

```
/claude-meter:enable --force
```

Your previous entry is saved in two places before anything is overwritten:

- `~/.claude/claude-meter/previous-statusline.json`
- `~/.claude/settings.json.claude-meter.bak`

`/claude-meter:disable` restores it from the first of those.

## Commands

| Command | What it does |
| --- | --- |
| `/claude-meter:usage` | Full breakdown — both windows with reset times, today's tally, context window, session cost |
| `/claude-meter:enable` | Wire the status line into `~/.claude/settings.json`. Add `--force` to replace an existing one. Safe to re-run — it reports `already enabled` and changes nothing |
| `/claude-meter:disable` | Remove it and restore whatever was there before |

## Configuration

Set these in your shell environment (`.bashrc`, `.zshrc`, …) — the status line
command inherits them.

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDE_METER_SEGMENTS` | `daily,weekly` | Comma-separated, in display order. Also available: `today`, `ctx`, `cost`, `model`, `dir`, `branch`, `lines` |
| `CLAUDE_METER_STYLE` | `words` | `words` → `daily usage █████░ 78%, resets in 1h 54m`; `compact` → `5h █████░ 78% resets in 1h 54m` |
| `CLAUDE_METER_SEPARATOR` | ` and ` (` · ` in compact) | Text between segments |
| `CLAUDE_METER_RESETS` | `relative` | How each window's reset is shown. `relative` → `resets in 1h 54m`; `clock` → `until 4:39pm` (gaining a weekday when it lands on a later day); `0` → omit it, percentages only |
| `CLAUDE_METER_BARS` | `1` | `0` drops the `█████░` meter before each percentage |
| `CLAUDE_METER_BAR_WIDTH` | `6` | Characters per meter (1–20) |
| `CLAUDE_METER_COLOR` | `1` | `0` disables colour; `NO_COLOR` is honoured too |
| `CLAUDE_METER_NO_AUTO` | unset | `1` stops the SessionStart hook from touching your settings |

Percentages and meters are coloured green below 60%, yellow to 85%, red above.
The status line is truncated rather than wrapped, so keep the segment list
short: the default line is 85 characters wide, and `compact` brings the same
information down to 62.

Bars are deliberately coarse — at the default width, one block is roughly 17
percentage points. They are there to be read at a glance; the number beside them
is the precise figure.

A couple of setups worth copying:

```bash
# minimal — percentages only, no meters or countdowns
export CLAUDE_METER_STYLE=compact
export CLAUDE_METER_BARS=0
export CLAUDE_METER_RESETS=0

# API key user — no plan limits exist, so show what does
export CLAUDE_METER_SEGMENTS=ctx,cost
```

## Troubleshooting

**Nothing appears on the status line.**
Run `/claude-meter:enable`. If it says `already enabled`, restart Claude Code —
a `statusLine` added mid-session isn't picked up until the next launch. If it
says it left an existing status line alone, see
[above](#if-you-already-have-a-status-line).

**The line is there but empty.**
Almost always API key auth — see [API key users](#api-key-users).

**`claude-meter: node or bun not found on PATH`.**
Claude Code spawns the status line through a non-login shell, so a `node` that
only exists after your `.bash_profile` runs (typical with `nvm`) won't be found.
The plugin probes the usual locations including `~/.nvm/versions/node/*/bin/node`;
if yours is elsewhere, symlink it somewhere on the default `PATH`.

**The line came back after I ran `/claude-meter:disable`.**
By design — the `SessionStart` hook re-wires it each session. To make the
removal stick, either disable the plugin in `/plugin`, or set
`CLAUDE_METER_NO_AUTO=1` in your environment.

**It stopped working after a plugin update.**
The plugin's install path changes between versions, so the `statusLine` command
can point at a directory that no longer exists. Run `/claude-meter:enable` — it
detects the stale path and rewrites it.

**Numbers look wrong or stale.**
`/claude-meter:usage` reads a snapshot cached at
`~/.claude/claude-meter/last.json`, written each time the status line renders.
If you've had no session open, the snapshot is as old as your last one.

## API key users

Both percentages need subscription auth. When Claude Code runs on an API key it
does not report `rate_limits` at all, so there is nothing to show and the line
renders empty. The `ctx` and `cost` segments still work:

```bash
export CLAUDE_METER_SEGMENTS=ctx,cost
```

## What "daily" means

Claude tracks usage in two windows, and reports exactly those two:

| Segment | Window | Source |
| --- | --- | --- |
| `daily` | the **5-hour session** window | reported by Claude, exact |
| `weekly` | the rolling **7-day** window | reported by Claude, exact |

There is no calendar-day bucket in Claude's rate limits — `/usage` shows the
same two (plus a Sonnet-only weekly bar on Max and Team plans). `daily` is
therefore the 5-hour window: the bucket that actually throttles you during a
working day. It resets every 5 hours, not at midnight.

If you want a real calendar-day figure, the `today` segment is the plugin's own
tally: weekly-allowance points spent since local midnight, summed from status
line samples. It only counts usage seen while a session had the status line
running, and it starts from zero on the first day.

## Why it edits your settings

A plugin cannot ship a status line of its own. Claude Code's plugin `settings`
block is allowlisted to `agent` and `subagentStatusLine`, so `statusLine` cannot
live in `plugin.json`. Writing to `~/.claude/settings.json` is the only way for
a plugin to occupy that row.

The edit is therefore explicit rather than hidden: it never overwrites a status
line you configured, it backs up what it replaces when you pass `--force`, and
`/claude-meter:disable` puts things back. If you would rather drive it yourself,
set `CLAUDE_METER_NO_AUTO=1` and use `/claude-meter:enable` by hand.

The row above the mode indicator is also the closest supported spot to the mode
text — that row is drawn by Claude Code itself and has no extension point, so
nothing can append directly to it.

## Uninstall

```
/claude-meter:disable
/plugin uninstall claude-meter@ariful-plugins
```

**Run `/claude-meter:disable` first.** It is the only thing that takes the
`statusLine` entry back out of `~/.claude/settings.json`. Uninstalling the plugin
without it leaves the entry behind pointing at a directory that no longer exists
— the status line goes blank and the plugin is no longer around to repair it. To
recover, delete the `statusLine` block from `~/.claude/settings.json` by hand.

The first command restores your previous status line (or removes the entry
entirely if there wasn't one). To clean up the plugin's own state:

```bash
rm -rf ~/.claude/claude-meter
rm -f ~/.claude/settings.json.claude-meter.bak
```

## Layout

```
.claude-plugin/plugin.json       plugin manifest
.claude-plugin/marketplace.json  marketplace manifest, so `plugin install` can find it
hooks/hooks.json                 SessionStart hook that keeps the wiring in place
commands/                        /claude-meter:usage, :enable, :disable
scripts/statusline.{sh,mjs}      the status line renderer
scripts/wire.{sh,mjs}            settings.json enable/disable/status
scripts/report.{sh,mjs}          the /claude-meter:usage report
scripts/runtime.sh               shared node/bun lookup
```

Local development:

```bash
git clone https://github.com/arifbsmrstu/claude-meter.git
claude --plugin-dir ./claude-meter
```

`--plugin-dir` takes precedence over an installed copy of the same plugin, so
you can test changes without uninstalling. `claude plugin validate ./` checks
the manifests.

## License

MIT — see [LICENSE](LICENSE).
