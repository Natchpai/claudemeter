#!/usr/bin/env node
// Theme picker for /claudemeter:themes.
//
// Renders the *real* status line once per theme rather than a mock-up of one, by
// re-running the renderer as a child process with the theme forced. What the
// picker shows is therefore exactly what the setting produces.

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BAR_STYLES, ICON_SETS, THEMES, createPalette, displayWidth, resolveTheme } from "./theme.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, "statusline.mjs");

// Every option is rendered against the same fixed reading rather than your live
// numbers. A picker is a swatch book: at 3% used, every theme shows one stop of
// its ramp and every meter style shows an empty bar, so they all look alike and
// there is nothing to choose between. A mid-to-high reading exercises the whole
// gradient.
const SAMPLE = {
  model: { display_name: "Opus 5" },
  workspace: { current_dir: "/home/you/my-project", git_worktree: { branch: "feature/auth" } },
  rate_limits: {
    five_hour: { used_percentage: 78.4, resets_at: Math.round(Date.now() / 1000) + 6840 },
    seven_day: { used_percentage: 34.2, resets_at: Math.round(Date.now() / 1000) + 352_800 },
  },
  context_window: { used_percentage: 42.7, context_window_size: 200_000 },
  cost: { total_cost_usd: 3.48, total_lines_added: 284, total_lines_removed: 96 },
};

const env = process.env;
const palette = createPalette(env);
const active = resolveTheme(env.CLAUDEMETER_THEME);
const payload = SAMPLE;
const lines = [];

section("themes", "CLAUDEMETER_THEME");
for (const [name, theme] of Object.entries(THEMES)) {
  lines.push(option(name, render({ CLAUDEMETER_THEME: name }), theme.label, name === active));
}

section("meters", "CLAUDEMETER_BAR_STYLE");
const activeBar = env.CLAUDEMETER_BAR_STYLE?.trim().toLowerCase() || "smooth";
for (const name of Object.keys(BAR_STYLES)) {
  lines.push(
    option(
      name,
      render({ CLAUDEMETER_BAR_STYLE: name, CLAUDEMETER_SEGMENTS: "daily,weekly" }),
      "",
      name === activeBar,
    ),
  );
}

section("layouts", "CLAUDEMETER_STYLE");
for (const name of ["chill", "pill", "compact", "words"]) {
  lines.push(option(name, render({ CLAUDEMETER_STYLE: name }), "", currentStyle() === name));
}

section("icons", "CLAUDEMETER_ICONS");
const activeIcons = iconSetName(env.CLAUDEMETER_ICONS);
for (const name of Object.keys(ICON_SETS)) {
  lines.push(
    option(
      name,
      render({ CLAUDEMETER_ICONS: name, CLAUDEMETER_SEGMENTS: "model,daily,dir,branch" }),
      "",
      name === activeIcons,
    ),
  );
}

section("segments", "CLAUDEMETER_SEGMENTS");
const DEFAULT_SEGMENTS = "model,daily,weekly,dir,branch";
const current = env.CLAUDEMETER_SEGMENTS?.trim() || DEFAULT_SEGMENTS;
for (const set of [
  DEFAULT_SEGMENTS,
  "daily,weekly",
  "model,daily,weekly,dir,branch,cost",
  "daily,weekly,ctx,spark",
  "model,dir,branch,lines",
]) {
  lines.push(option(set, render({ CLAUDEMETER_SEGMENTS: set }), "", set === current));
}

lines.push("");
lines.push("  " + dim("Set any of these in your shell profile, then relaunch Claude Code:"));
lines.push("  " + accent("export CLAUDEMETER_THEME=neon"));
lines.push("  " + accent("export CLAUDEMETER_SEGMENTS=model,daily,weekly,dir,branch"));

process.stdout.write(lines.join("\n") + "\n");

function section(title, variable) {
  const theme = THEMES[active];
  if (lines.length) lines.push("");
  lines.push(
    palette.paint(title.toUpperCase(), theme.accent) +
      palette.paint(`  ${variable}`, theme.muted),
  );
}

/**
 * One option: its name, how many columns it renders in, and the rendered line
 * beneath it.
 *
 * The rendered line gets a row to itself rather than sitting in a column beside
 * the name. Several of these layouts are wider than a terminal — which is the
 * single most useful thing to know when picking one, so the width is printed
 * rather than hidden by truncating the sample.
 */
function option(name, rendered, description, isActive) {
  const theme = THEMES[active];
  const marker = isActive ? palette.paint("▸", theme.accent) : " ";
  const head =
    ` ${marker} ${palette.paint(name, isActive ? theme.accent : theme.text)}` +
    palette.paint(`  ${displayWidth(rendered)} cols`, theme.muted) +
    (description ? palette.paint(`  ${description}`, theme.muted) : "");
  return `${head}\n    ${rendered || palette.paint("(nothing to show)", theme.muted)}`;
}

// One child process per option. The renderer is a few milliseconds of work and
// this keeps the preview honest — there is no second implementation of the
// layout here that could drift from the one that actually runs.
function render(overrides) {
  const result = spawnSync(process.execPath, [RENDERER], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...env, ...overrides, CLAUDEMETER_DRY: "1" },
  });
  return (result.stdout ?? "").trimEnd();
}

function currentStyle() {
  const value = (env.CLAUDEMETER_STYLE ?? "").trim().toLowerCase();
  return ["pill", "compact", "words", "chill"].includes(value) ? value : "chill";
}

function iconSetName(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "0" || value === "off" || value === "false" || value === "no") return "none";
  return value in ICON_SETS ? value : "emoji";
}

function dim(text) {
  return palette.paint(text, THEMES[active].muted);
}

function accent(text) {
  return palette.paint(text, THEMES[active].accent);
}
