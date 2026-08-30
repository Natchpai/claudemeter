#!/usr/bin/env node
// claude-meter — installs, removes or reports the statusLine entry in the
// user's settings.json.
//
// A plugin cannot ship a statusLine of its own: Claude Code's plugin `settings`
// block only accepts `agent` and `subagentStatusLine`. So the plugin edits the
// user settings file instead, from a SessionStart hook and from the
// /claude-meter:enable and /claude-meter:disable commands.

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "claude-meter";
const SETTINGS_FILE = settingsPath();
// The replaced status line is parked here rather than in settings.json: Claude
// Code validates that file and would flag an unknown key.
const PREVIOUS_FILE = join(homedir(), ".claude", "claude-meter", "previous-statusline.json");
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN_ROOT, "scripts", "statusline.sh");
// Guarded rather than a bare `bash "..."`: the install path is version-scoped,
// so it disappears on every plugin update and for good on uninstall. Without the
// guard a settings.json entry that outlives its script fails with exit 127 and a
// `No such file` on every refresh — and after an uninstall the plugin is no
// longer around to repair it. The guard degrades that to an empty status line.
// `-f` not `-x`: the script is run as `bash <file>`, which needs no exec bit, so
// testing for one would let a packaging path that drops modes blank the line.
const COMMAND = `[ -f "${SCRIPT}" ] && bash "${SCRIPT}" || true`;

const mode = process.argv[2] ?? "status";
const quiet = process.argv.includes("--quiet");

try {
  switch (mode) {
    case "enable":
      report(enable({ force: process.argv.includes("--force") }));
      break;
    case "ensure":
      // SessionStart path: never touches a status line the user set up
      // themselves, and stays silent unless it changed something.
      report(enable({ force: false }));
      break;
    case "disable":
      report(disable());
      break;
    default:
      report(status());
  }
} catch (error) {
  report({ ok: false, message: `claude-meter: ${error.message}` });
  process.exit(quiet ? 0 : 1);
}

function enable({ force }) {
  const settings = readSettings();
  const current = settings.statusLine;

  if (current && !isOurs(current) && !force) {
    return {
      ok: false,
      message:
        `claude-meter: left your existing statusLine alone (${describe(current)}).\n` +
        "Run /claude-meter:enable --force to replace it — the previous value is backed up.",
    };
  }
  if (isOurs(current) && current.command === COMMAND) {
    return { ok: true, changed: false, message: "claude-meter: already enabled." };
  }

  if (current && !isOurs(current)) {
    savePrevious(current);
    backup();
  }
  settings.statusLine = {
    type: "command",
    command: COMMAND,
    padding: 0,
    refreshInterval: 10,
  };
  writeSettings(settings);
  return {
    ok: true,
    changed: true,
    message: `claude-meter: status line enabled in ${SETTINGS_FILE}.`,
  };
}

function disable() {
  const settings = readSettings();
  if (!isOurs(settings.statusLine)) {
    return { ok: true, changed: false, message: "claude-meter: not currently enabled." };
  }
  const previous = readPrevious();
  if (previous) {
    settings.statusLine = previous;
    clearPrevious();
  } else {
    delete settings.statusLine;
  }
  writeSettings(settings);
  return {
    ok: true,
    changed: true,
    message: previous
      ? "claude-meter: disabled, your previous status line is restored."
      : "claude-meter: disabled.",
  };
}

function status() {
  const current = readSettings().statusLine;
  if (isOurs(current)) {
    const stale = current.command !== COMMAND;
    return {
      ok: true,
      message: stale
        ? "claude-meter: enabled, but pointing at an old plugin path — run /claude-meter:enable to refresh."
        : "claude-meter: enabled.",
    };
  }
  return {
    ok: true,
    message: current
      ? `claude-meter: disabled — another status line is active (${describe(current)}).`
      : "claude-meter: disabled — no status line configured.",
  };
}

function isOurs(entry) {
  return Boolean(entry && typeof entry.command === "string" && entry.command.includes(MARKER));
}

function describe(entry) {
  const command = typeof entry?.command === "string" ? entry.command : "";
  return command.length > 60 ? `${command.slice(0, 57)}...` : command || "unrecognised entry";
}

function settingsPath() {
  const file = join(homedir(), ".claude", "settings.json");
  // Following a symlink matters: dotfile repos commonly symlink settings.json,
  // and writing through the link would replace it with a plain file.
  try {
    return existsSync(file) ? realpathSync(file) : file;
  } catch {
    return file;
  }
}

function readSettings() {
  if (!existsSync(SETTINGS_FILE)) return {};
  const raw = readFileSync(SETTINGS_FILE, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeSettings(settings) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

function savePrevious(entry) {
  try {
    mkdirSync(dirname(PREVIOUS_FILE), { recursive: true });
    writeFileSync(PREVIOUS_FILE, `${JSON.stringify(entry, null, 2)}\n`);
  } catch {
    // The settings.json backup below is the other half of this safety net.
  }
}

function readPrevious() {
  try {
    return existsSync(PREVIOUS_FILE) ? JSON.parse(readFileSync(PREVIOUS_FILE, "utf8")) : null;
  } catch {
    return null;
  }
}

function clearPrevious() {
  try {
    if (existsSync(PREVIOUS_FILE)) rmSync(PREVIOUS_FILE);
  } catch {
    // Leaving a stale file behind is harmless; it is only read on disable.
  }
}

function backup() {
  const target = `${SETTINGS_FILE}.claude-meter.bak`;
  try {
    copyFileSync(SETTINGS_FILE, target);
  } catch {
    // Best effort: the previous value is also kept inside settings.json itself.
  }
}

// In quiet mode (the SessionStart hook) nothing may reach stdout: Claude Code
// folds SessionStart output into the conversation as context, and a line of
// plugin chatter every session is worse than no message at all. stderr is logged.
function report(result) {
  if (quiet) {
    process.stderr.write(`${result.message}\n`);
    return;
  }
  process.stdout.write(`${result.message}\n`);
}
