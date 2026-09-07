#!/usr/bin/env node
// Long-form usage report for /claudemeter:usage.
//
// Reads the payload the status line cached on its last refresh — that payload is
// the only place Claude Code exposes rate-limit numbers, and it is handed to the
// statusLine command alone. The history ring buffer beside it is the plugin's
// own, and is what makes the trend and the burn-rate projection possible.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "./chart.mjs";
import {
  THEMES,
  WINDOW_SECONDS,
  clampPct,
  createPalette,
  displayWidth,
  hue,
  isOff,
  meter,
  pace,
  paceColor,
  resolveBarStyle,
  resolveIconSet,
  resolveTheme,
  sampleRamp,
  sparkline,
  valueColor,
} from "./theme.mjs";

const STATE_DIR = join(homedir(), ".claude", "claudemeter");
const STATE_FILE = join(STATE_DIR, "last.json");
const LEDGER_FILE = join(STATE_DIR, "daily.json");
const HISTORY_FILE = join(STATE_DIR, "history.json");

const env = process.env;
const palette = createPalette(env);
const theme = THEMES[resolveTheme(env.CLAUDEMETER_THEME)];
const barStyle = resolveBarStyle(env.CLAUDEMETER_BAR_STYLE);
const iconSet = resolveIconSet(env.CLAUDEMETER_ICONS);
const showPace = !isOff(env.CLAUDEMETER_PACE);
const icons = iconSet.glyphs;

// The report is printed into a slash-command result, so the real terminal width
// is not visible here. 72 columns sits inside every default terminal and inside
// Claude Code's own wrapping.
// The floor is what the gauge rows actually need: the fixed gutter, the widest
// annotation and a meter narrow enough to still mean something. Accepting a
// smaller number would silently produce rows wider than the width asked for.
const WIDTH = clampInt(env.CLAUDEMETER_REPORT_WIDTH, 72, 64, 140);
const LABEL = 14;
// The icon column is as wide as the widest glyph the active set can put in it —
// two columns for emoji, one for the geometric shapes. Measured rather than
// assumed, because an emoji counted as one character shifts every column after
// it by one and the meters stop lining up.
const ICON = iconSet.width;
// A gauge row is `  icon label bar  pct  annotation`. The bar takes whatever is
// left once the fixed columns and the longest annotation are accounted for, so
// widening the report widens the meters rather than leaving a ragged margin.
const GUTTER = 2 + ICON + 1 + LABEL + 1 + 2 + 6 + 2;
// Widest annotation a gauge row can carry: `⏳ 6d 23h · Sun 11:00pm`.
const ANNOTATION = 23;
const BAR = Math.max(10, Math.min(40, WIDTH - GUTTER - ANNOTATION));

const out = [];
main();
process.stdout.write(out.join("\n") + "\n");

function main() {
  const state = readJson(STATE_FILE);
  if (!state) {
    banner(null);
    out.push("");
    note("No usage snapshot yet — the status line writes one on its first refresh.");
    note("If the status line is not showing, run /claudemeter:enable.");
    return;
  }

  const p = state.payload ?? {};
  banner(p, state.at);
  planLimits(p);
  trend();
  budget(p);
  contextWindow(p);
  session(p);
  out.push("");
  legend();
}

// ── header ──────────────────────────────────────────────────────────────────

function banner(p, at) {
  const title = gradientText("CLAUDEMETER", { spaced: true });
  const meta = p ? headerMeta(p, at) : "";
  const titleWidth = "CLAUDEMETER".length * 2 - 1;
  const gap = Math.max(1, WIDTH - 4 - titleWidth - displayWidth(meta));

  out.push(palette.paint("╭" + "─".repeat(WIDTH - 2) + "╮", theme.rule));
  out.push(
    palette.paint("│ ", theme.rule) +
      title +
      " ".repeat(gap) +
      meta +
      palette.paint(" │", theme.rule),
  );
  out.push(palette.paint("╰" + "─".repeat(WIDTH - 2) + "╯", theme.rule));
}

function headerMeta(p, at) {
  const bits = [];
  if (p.model?.display_name) {
    bits.push(palette.paint(p.model.display_name, theme.accent));
  }
  if (p.fast_mode) bits.push(palette.paint("fast", theme.ramp[3]));
  if (p.effort?.level) bits.push(palette.paint(p.effort.level, theme.muted));
  const age = Math.max(0, Math.round((Date.now() - (at ?? 0)) / 1000));
  bits.push(palette.paint(`${fmtAge(age)} ago`, theme.muted));
  return bits.join(palette.paint(" · ", theme.rule));
}

// A single word painted across the ramp, one stop per character. The header is
// the only place this is worth doing — as a way to show, in one glance, which
// colours this theme is going to use for the meters below.
function gradientText(text, { spaced = false } = {}) {
  const chars = [...text];
  return chars
    .map((ch, i) => palette.paint(ch, sampleRamp(theme.ramp, i / Math.max(1, chars.length - 1))))
    .join(spaced ? " " : "");
}

// ── sections ────────────────────────────────────────────────────────────────

function heading(text) {
  out.push("");
  out.push(
    palette.paint(text.toUpperCase(), theme.accent) +
      " " +
      palette.paint("─".repeat(Math.max(0, WIDTH - text.length - 3)), theme.rule),
  );
}

function planLimits(p) {
  const limits = p.rate_limits;
  if (!limits?.five_hour && !limits?.seven_day) {
    heading("plan limits");
    note("Not reported. Plan limits appear on subscription auth (Pro, Max, Team),");
    note("not on an API key. Context and cost below still work.");
    return;
  }
  heading("plan limits");
  gauge("daily", "5-hour session", limits.five_hour, WINDOW_SECONDS.five_hour);
  gauge("weekly", "7-day window", limits.seven_day, WINDOW_SECONDS.seven_day);
  todayGauge();
}

function gauge(icon, label, limit, windowSeconds) {
  if (!limit || typeof limit.used_percentage !== "number") {
    out.push(row(icon, label, palette.paint("not reported", theme.muted)));
    return;
  }
  const value = clampPct(limit.used_percentage);
  const reset = fmtReset(limit.resets_at);
  const budgeted = showPace ? pace(limit, windowSeconds) : null;
  out.push(
    row(
      icon,
      label,
      meter(value, { width: BAR, palette, theme, style: barStyle, pace: budgeted?.target ?? null }) +
        "  " +
        pctText(value) +
        (reset ? "  " + palette.paint(`${icons.reset ?? ""} ${reset}`.trim(), theme.muted) : ""),
    ),
  );
}

// Claude reports no calendar-day bucket, so this is the plugin's own tally:
// weekly-allowance points spent since local midnight, summed from status line
// samples. It only counts usage seen while a session had the status line up.
function todayGauge() {
  const ledger = readJson(LEDGER_FILE);
  if (!ledger || typeof ledger.accumulated !== "number") return;
  // The ledger is only rolled over to a new day by the status line, so before
  // its first refresh of the morning this file still holds yesterday's total.
  // Reporting that as "today" would overstate the day by a full day's usage.
  const stale = ledger.day !== localDay();
  const value = stale ? 0 : clampPct(ledger.accumulated);
  out.push(
    row(
      "today",
      "spent today",
      meter(value, { width: BAR, palette, theme, style: barStyle }) +
        "  " +
        pctText(value) +
        "  " +
        palette.paint(
          stale ? "no samples yet today" : "of weekly allowance",
          theme.muted,
        ),
    ),
  );
}

// The shape of the weekly window over the samples this machine has collected.
// A percentage says where you are; only the trend says whether you are about to
// have a problem, which is the question anyone opening this report actually has.
function trend() {
  const history = readJson(HISTORY_FILE);
  const samples = currentWindow((history?.samples ?? []).filter((s) => typeof s?.wk === "number"));
  if (samples.length < 3) return;

  heading("weekly trend");
  const spanMs = samples[samples.length - 1].t - samples[0].t;
  const gained = samples[samples.length - 1].wk - samples[0].wk;
  const annotation =
    palette.paint(`over ${fmtDuration(spanMs)}`, theme.muted) +
    "  " +
    palette.paint(
      `${gained >= 0 ? "+" : ""}${gained.toFixed(1)} pts`,
      gained > 0 ? valueColor(theme, 40 + gained * 4) : theme.muted,
    );

  // The sparkline takes whatever the annotation leaves, and the samples are
  // thinned to fit rather than truncated — the shape of the whole window matters
  // more than the resolution of its tail.
  const room = Math.max(8, WIDTH - 4 - displayWidth(annotation) - 2);
  const window = thin(samples, room);
  const floor = Math.min(...window.map((s) => s.wk));
  // Rebased on the window's own low point. Absolute percentages barely move
  // across an afternoon, and a sparkline of a flat line says nothing.
  const spark = sparkline(window.map((s) => s.wk - floor), { palette, theme });

  out.push("  " + spark + "  " + annotation);
}

// Samples since the last time the weekly figure went *down* — that is a window
// rollover, and a trend or a burn rate measured across one is meaningless: it
// would read the drop as usage being handed back.
function currentWindow(samples) {
  for (let i = samples.length - 1; i > 0; i -= 1) {
    if (samples[i].wk < samples[i - 1].wk - 0.5) return samples.slice(i);
  }
  return samples;
}

// Even sampling down to `count` points, keeping the first and last.
function thin(samples, count) {
  if (samples.length <= count) return samples;
  const step = (samples.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => samples[Math.round(i * step)]);
}

// Points per hour across the sampled window. Deliberately a straight line
// through two endpoints: usage is bursty, and a fitted curve would imply a
// confidence these samples cannot support.
function burnPerHour(samples) {
  if (!samples || samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const hours = (last.t - first.t) / 3_600_000;
  if (hours < 0.25) return null;
  return (last.wk - first.wk) / hours;
}

// Where the weekly window is heading, drawn rather than asserted.
//
// Three series: the even-burn diagonal a perfect spender would follow, the
// samples actually collected, and a ray forward from the last one at the burn
// rate measured over them. Whether that ray meets the top of the chart before
// it reaches the right edge is the answer to "will I run out this week" — and
// unlike a percentage, it shows you by how much.
function budget(p) {
  const weekly = p.rate_limits?.seven_day;
  const budgeted = showPace ? pace(weekly, WINDOW_SECONDS.seven_day) : null;
  if (!budgeted) return;

  const history = readJson(HISTORY_FILE);
  const samples = currentWindow((history?.samples ?? []).filter((s) => typeof s?.wk === "number"));
  const used = clampPct(weekly.used_percentage);
  const perHour = burnPerHour(samples);

  heading("weekly budget");

  // The chart carries three overlaid series and tells them apart by colour
  // alone — half blocks give it the vertical resolution but no way to vary the
  // mark. With colour off it would be one indecipherable staircase, so the
  // verdict is printed on its own instead of over a chart that cannot be read.
  if (!palette.enabled) {
    out.push("  " + verdict(used, perHour, budgeted));
    return;
  }

  const plot = WIDTH - 7;
  const canvas = createCanvas(plot, 6);
  const windowStart = weekly.resets_at - WINDOW_SECONDS.seven_day;
  const toX = (epochSeconds) =>
    ((epochSeconds - windowStart) / WINDOW_SECONDS.seven_day) * (plot - 1);
  const toY = (pct) => (clampPct(pct) / 100) * (canvas.rows - 1);

  const BUDGET_LINE = 0;
  const PROJECTION = 1;
  const OBSERVED = 2;

  canvas.line(0, 0, plot - 1, canvas.rows - 1, BUDGET_LINE);

  const nowX = toX(Date.now() / 1000);
  if (perHour !== null && perHour > 0.01) {
    const hoursToCap = (100 - used) / perHour;
    const hoursToReset = budgeted.remainingSeconds / 3600;
    const hours = Math.min(hoursToCap, hoursToReset);
    canvas.line(
      nowX,
      toY(used),
      toX(Date.now() / 1000 + hours * 3600),
      toY(used + perHour * hours),
      PROJECTION,
    );
  }

  for (const sample of samples) {
    const seconds = sample.t / 1000;
    if (seconds < windowStart) continue;
    canvas.set(toX(seconds), toY(sample.wk), OBSERVED);
  }
  // A window only sampled for an hour draws as a single pixel, which is easy to
  // lose against the diagonal — so the current reading is always marked.
  canvas.set(nowX, toY(used), OBSERVED);

  const colors = [];
  colors[BUDGET_LINE] = theme.rule;
  colors[PROJECTION] = theme.accent;
  colors[OBSERVED] = valueColor(theme, used);

  const rendered = canvas.render({ palette, colors });
  const labels = ["100", "", "", " 50", "", ""];
  rendered.forEach((line, i) => {
    out.push(
      "  " +
        palette.paint((labels[i] ?? "").padStart(3), theme.muted) +
        " " +
        palette.paint(i === 0 ? "┤" : "│", theme.rule) +
        line,
    );
  });
  // The x axis carries a tick for now, which is the only position on it the
  // reader has to locate. Both ends are deliberately unlabelled: a 7-day window
  // opens and closes on the same weekday at the same time, so labelling the
  // start printed the same string as the end and read as a mistake.
  const nowCol = Math.round(nowX);
  out.push(
    "  " +
      palette.paint("  0", theme.muted) +
      " " +
      palette.paint("└" + "─".repeat(nowCol), theme.rule) +
      palette.paint("┴", theme.accent) +
      palette.paint("─".repeat(Math.max(0, plot - nowCol - 1)), theme.rule),
  );

  const reset = `resets ${fmtWhen(new Date(weekly.resets_at * 1000))}`;
  const nowLabel = "now";
  const nowAt = Math.max(0, Math.min(plot - nowLabel.length, nowCol - 1));
  const gap = plot - nowAt - nowLabel.length - reset.length;
  out.push(
    "      " +
      " ".repeat(nowAt) +
      palette.paint(nowLabel, theme.accent) +
      // A reset label that would collide with the `now` label is dropped rather
      // than shoved: late in a window the two are genuinely the same place.
      (gap >= 2 ? " ".repeat(gap) + palette.paint(reset, theme.muted) : ""),
  );

  out.push("");
  out.push("  " + verdict(used, perHour, budgeted));
}

// Plain language for what the chart shows, because a line that nearly touches
// the top is worth stating outright.
function verdict(used, perHour, budgeted) {
  const ratio = budgeted.ratio;
  const pacing =
    palette.paint(`${ratio < 10 ? ratio.toFixed(2) : Math.round(ratio)}×`, paceColor(theme, ratio)) +
    palette.paint(" even burn", theme.muted);

  if (perHour === null || perHour <= 0.01) {
    return pacing + palette.paint("  ·  flat — nothing to project", theme.muted);
  }
  const hoursToReset = budgeted.remainingSeconds / 3600;
  const atReset = used + perHour * hoursToReset;
  if (atReset <= 100) {
    return (
      pacing +
      palette.paint("  ·  finishes the window at ", theme.muted) +
      palette.paint(`${Math.round(atReset)}%`, valueColor(theme, atReset))
    );
  }
  const hoursToCap = (100 - used) / perHour;
  return (
    pacing +
    palette.paint("  ·  caps ", theme.muted) +
    palette.paint(fmtWhen(new Date(Date.now() + hoursToCap * 3600_000)), theme.text) +
    palette.paint(`, ${fmtHours(hoursToReset - hoursToCap)} early`, theme.ramp[theme.ramp.length - 1])
  );
}

function contextWindow(p) {
  const ctx = p.context_window;
  if (!ctx || typeof ctx.used_percentage !== "number") return;
  heading("context window");
  const value = clampPct(ctx.used_percentage);
  const size = ctx.context_window_size;
  const used = typeof size === "number" ? Math.round((value / 100) * size) : null;
  out.push(
    row(
      "ctx",
      "used",
      meter(value, { width: BAR, palette, theme, style: barStyle }) +
        "  " +
        pctText(value) +
        (used !== null
          ? "  " + palette.paint(`${fmtTokens(used)}/${fmtTokens(size)} tok`, theme.muted)
          : ""),
    ),
  );
  const io = [
    `in ${fmtInt(ctx.total_input_tokens)}`,
    `out ${fmtInt(ctx.total_output_tokens)}`,
  ];
  if (typeof ctx.total_cache_read_tokens === "number") {
    io.push(`cache ${fmtInt(ctx.total_cache_read_tokens)}`);
  }
  out.push(row(null, "", palette.paint(io.join("   "), theme.muted)));
  if (p.exceeds_200k_tokens) {
    out.push(
      row(
        null,
        "",
        `${icons.over ?? "!"} ` + palette.paint("past 200k — long-context pricing", theme.ramp[3]),
      ),
    );
  }
}

function session(p) {
  const cost = p.cost;
  if (!cost) return;
  heading("this session");
  const usd = cost.total_cost_usd ?? 0;
  out.push(
    row(
      "cost",
      "cost",
      palette.paint(`$${usd.toFixed(4)}`, theme.text) +
        palette.paint("   wall ", theme.muted) +
        palette.paint(fmtDuration(cost.total_duration_ms), theme.text) +
        palette.paint("   api ", theme.muted) +
        palette.paint(fmtDuration(cost.total_api_duration_ms), theme.text),
    ),
  );
  const added = cost.total_lines_added ?? 0;
  const removed = cost.total_lines_removed ?? 0;
  out.push(
    row(
      "lines",
      "lines",
      palette.paint(`+${added}`, theme.ramp[2]) +
        "  " +
        palette.paint(`-${removed}`, theme.ramp[theme.ramp.length - 1]),
    ),
  );
}

function legend() {
  out.push(
    "  " +
      meter(100, { width: 14, palette, theme, style: barStyle }) +
      palette.paint(" 0→100%", theme.muted) +
      palette.paint("   theme ", theme.muted) +
      palette.paint(resolveTheme(env.CLAUDEMETER_THEME), theme.accent) +
      palette.paint("   /claudemeter:themes", theme.muted),
  );
}

// ── layout helpers ──────────────────────────────────────────────────────────

function row(iconKey, label, body) {
  const text = label
    ? palette.paint(label.padEnd(LABEL), label ? hue(theme, iconKey) : theme.text)
    : " ".repeat(LABEL);
  return `  ${iconCell(iconKey)} ${text} ${body}`;
}

// The glyph padded out to the icon column. Emoji already carry their own colour,
// so a foreground escape around one is ignored by most terminals.
function iconCell(iconKey) {
  const raw = iconKey ? (icons[iconKey] ?? "") : "";
  if (!raw) return " ".repeat(ICON);
  const painted = iconSet.painted ? palette.paint(raw, theme.muted) : raw;
  return painted + " ".repeat(Math.max(0, ICON - displayWidth(raw)));
}

function note(text) {
  out.push("  " + palette.paint(text, theme.muted));
}

function pctText(value) {
  return palette.paint(`${value.toFixed(1)}%`.padStart(6), valueColor(theme, value));
}

// ── formatting ──────────────────────────────────────────────────────────────

function localDay() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// Token counts are compared, not read out loud, so three significant figures in
// four columns beats an exact count that pushes the row past the margin.
function fmtTokens(value) {
  if (typeof value !== "number") return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return `${value}`;
}

function fmtInt(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "n/a";
}

function fmtAge(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return fmtHours(seconds / 3600);
}

function fmtDuration(ms) {
  if (typeof ms !== "number" || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function fmtHours(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) {
    const whole = Math.floor(hours);
    const minutes = Math.round((hours - whole) * 60);
    return minutes ? `${whole}h ${minutes}m` : `${whole}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

function fmtWhen(date) {
  const now = new Date();
  const time = date
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s*([AP]M)/i, (_, meridiem) => meridiem.toLowerCase());
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function fmtReset(epochSeconds) {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  const hours = (epochSeconds - Date.now() / 1000) / 3600;
  if (hours <= 0) return "now";
  return `${fmtHours(hours)} · ${fmtWhen(new Date(epochSeconds * 1000))}`;
}

function readJson(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
