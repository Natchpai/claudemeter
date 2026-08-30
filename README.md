# claudemeter

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
/plugin marketplace add arifbsmrstu/claudemeter
/plugin install claudemeter@ariful-plugins
```

Claude Code asks for a scope — pick **User** to get it in every project.

Or from a shell:

```bash
claude plugin marketplace add arifbsmrstu/claudemeter
claude plugin install claudemeter@ariful-plugins
```

To pin a release instead of tracking `main`:

```
/plugin marketplace add arifbsmrstu/claudemeter@v0.3.0
```

### Upgrading from `claude-meter`

This plugin was called **claude-meter** — hyphenated — and lived at
`arifbsmrstu/claude-meter`. If you installed it under that name, the old
marketplace entry still points at the old repository path. Remove
it in `/plugin` and add the new one above; the commands are now
`/claudemeter:…` and the settings are `CLAUDEMETER_*`.

`/claude-meter:disable` no longer exists, but you do not need it: the new
version still recognises a status line wired by the old one, so
`/claudemeter:enable` takes the row over and `/claudemeter:disable` removes it.
Old state under `~/.claude/claude-meter/` is not read any more, so the today
tally starts from zero. One thing worth doing by hand first: if the old version
replaced a status line of your own with `--force`, the copy it saved is at
`~/.claude/claude-meter/previous-statusline.json` and the new version will not
find it — restore that entry yourself before deleting the directory.

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
row over to claudemeter:

```
/claudemeter:enable --force
```

Your previous entry is saved in two places before anything is overwritten:

- `~/.claude/claudemeter/previous-statusline.json`
- `~/.claude/settings.json.claudemeter.bak`

`/claudemeter:disable` restores it from the first of those.

## Commands

| Command | What it does |
| --- | --- |
| `/claudemeter:usage` | Full breakdown — both windows with reset times, today's tally, context window, session cost |
| `/claudemeter:enable` | Wire the status line into `~/.claude/settings.json`. Add `--force` to replace an existing one. Safe to re-run — it reports `already enabled` and changes nothing |
| `/claudemeter:disable` | Remove it and restore whatever was there before |

## Configuration

Set these in your shell environment (`.bashrc`, `.zshrc`, …) — the status line
command inherits them.

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDEMETER_SEGMENTS` | `daily,weekly` | Comma-separated, in display order. Also available: `today`, `ctx`, `cost`, `model`, `dir`, `branch`, `lines` |
| `CLAUDEMETER_STYLE` | `words` | `words` → `daily usage █████░ 78%, resets in 1h 54m`; `compact` → `5h █████░ 78% resets in 1h 54m` |
| `CLAUDEMETER_SEPARATOR` | ` and ` (` · ` in compact) | Text between segments |
| `CLAUDEMETER_RESETS` | `relative` | How each window's reset is shown. `relative` → `resets in 1h 54m`; `clock` → `until 4:39pm` (gaining a weekday when it lands on a later day); `0` → omit it, percentages only |
| `CLAUDEMETER_BARS` | `1` | `0` drops the `█████░` meter before each percentage |
| `CLAUDEMETER_BAR_WIDTH` | `6` | Characters per meter (1–20) |
| `CLAUDEMETER_COLOR` | `1` | `0` disables colour; `NO_COLOR` is honoured too |
| `CLAUDEMETER_NO_AUTO` | unset | `1` stops the SessionStart hook from touching your settings |

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
export CLAUDEMETER_STYLE=compact
export CLAUDEMETER_BARS=0
export CLAUDEMETER_RESETS=0

# API key user — no plan limits exist, so show what does
export CLAUDEMETER_SEGMENTS=ctx,cost
```

## Troubleshooting

**Nothing appears on the status line.**
Run `/claudemeter:enable`. If it says `already enabled`, restart Claude Code —
a `statusLine` added mid-session isn't picked up until the next launch. If it
says it left an existing status line alone, see
[above](#if-you-already-have-a-status-line).

**The line is there but empty.**
Almost always API key auth — see [API key users](#api-key-users).

**`claudemeter: node or bun not found on PATH`.**
Claude Code spawns the status line through a non-login shell, so a `node` that
only exists after your `.bash_profile` runs (typical with `nvm`) won't be found.
The plugin probes the usual locations including `~/.nvm/versions/node/*/bin/node`;
if yours is elsewhere, symlink it somewhere on the default `PATH`.

**The line came back after I ran `/claudemeter:disable`.**
By design — the `SessionStart` hook re-wires it each session. To make the
removal stick, either disable the plugin in `/plugin`, or set
`CLAUDEMETER_NO_AUTO=1` in your environment.

**It stopped working after a plugin update.**
The plugin's install path changes between versions, so the `statusLine` command
can point at a directory that no longer exists. Run `/claudemeter:enable` — it
detects the stale path and rewrites it.

**Numbers look wrong or stale.**
`/claudemeter:usage` reads a snapshot cached at
`~/.claude/claudemeter/last.json`, written each time the status line renders.
If you've had no session open, the snapshot is as old as your last one.

## API key users

Both percentages need subscription auth. When Claude Code runs on an API key it
does not report `rate_limits` at all, so there is nothing to show and the line
renders empty. The `ctx` and `cost` segments still work:

```bash
export CLAUDEMETER_SEGMENTS=ctx,cost
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
`/claudemeter:disable` puts things back. If you would rather drive it yourself,
set `CLAUDEMETER_NO_AUTO=1` and use `/claudemeter:enable` by hand.

The row above the mode indicator is also the closest supported spot to the mode
text — that row is drawn by Claude Code itself and has no extension point, so
nothing can append directly to it.

## Uninstall

```
/claudemeter:disable
/plugin uninstall claudemeter@ariful-plugins
```

**Run `/claudemeter:disable` first.** It is the only thing that takes the
`statusLine` entry back out of `~/.claude/settings.json`. Uninstalling the plugin
without it leaves the entry behind pointing at a directory that no longer exists
— the status line goes blank and the plugin is no longer around to repair it. To
recover, delete the `statusLine` block from `~/.claude/settings.json` by hand.

The first command restores your previous status line (or removes the entry
entirely if there wasn't one). To clean up the plugin's own state:

```bash
rm -rf ~/.claude/claudemeter
rm -f ~/.claude/settings.json.claudemeter.bak
```

## Layout

```
.claude-plugin/plugin.json       plugin manifest
.claude-plugin/marketplace.json  marketplace manifest, so `plugin install` can find it
hooks/hooks.json                 SessionStart hook that keeps the wiring in place
commands/                        /claudemeter:usage, :enable, :disable
scripts/statusline.{sh,mjs}      the status line renderer
scripts/wire.{sh,mjs}            settings.json enable/disable/status
scripts/report.{sh,mjs}          the /claudemeter:usage report
scripts/runtime.sh               shared node/bun lookup
```

Local development:

```bash
git clone https://github.com/arifbsmrstu/claudemeter.git
claude --plugin-dir ./claudemeter
```

`--plugin-dir` takes precedence over an installed copy of the same plugin, so
you can test changes without uninstalling. `claude plugin validate ./` checks
the manifests.

## License

MIT — see [LICENSE](LICENSE).
