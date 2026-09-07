// claudemeter — the visual layer.
//
// One module holds every colour, glyph and meter decision so the status line
// and the long-form report cannot drift apart. Nothing here reads a payload; it
// turns numbers into strings.

// ── colour depth ────────────────────────────────────────────────────────────
//
// Truecolour is what makes the gradients work, but a 256-colour terminal still
// gets a close approximation and a 16-colour one still gets the severity signal.
// Everything degrades in one place: `paint()`.

function detectDepth(env) {
  const forced = (env.CLAUDEMETER_COLOR_DEPTH ?? "").trim();
  if (forced) {
    const n = Number.parseInt(forced, 10);
    if (n === 0 || n === 4 || n === 8 || n === 24) return n;
  }
  if (env.NO_COLOR !== undefined) return 0;
  if (isOff(env.CLAUDEMETER_COLOR)) return 0;
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return 24;
  const term = (env.TERM ?? "").toLowerCase();
  if (term === "dumb") return 0;
  // Every terminal Claude Code realistically runs in supports at least 256
  // colours; the 4-bit rung exists for `TERM=xterm` and friends.
  if (term.includes("256") || term.includes("truecolor") || term.includes("direct")) return 8;
  if (env.WT_SESSION || env.TERM_PROGRAM) return 24;
  return term ? 4 : 0;
}

export function clampPct(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

export function isOff(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "0" || value === "off" || value === "false" || value === "no";
}

export function isOn(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "on" || value === "true" || value === "yes";
}

const RESET = "\x1b[0m";

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// xterm's 256-colour cube: 16 basic, a 6×6×6 colour cube at 16, then 24 greys.
function rgbTo256([r, g, b]) {
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && Math.abs(r - b) < 12) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const q = (v) => Math.round((Math.max(0, Math.min(255, v)) / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

// Nearest of the eight ANSI hues, so the red/amber/green reading survives even
// on a terminal that only has eight of them.
const BASIC = [
  [[0, 0, 0], 30], [[205, 49, 49], 31], [[13, 188, 121], 32], [[229, 229, 16], 33],
  [[36, 114, 200], 34], [[188, 63, 188], 35], [[17, 168, 205], 36], [[229, 229, 229], 37],
];

function rgbToBasic([r, g, b]) {
  let best = 37;
  let bestDistance = Infinity;
  for (const [[cr, cg, cb], code] of BASIC) {
    const distance = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = code;
    }
  }
  return best;
}

export function createPalette(env = process.env) {
  const depth = detectDepth(env);

  function seq(rgb, background) {
    if (depth === 24) {
      return `\x1b[${background ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
    }
    if (depth === 8) {
      return `\x1b[${background ? 48 : 38};5;${rgbTo256(rgb)}m`;
    }
    const code = rgbToBasic(rgb) + (background ? 10 : 0);
    // Bright foregrounds keep the neon feel where 16 colours is all there is.
    return background ? `\x1b[${code}m` : `\x1b[${code};1m`;
  }

  return {
    depth,
    enabled: depth > 0,
    /** Wrap `text` in a foreground colour, and optionally a background. */
    paint(text, fg, bg) {
      if (depth === 0 || (!fg && !bg)) return text;
      const prefix = (bg ? seq(toRgb(bg), true) : "") + (fg ? seq(toRgb(fg), false) : "");
      return prefix + text + RESET;
    },
    /** Raw escape for a foreground colour — for hand-assembled runs. */
    fg(color) {
      return depth === 0 ? "" : seq(toRgb(color), false);
    },
    bg(color) {
      return depth === 0 ? "" : seq(toRgb(color), true);
    },
    reset: depth === 0 ? "" : RESET,
    dim: depth === 0 ? "" : "\x1b[2m",
    bold: depth === 0 ? "" : "\x1b[1m",
  };
}

function toRgb(color) {
  return typeof color === "string" ? hexToRgb(color) : color;
}

// ── gradients ───────────────────────────────────────────────────────────────

/** Sample a multi-stop ramp at `t` ∈ [0,1], interpolating in RGB. */
export function sampleRamp(ramp, t) {
  const stops = ramp.map(toRgb);
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  if (stops.length === 1) return stops[0];
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const [a, b] = [stops[index], stops[index + 1]];
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * local));
}

// ── themes ──────────────────────────────────────────────────────────────────
//
// A theme is a ramp plus the few flat colours around it. The ramp always runs
// calm → alarming, so the gradient carries the same meaning as the old
// green/yellow/red thresholds did — just continuously.

export const THEMES = {
  aurora: {
    label: "cool teal climbing to coral — the default",
    ramp: ["#22d3ee", "#2dd4bf", "#4ade80", "#a3e635", "#fbbf24", "#fb7185"],
    text: "#e2e8f0",
    muted: "#64748b",
    accent: "#a78bfa",
    hues: ["#38bdf8", "#a78bfa", "#fbbf24", "#34d399", "#f472b6"],
    pill: "#161f2e",
    track: "#2b3648",
    rule: "#334155",
  },
  neon: {
    label: "electric cyan through magenta",
    ramp: ["#00f5d4", "#00d4ff", "#7b61ff", "#c026d3", "#f72585", "#ff206e"],
    text: "#f0e7ff",
    muted: "#7c6f9b",
    accent: "#00f5d4",
    hues: ["#00d4ff", "#c77dff", "#ffd60a", "#00f5d4", "#f72585"],
    pill: "#180d2b",
    track: "#33254d",
    rule: "#3b2a5a",
  },
  sunset: {
    label: "gold falling into crimson",
    ramp: ["#ffe066", "#ffb703", "#fb8500", "#f4581c", "#e5383b", "#ba181b"],
    text: "#fff3e0",
    muted: "#9a7b6a",
    accent: "#ffb703",
    hues: ["#ffd166", "#f4845f", "#ffb703", "#e9c46a", "#ef476f"],
    pill: "#241408",
    track: "#452a17",
    rule: "#4a2f1c",
  },
  matrix: {
    label: "phosphor green with a red top end",
    ramp: ["#39ff14", "#26d94a", "#12b886", "#a3e635", "#f4bf1c", "#ff3b3b"],
    text: "#d8ffd8",
    muted: "#4b7a4b",
    accent: "#39ff14",
    hues: ["#7dffb0", "#a3e635", "#facc15", "#39ff14", "#12b886"],
    pill: "#04140a",
    track: "#1c3a22",
    rule: "#1f4429",
  },
  ice: {
    label: "pale blues warming to rose",
    ramp: ["#a5f3fc", "#67e8f9", "#38bdf8", "#818cf8", "#c084fc", "#f472b6"],
    text: "#eaf6ff",
    muted: "#6b8299",
    accent: "#67e8f9",
    hues: ["#67e8f9", "#818cf8", "#a5f3fc", "#38bdf8", "#c084fc"],
    pill: "#0d1826",
    track: "#28394f",
    rule: "#2d4159",
  },
  mono: {
    label: "no hues at all — brightness only",
    ramp: ["#5c6470", "#7d8794", "#9aa4b2", "#b8c1cc", "#d6dde6", "#f5f7fa"],
    text: "#e6e9ee",
    muted: "#6b7280",
    accent: "#d6dde6",
    hues: ["#b8c1cc", "#d6dde6", "#9aa4b2", "#c7cfd9", "#8b95a3"],
    pill: "#15171b",
    track: "#2e3238",
    rule: "#343941",
  },
};

const DEFAULT_THEME = "aurora";

export function resolveTheme(raw) {
  const name = (raw ?? "").trim().toLowerCase();
  return THEMES[name] ? name : DEFAULT_THEME;
}

// ── meters ──────────────────────────────────────────────────────────────────
//
// `smooth` is the default because the partial-block glyphs let a six-cell meter
// resolve to roughly one percent — it reads as a real gauge rather than a row of
// lights. The others are there for fonts that render partial blocks badly.

const PARTIALS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

export const BAR_STYLES = {
  smooth: { full: "█", empty: "░", partials: PARTIALS },
  blocks: { full: "█", empty: "░" },
  shade: { full: "▓", empty: "░" },
  dots: { full: "⣿", empty: "⣀" },
  line: { full: "━", empty: "─" },
  bars: { full: "┃", empty: "╎" },
  ascii: { full: "#", empty: "-" },
};

export function resolveBarStyle(raw) {
  const name = (raw ?? "").trim().toLowerCase();
  return BAR_STYLES[name] ? name : "smooth";
}

// The pace tick is cut *into* the bar rather than drawn beside it: a dark notch
// where the fill is bright, a bright notch where the track is dark. Whichever
// side of it the fill ends on is the whole reading.
const PIP = "│";

/**
 * A gradient meter. Every filled cell is coloured at its *own* position along
 * the ramp, so the bar shades from calm to alarming as it grows — the colour of
 * the leading edge is the reading, and the tail shows how it got there.
 *
 * `pace`, when given, marks the percentage an even burn would have reached by
 * now. Fill short of the tick means you are under budget; fill past it means
 * you are spending faster than the window can carry.
 */
export function meter(value, { width, palette, theme, style = "smooth", pace = null }) {
  const spec = BAR_STYLES[style] ?? BAR_STYLES.smooth;
  const pct = clampPct(value);
  const exact = (pct / 100) * width;
  const whole = Math.floor(exact);
  const remainder = exact - whole;

  const cells = [];
  for (let i = 0; i < width; i += 1) {
    if (i < whole) {
      cells.push({ glyph: spec.full, color: cellColor(theme, i, width), filled: true });
    } else if (i === whole && spec.partials) {
      const step = Math.round(remainder * (spec.partials.length - 1));
      cells.push(
        step > 0
          ? { glyph: spec.partials[step], color: cellColor(theme, i, width), filled: true }
          : { glyph: spec.empty, color: theme.track, filled: false },
      );
    } else if (i === whole && remainder >= 0.5) {
      cells.push({ glyph: spec.full, color: cellColor(theme, i, width), filled: true });
    } else {
      cells.push({ glyph: spec.empty, color: theme.track, filled: false });
    }
  }

  if (pace !== null && Number.isFinite(pace)) {
    // The tick sits in the cell the pace *reaches*, so a pace of 100% marks the
    // last cell rather than falling off the end of the bar.
    const index = Math.min(width - 1, Math.max(0, Math.ceil((clampPct(pace) / 100) * width) - 1));
    const cell = cells[index];
    cells[index] = {
      glyph: PIP,
      // Inverted against whatever it lands on, so the tick is legible whether it
      // falls inside the fill or out on the empty track.
      color: cell.filled ? theme.pill : theme.text,
      background: cell.filled ? cell.color : theme.track,
    };
  }

  // Runs of same-coloured cells are emitted as one escape sequence rather than
  // one per character: a six-cell meter refreshed several times a second is the
  // hottest path in the plugin.
  let out = "";
  let run = "";
  let runColor = null;
  let runBackground;
  const flush = () => {
    if (run) out += palette.paint(run, runColor, runBackground);
    run = "";
  };
  for (const cell of cells) {
    if (cell.color !== runColor || cell.background !== runBackground) {
      flush();
      runColor = cell.color;
      runBackground = cell.background;
    }
    run += cell.glyph;
  }
  flush();
  return out;
}

// ── pace ────────────────────────────────────────────────────────────────────

/** How long each of Claude's two windows runs, in seconds. */
export const WINDOW_SECONDS = { five_hour: 5 * 3600, seven_day: 7 * 86400 };

/**
 * Where an even burn would have reached by now, and how fast you are actually
 * going relative to that.
 *
 * A window that resets at a known time has a known start, so the fraction of it
 * already elapsed is knowable — and that fraction *is* the budget: 40% of the
 * way through the week, an even spender has used 40%. `ratio` above 1 means the
 * cap arrives before the reset does.
 *
 * Returns null when the reset time is missing, or when the window has only just
 * begun: in the first moments the elapsed fraction is near zero and the ratio
 * explodes to a number that says nothing.
 */
export function pace(limit, windowSeconds) {
  if (!limit || typeof limit.used_percentage !== "number") return null;
  if (typeof limit.resets_at !== "number" || !Number.isFinite(limit.resets_at)) return null;
  const remaining = limit.resets_at - Date.now() / 1000;
  const elapsed = windowSeconds - remaining;
  if (elapsed <= 0 || remaining <= 0) return null;
  const fraction = Math.min(1, elapsed / windowSeconds);
  if (fraction < 0.02) return null;
  const target = fraction * 100;
  return {
    fraction,
    target,
    remainingSeconds: remaining,
    ratio: clampPct(limit.used_percentage) / target,
  };
}

/**
 * Ramp colour for a pace ratio. 1.0 is exactly on budget and has to read as
 * unremarkable, so the scale is centred there rather than running 0→100 like a
 * percentage: half-speed sits at the calm end, double-speed at the hot one.
 */
export function paceColor(theme, ratio) {
  const t = Math.max(0, Math.min(1, (ratio - 0.5) / 1.5));
  return sampleRamp(theme.ramp, t);
}

// Cells are sampled at their trailing edge so a full meter ends on the last ramp
// stop and an almost-empty one stays entirely in the calm range.
function cellColor(theme, index, width) {
  return sampleRamp(theme.ramp, (index + 1) / width);
}

/** The ramp colour for a percentage — for the number beside a meter. */
export function valueColor(theme, value) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  // Percentages are read on their own, so they are pushed a little further up
  // the ramp than a bar cell at the same spot: 90% should look alarming even
  // though the ramp's hot end is reserved for 100%.
  return sampleRamp(theme.ramp, Math.min(1, (pct / 100) ** 0.85));
}

// ── sparklines ──────────────────────────────────────────────────────────────

const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** A gradient sparkline over `values`, scaled to `max` (or the series peak). */
export function sparkline(values, { palette, theme, max } = {}) {
  if (!values?.length) return "";
  const peak = Math.max(max ?? 0, ...values, 0.0001);
  return values
    .map((v) => {
      const t = Math.max(0, Math.min(1, v / peak));
      const glyph = SPARKS[Math.min(SPARKS.length - 1, Math.round(t * (SPARKS.length - 1)))];
      return palette.paint(glyph, sampleRamp(theme.ramp, t));
    })
    .join("");
}

// ── pills ───────────────────────────────────────────────────────────────────
//
// Half-block caps rather than the powerline arrows or rounded corners a nerd
// font would give: `▐` and `▌` exist in every font that can already draw the
// meter, so the capsule never degrades into tofu.

export function pill(content, { palette, theme, bg }) {
  const back = bg ?? theme.pill;
  if (!palette.enabled) return content;
  const open = palette.bg(back);
  // Every coloured run inside the capsule ends with a full SGR reset, which
  // clears the background along with the foreground — so the background is
  // re-armed after each one. Cheaper and far less brittle than threading an
  // "active background" through every call that paints something.
  const body = content.split(RESET).join(RESET + open);
  return palette.paint("▐", back) + open + body + palette.reset + palette.paint("▌", back);
}

// ── glyphs ──────────────────────────────────────────────────────────────────

/**
 * Icon sets, each declaring how wide its glyphs are and whether to colour them.
 *
 * `emoji` is the default: emoji already carry their own colour, so painting a
 * foreground over one does nothing in most terminals — which is why the set is
 * marked unpainted rather than being given theme colours it would ignore.
 *
 * `shapes` is the fallback for a font with no emoji coverage. Its glyphs come
 * from the Unicode blocks a monospace font almost always covers, and are
 * deliberately not nerd-font glyphs, which would show as boxes for anyone who
 * has not patched their terminal font.
 */
export const ICON_SETS = {
  emoji: {
    width: 2,
    painted: false,
    glyphs: {
      daily: "⚡",
      weekly: "📅",
      today: "🌞",
      ctx: "🧠",
      cost: "💰",
      model: "✨",
      dir: "📁",
      branch: "🌿",
      lines: "📝",
      spark: "📈",
      reset: "⏳",
      at: "🕒",
      over: "🔥",
    },
  },
  shapes: {
    width: 1,
    painted: true,
    glyphs: {
      daily: "◔",
      weekly: "▦",
      today: "◐",
      ctx: "▣",
      cost: "◈",
      model: "✦",
      dir: "▸",
      branch: "⌥",
      lines: "±",
      spark: "◠",
      reset: "⟳",
      at: "→",
      over: "⁺",
    },
  },
  // For a terminal that can draw neither. The labelled segments drop their icon
  // rather than take a punctuation mark that would just repeat the label sitting
  // next to it.
  ascii: {
    width: 1,
    painted: true,
    glyphs: { cost: "$", model: "*", dir: ">", branch: "@", reset: "in", at: "->", over: "+" },
  },
  none: { width: 0, painted: false, glyphs: {} },
};

export function resolveIconSet(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (isOff(value) || value === "none") return ICON_SETS.none;
  if (value === "shapes" || value === "geometric") return ICON_SETS.shapes;
  if (value === "ascii") return ICON_SETS.ascii;
  return ICON_SETS.emoji;
}

// Decorative colour for a segment that is *not* a meter. A meter and its
// percentage must stay on the usage ramp — 78% has to look like 78% — but the
// model, directory and branch carry no severity, so they take an identity hue
// from the theme instead of all landing in the same grey.
const HUE_INDEX = { dir: 0, model: 2, cost: 2, branch: 3, lines: 4 };

export function hue(theme, name) {
  const hues = theme.hues ?? [theme.accent];
  const index = HUE_INDEX[name];
  return index === undefined ? theme.text : hues[index % hues.length];
}

// ── widths ──────────────────────────────────────────────────────────────────

// Code points that occupy two terminal columns. The emoji set is drawn from
// U+1F300 and up, where two columns is unambiguous; the handful below that are
// listed explicitly because their width turns on the Emoji_Presentation
// property rather than their block — ⚡ is two columns, ☀ is one.
const WIDE_SINGLES = new Set([0x231b, 0x23f3, 0x25fc, 0x26a0, 0x26a1, 0x2705, 0x2728, 0x274c, 0x2757, 0x2b50]);

function codePointWidth(cp) {
  if (cp === 0xfe0f) return 0; // variation selector — modifies, occupies nothing
  if (cp >= 0x1f300 && cp <= 0x1faff) return 2;
  if (cp >= 0x1f000 && cp <= 0x1f2ff) return 2;
  if (cp >= 0x3000 && cp <= 0x9fff) return 2; // CJK, for a directory name in it
  if (WIDE_SINGLES.has(cp)) return 2;
  return 1;
}

/**
 * Terminal columns `text` occupies, ignoring escape sequences (which occupy
 * none) and counting emoji as the two columns they actually take. Alignment in
 * the report depends on this: measuring an emoji as one character shifts every
 * column after it by one.
 */
export function displayWidth(text) {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  let width = 0;
  for (const ch of plain) width += codePointWidth(ch.codePointAt(0));
  return width;
}
