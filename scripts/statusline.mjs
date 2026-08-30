#!/usr/bin/env node
// claudemeter — renders the Claude Code status line.
//
// Claude Code pipes a JSON payload on stdin and prints whatever this writes to
// stdout on the line directly above the mode indicator. Keep the output to a
// single short line: it is truncated, not wrapped.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_DIR = join(homedir(), ".claude", "claudemeter");
const LAST_FILE = join(STATE_DIR, "last.json");
const LEDGER_FILE = join(STATE_DIR, "daily.json");

const DEFAULT_SEGMENTS = "daily,weekly";

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

const env = process.env;
const style = env.CLAUDEMETER_STYLE === "compact" ? "compact" : "words";
const useColor = env.CLAUDEMETER_COLOR !== "0" && env.NO_COLOR === undefined;
const useBars = !isOff(env.CLAUDEMETER_BARS);
const resetMode = resolveResetMode(env.CLAUDEMETER_RESETS);
const barWidth = clampInt(env.CLAUDEMETER_BAR_WIDTH, 6, 1, 20);
const separator = env.CLAUDEMETER_SEPARATOR ?? (style === "words" ? " and " : " · ");

// Labels differ by style only; the underlying number is identical.
// `daily` is Claude's 5-hour session window — the shortest bucket Claude
// reports, and the one that throttles you during a working day. Claude has no
// calendar-day bucket; `today` below is the closest true one.
const SEGMENTS = {
  daily: { words: "daily usage", compact: "5h" },
  weekly: { words: "weekly usage", compact: "wk" },
  today: { words: "today", compact: "today" },
  ctx: { words: "context", compact: "ctx" },
  cost: { words: "cost", compact: "$" },
  model: {},
  dir: {},
  branch: {},
  lines: {},
};
const ALIASES = { "5h": "daily", week: "weekly", session: "daily" };

main();

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    // No usable payload (manual run, malformed input) — print nothing rather
    // than parking an error message in the user's status line.
    process.exit(0);
  }
  writeJson(LAST_FILE, { at: Date.now(), payload });
  const ledger = updateLedger(payload.rate_limits?.seven_day);
  const line = render(payload, ledger);
  if (line) process.stdout.write(line + "\n");
}

function render(payload, ledger) {
  const names = (env.CLAUDEMETER_SEGMENTS ?? DEFAULT_SEGMENTS)
    .split(",")
    .map((s) => ALIASES[s.trim()] ?? s.trim())
    .filter((s) => s in SEGMENTS);

  const parts = [];
  for (const name of names) {
    const part = renderSegment(name, payload, ledger);
    if (part) parts.push(part);
  }
  return parts.join(color(separator, "dim"));
}

function renderSegment(name, p, ledger) {
  switch (name) {
    case "daily":
      return renderLimit(name, p.rate_limits?.five_hour);
    case "weekly":
      return renderLimit(name, p.rate_limits?.seven_day);
    case "today":
      return ledger ? labelled(name, pct(ledger.accumulated)) : null;
    case "ctx":
      return renderContext(name, p.context_window, p.exceeds_200k_tokens);
    case "cost":
      return renderCost(name, p.cost);
    case "model":
      return p.model?.display_name ?? null;
    case "dir":
      return basename(p.workspace?.current_dir);
    case "branch":
      return p.workspace?.git_worktree?.branch ?? p.workspace?.repo?.branch ?? null;
    case "lines":
      return renderLines(p.cost);
    default:
      return null;
  }
}

// Rate limits are only present on subscription plans; API-key users get nothing
// here, which is why the segment returns null rather than a zeroed-out meter.
function renderLimit(name, limit) {
  if (!limit || typeof limit.used_percentage !== "number") return null;
  const value = clampPct(limit.used_percentage);
  const pieces = [];
  if (useBars) pieces.push(bar(value));
  pieces.push(pct(value));
  const meter = labelled(name, pieces.join(" "));
  const reset = resetLabel(limit.resets_at);
  if (!reset) return meter;
  // "…34%, resets in 4d 2h" is a clause and wants its comma; "…34% until 4:49pm"
  // is a modifier and reads wrong with one. Compact style is a list of tokens
  // either way, so it just takes the space.
  const comma = style === "words" && resetMode !== "clock";
  return meter + color(comma ? `, ${reset}` : ` ${reset}`, "dim");
}

function renderContext(name, ctx, exceeds200k) {
  if (!ctx || typeof ctx.used_percentage !== "number") return null;
  const suffix = exceeds200k ? color("!", "yellow") : "";
  return labelled(name, pct(clampPct(ctx.used_percentage)) + suffix);
}

function renderCost(name, cost) {
  const usd = cost?.total_cost_usd;
  if (typeof usd !== "number" || usd <= 0) return null;
  const amount = `$${usd < 10 ? usd.toFixed(2) : Math.round(usd)}`;
  // The compact label for cost is the "$" the amount already carries.
  return style === "compact" ? amount : labelled(name, amount);
}

function renderLines(cost) {
  const added = cost?.total_lines_added ?? 0;
  const removed = cost?.total_lines_removed ?? 0;
  if (!added && !removed) return null;
  return `${color(`+${added}`, "green")}${color(`-${removed}`, "red")}`;
}

function labelled(name, value) {
  const label = SEGMENTS[name]?.[style];
  return label ? `${label} ${value}` : value;
}

function pct(value) {
  return color(`${Math.round(value)}%`, severity(value));
}

function bar(value) {
  const filled = Math.min(barWidth, Math.round((value / 100) * barWidth));
  return color("█".repeat(filled) + "░".repeat(barWidth - filled), severity(value));
}

// Thresholds mirror how the limits actually bite: below 60% there is nothing to
// think about, 60-85% is worth noticing, above that you are close to throttling.
function severity(value) {
  if (value >= 85) return "red";
  if (value >= 60) return "yellow";
  return "green";
}

// A genuine calendar-day figure, since Claude reports no daily bucket: how many
// points of the weekly allowance were consumed since local midnight. Built by
// diffing successive samples of the weekly percentage, so it only counts usage
// that happened while some Claude Code session had this status line running.
function updateLedger(weekly) {
  if (!weekly || typeof weekly.used_percentage !== "number") return null;
  const current = clampPct(weekly.used_percentage);
  const today = localDay();

  let state = readJson(LEDGER_FILE);
  if (!state || state.day !== today || typeof state.lastPct !== "number") {
    state = { day: today, accumulated: 0, lastPct: current };
    writeJson(LEDGER_FILE, state);
    return state;
  }

  // A drop means the weekly window rolled over, so everything on the clock now
  // was spent since that reset — and therefore today.
  const delta = current < state.lastPct ? current : current - state.lastPct;
  state.accumulated = clampPct(state.accumulated + Math.max(0, delta));
  state.lastPct = current;
  writeJson(LEDGER_FILE, state);
  return state;
}

function localDay() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// Every opt-out reads the same way, so `0`, `off` and `false` are interchangeable
// across the switches rather than each having its own spelling.
function isOff(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "0" || value === "off" || value === "false";
}

// Reset times are shown by default: that a window sits at 78% matters far less
// than whether it clears in ten minutes or three hours.
function resolveResetMode(raw) {
  if (isOff(raw)) return "off";
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "clock" || value === "at" || value === "time") return "clock";
  return "relative";
}

function resetLabel(epochSeconds) {
  if (resetMode === "off") return null;
  if (resetMode === "clock") {
    const clock = clockTime(epochSeconds);
    return clock ? `until ${clock}` : null;
  }
  const rest = relativeTime(epochSeconds);
  return rest ? `resets in ${rest}` : null;
}

// Absolute wall-clock form, for reading "until 6:10pm" instead of doing the
// arithmetic. A reset that lands on a later date carries its weekday, since a
// bare time would otherwise read as only hours away.
function clockTime(epochSeconds) {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  const now = new Date();
  if (epochSeconds <= now.getTime() / 1000) return null;
  const date = new Date(epochSeconds * 1000);
  const time = date
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s*([AP]M)/i, (_, meridiem) => meridiem.toLowerCase());
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function relativeTime(epochSeconds) {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  const seconds = Math.round(epochSeconds - Date.now() / 1000);
  if (seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

function readJson(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  } catch {
    // A read-only or full home directory must not take the status line down.
  }
}

function color(text, name) {
  if (!useColor || !ANSI[name]) return text;
  return ANSI[name] + text + ANSI.reset;
}

function clampPct(value) {
  return Math.max(0, Math.min(100, value));
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function basename(path) {
  if (!path) return null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
