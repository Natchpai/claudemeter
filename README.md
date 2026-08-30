# claudemeter

A Claude Code plugin that puts your plan usage on the status line:

```
daily usage █████░ 78%, resets in 1h 54m and weekly usage ██░░░░ 34%, resets in 4d 2h
⏵⏵ auto mode on
```

The numbers come straight from Claude's own rate-limit payload — the same source
`/usage` reads — so they match what actually throttles you. No dependencies, no
network calls, nothing to build.

## Requirements

| | |
| --- | --- |
| Claude Code | v2.0 or later (any version with `/plugin`) |
| `node` or `bun` | on your `PATH` — the renderer is a small ES module |
| Auth | a **Claude subscription** (Pro, Max, Team) — API keys report no plan limits |

## Install

```
/plugin marketplace add arifbsmrstu/claudemeter
/plugin install claudemeter@ariful-plugins
```

Claude Code asks for a scope — pick **User** to get it in every project. The same
commands work from a shell as `claude plugin marketplace add …`. To pin a release
instead of tracking `main`, append `@v0.3.0` to the marketplace source.

Then restart Claude Code. The line appears on the row **directly above** the mode
indicator.

### It writes to your settings

Worth knowing before you install: on session start the plugin adds a `statusLine`
entry to `~/.claude/settings.json`.

It has to. A plugin cannot ship a status line of its own — Claude Code's plugin
`settings` block is allowlisted to `agent` and `subagentStatusLine`, so
`statusLine` cannot live in `plugin.json`. Editing user settings is the only way
for a plugin to occupy that row.

The edit is deliberate and reversible:

- It **never overwrites a status line you already configured** — it backs off
  silently. Run `/claudemeter:enable --force` to hand the row over.
- `--force` saves what it replaces to `~/.claude/claudemeter/previous-statusline.json`
  and `~/.claude/settings.json.claudemeter.bak`.
- `/claudemeter:disable` restores it.
- `CLAUDEMETER_NO_AUTO=1` stops the automatic wiring entirely, leaving
  `/claudemeter:enable` as the only way it happens.

## Commands

| Command | What it does |
| --- | --- |
| `/claudemeter:usage` | Full breakdown — both windows with reset times, today's tally, context window, session cost |
| `/claudemeter:enable` | Wire the status line in. `--force` replaces an existing one. Safe to re-run |
| `/claudemeter:disable` | Remove it and restore whatever was there before |

## Configuration

Set these in your shell environment (`.bashrc`, `.zshrc`, …) — the status line
command inherits them.

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDEMETER_SEGMENTS` | `daily,weekly` | Comma-separated, in display order. Also available: `today`, `ctx`, `cost`, `model`, `dir`, `branch`, `lines` |
| `CLAUDEMETER_STYLE` | `words` | `words` → `daily usage █████░ 78%, resets in 1h 54m`; `compact` → `5h █████░ 78% resets in 1h 54m` |
| `CLAUDEMETER_SEPARATOR` | ` and ` (` · ` in compact) | Text between segments |
| `CLAUDEMETER_RESETS` | `relative` | `relative` → `resets in 1h 54m`; `clock` → `until 4:39pm` (gaining a weekday when it lands on a later day); `0` → omit it |
| `CLAUDEMETER_BARS` | `1` | `0` drops the `█████░` meter before each percentage |
| `CLAUDEMETER_BAR_WIDTH` | `6` | Characters per meter (1–20) |
| `CLAUDEMETER_COLOR` | `1` | `0` disables colour; `NO_COLOR` is honoured too |
| `CLAUDEMETER_NO_AUTO` | unset | `1` stops the SessionStart hook from touching your settings |

Percentages and meters are coloured green below 60%, yellow to 85%, red above.
The status line is truncated rather than wrapped, so keep the segment list short:
the default line is 85 characters wide, and `compact` brings the same information
down to 62.

```bash
# minimal — percentages only, no meters or countdowns
export CLAUDEMETER_STYLE=compact
export CLAUDEMETER_BARS=0
export CLAUDEMETER_RESETS=0

# API key auth — no plan limits exist, so show what does
export CLAUDEMETER_SEGMENTS=ctx,cost
```

## What the numbers mean

Claude tracks usage in two windows and reports exactly those two — both exact,
both straight from Claude:

| Segment | Window |
| --- | --- |
| `daily` | the **5-hour session** window |
| `weekly` | the **7-day** window |

There is no calendar-day bucket in Claude's rate limits; `/usage` shows the same
two (plus a Sonnet-only weekly bar on Max and Team plans). So `daily` is the
5-hour window — the bucket that actually throttles you during a working day. It
resets every 5 hours, not at midnight.

`today` is the one figure the plugin computes itself: weekly-allowance points
spent since local midnight, accumulated by diffing successive samples. It only
counts usage seen while a session had the status line running, so it undercounts
if you work with Claude Code closed, and it starts from zero on the first day.

## Troubleshooting

**Nothing appears.**
Run `/claudemeter:enable`. If it says `already enabled`, restart Claude Code — a
`statusLine` added mid-session isn't picked up until the next launch. If it says
it left an existing status line alone, use `--force`.

**The line is there but empty.**
Almost always API key auth. Claude Code doesn't report `rate_limits` at all on an
API key, so there is nothing to show — switch to the `ctx,cost` segments above.

**`claudemeter: node or bun not found on PATH`.**
Claude Code spawns the status line through a non-login shell, so a `node` that
only exists after your `.bash_profile` runs (typical with `nvm`) won't be found.
The plugin probes the usual locations including `~/.nvm/versions/node/*/bin/node`;
if yours is elsewhere, symlink it somewhere on the default `PATH`.

**The line came back after `/claudemeter:disable`.**
By design — the `SessionStart` hook re-wires it each session. To make the removal
stick, disable the plugin in `/plugin` or set `CLAUDEMETER_NO_AUTO=1`.

**It stopped working after a plugin update.**
The install path is version-scoped, so the `statusLine` command can point at a
directory that no longer exists. Run `/claudemeter:enable` — it detects the stale
path and rewrites it.

**Numbers look stale.**
`/claudemeter:usage` reads the snapshot at `~/.claude/claudemeter/last.json`,
rewritten every time the status line renders. With no session open, the snapshot
is as old as your last one.

## Uninstall

```
/claudemeter:disable
/plugin uninstall claudemeter@ariful-plugins
```

**Run `/claudemeter:disable` first.** It is the only thing that takes the
`statusLine` entry back out of `~/.claude/settings.json`. Uninstalling without it
leaves the entry behind pointing at a directory that no longer exists — the line
goes blank and the plugin is no longer around to repair it. To recover, delete
the `statusLine` block from `~/.claude/settings.json` by hand.

To remove the plugin's own state as well:

```bash
rm -rf ~/.claude/claudemeter
rm -f ~/.claude/settings.json.claudemeter.bak
```

## Development

```bash
git clone https://github.com/arifbsmrstu/claudemeter.git
claude --plugin-dir ./claudemeter
```

`--plugin-dir` takes precedence over an installed copy of the same plugin, so you
can test changes without uninstalling. `claude plugin validate ./` checks the
manifests.

## License

MIT — see [LICENSE](LICENSE).
