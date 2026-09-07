// A small half-block plotting canvas, for the budget chart in the report.
//
// Half blocks rather than braille: braille packs eight dots into a cell and so
// gets four times the vertical resolution, but a cell can only carry one colour
// — and this chart's whole job is telling three overlaid series apart. Two
// pixels per cell, each independently coloured, is the better trade.

const TOP = "▀";
const BOTTOM = "▄";
const BOTH = "█";

/**
 * A canvas `width` cells across and `height` cells tall, addressed in pixels:
 * `width` × `height * 2`, origin bottom-left.
 *
 * Each pixel holds a series id. Higher ids win where series overlap, so the
 * caller orders them by importance rather than by draw order.
 */
export function createCanvas(width, height) {
  const rows = height * 2;
  const pixels = new Int8Array(width * rows).fill(-1);
  const index = (x, y) => y * width + x;

  return {
    width,
    height,
    rows,

    set(x, y, series) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || px >= width || py < 0 || py >= rows) return;
      const at = index(px, py);
      if (series > pixels[at]) pixels[at] = series;
    },

    /**
     * A line from one pixel to another, stepped along whichever axis it spans
     * more of so there are no gaps in a steep one.
     */
    line(x0, y0, x1, y1, series) {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, series);
      }
    },

    /** Rows of rendered text, top row first. `colors` is indexed by series id. */
    render({ palette, colors }) {
      const out = [];
      for (let row = height - 1; row >= 0; row -= 1) {
        const upper = row * 2 + 1;
        const lower = row * 2;
        let line = "";
        for (let x = 0; x < width; x += 1) {
          const top = pixels[index(x, upper)];
          const bottom = pixels[index(x, lower)];
          if (top < 0 && bottom < 0) {
            line += " ";
          } else if (top >= 0 && bottom >= 0) {
            line += palette.paint(BOTH, colors[Math.max(top, bottom)]);
          } else if (top >= 0) {
            line += palette.paint(TOP, colors[top]);
          } else {
            line += palette.paint(BOTTOM, colors[bottom]);
          }
        }
        out.push(line);
      }
      return out;
    },
  };
}
