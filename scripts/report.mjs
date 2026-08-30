#!/usr/bin/env node
// Long-form usage report for /claudemeter:usage.
//
// Reads the payload the status line cached on its last refresh — that payload is
// the only place Claude Code exposes rate-limit numbers, and it is handed to the
// statusLine command alone.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_FILE = join(homedir(), ".claude", "claudemeter", "last.json");
const LEDGER_FILE = join(homedir(), ".claude", "claudemeter", "daily.json");

if (!existsSync(STATE_FILE)) {
  console.log("No usage snapshot yet — the status line writes one on its first refresh.");
  console.log("If the status line is not showing, run /claudemeter:enable.");
  process.exit(0);
}

let state;
try {
  state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
} catch (error) {
  console.log(`Could not read the usage snapshot: ${error.message}`);
  process.exit(0);
}

const p = state.payload ?? {};
const ageSeconds = Math.max(0, Math.round((Date.now() - (state.at ?? 0)) / 1000));

console.log(`Snapshot age: ${ageSeconds}s`);
console.log(`Model: ${p.model?.display_name ?? "unknown"}${p.fast_mode ? " (fast mode)" : ""}`);
if (p.effort?.level) console.log(`Effort: ${p.effort.level}`);

const limits = p.rate_limits;
if (limits?.five_hour || limits?.seven_day) {
  console.log("");
  console.log("Plan limits");
  printLimit("  daily  (5-hour session window)", limits.five_hour);
  printLimit("  weekly (7-day window)         ", limits.seven_day);
  printToday();
} else {
  console.log("");
  console.log("Plan limits: not reported (they appear on subscription plans, not API-key auth).");
}

const ctx = p.context_window;
if (ctx) {
  console.log("");
  console.log("Context window");
  console.log(`  used:      ${fmtPct(ctx.used_percentage)} of ${fmtInt(ctx.context_window_size)} tokens`);
  console.log(`  input:     ${fmtInt(ctx.total_input_tokens)}`);
  console.log(`  output:    ${fmtInt(ctx.total_output_tokens)}`);
  if (p.exceeds_200k_tokens) console.log("  note:      past the 200k mark (long-context pricing)");
}

const cost = p.cost;
if (cost) {
  console.log("");
  console.log("This session");
  console.log(`  cost:      $${(cost.total_cost_usd ?? 0).toFixed(4)}`);
  console.log(`  wall time: ${fmtDuration(cost.total_duration_ms)}`);
  console.log(`  api time:  ${fmtDuration(cost.total_api_duration_ms)}`);
  console.log(`  lines:     +${cost.total_lines_added ?? 0} / -${cost.total_lines_removed ?? 0}`);
}

// Claude reports no calendar-day bucket, so this is the plugin's own tally:
// weekly-allowance points spent since local midnight, summed from status line
// samples. It only counts usage seen while a session had the status line up.
function printToday() {
  let ledger;
  try {
    ledger = existsSync(LEDGER_FILE) ? JSON.parse(readFileSync(LEDGER_FILE, "utf8")) : null;
  } catch {
    ledger = null;
  }
  if (!ledger || typeof ledger.accumulated !== "number") return;
  console.log(`  spent today                   : ${ledger.accumulated.toFixed(1)}% of the weekly allowance (tracked locally since ${ledger.day})`);
}

function printLimit(label, limit) {
  if (!limit) {
    console.log(`${label}: not reported`);
    return;
  }
  const resets = fmtReset(limit.resets_at);
  console.log(`${label}: ${fmtPct(limit.used_percentage)} used${resets ? `, resets ${resets}` : ""}`);
}

function fmtPct(value) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "n/a";
}

function fmtInt(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "n/a";
}

function fmtDuration(ms) {
  if (typeof ms !== "number" || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function fmtRelative(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function fmtReset(epochSeconds) {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  const date = new Date(epochSeconds * 1000);
  const minutes = Math.round((epochSeconds - Date.now() / 1000) / 60);
  if (minutes <= 0) return "now";
  return `in ${fmtRelative(minutes)} (${date.toLocaleString()})`;
}
