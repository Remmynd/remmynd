/* remmynd moment ring: the logo is the interface (docs/v2/SPEC.md, section 8).
 * A 24-hour dial of the viewer's own day in a 0 0 120 120 box, centre (60, 60): noon at the top,
 * midnight at the bottom, clockwise. These functions return SVG markup; app.css colours it from the
 * tokens and draws each state, so a ring can move from Open to Held by changing one class. */

export const STATES = ["open", "held", "soon", "now", "kept", "missed"];
const RING = 44, HAND = 30, NIGHT = 33, GAP = 18, DOT = 8;
/** The dial's measures in the 120 box, for drawing it elsewhere (the Story card draws it on a canvas). */
export const GEOMETRY = { RING, HAND, NIGHT, GAP, DOT };
const round = n => Math.round(n * 100) / 100 + 0; // + 0 turns -0 into 0

/** Angle in degrees for a local time h:m: a = (h + m/60 - 12) * 15. */
export const angle = (h, m = 0) => (h + m / 60 - 12) * 15;

/** The point at angle a (degrees) and radius r: x = 60 + r sin(a), y = 60 - r cos(a). */
export function point(a, r) {
  const t = a * Math.PI / 180;
  return [round(60 + r * Math.sin(t)), round(60 - r * Math.cos(t))];
}

/** A clockwise arc from angle a1 to angle a2 at radius r, as SVG path data. */
export function arc(a1, a2, r) {
  const span = (((a2 - a1) % 360) + 360) % 360;
  const [x1, y1] = point(a1, r), [x2, y2] = point(a2, r);
  return `M${x1} ${y1}A${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

const PERIOD = h => (h < 5 ? "at night" : h < 12 ? "in the morning" : h < 18 ? "in the afternoon" : h < 21 ? "in the evening" : "at night");
const SAYS = { open: "reminder not set yet", held: "reminder set", soon: "starting soon", now: "happening now", kept: "done", missed: "missed" };

/** What the ring says to a screen reader: "Day dial showing 11:30 in the morning, reminder not set yet". */
export function ringLabel(h, m, state = "open") {
  return "Day dial showing " + ((h % 12) || 12) + ":" + String(m).padStart(2, "0") + " " + PERIOD(h) + ", " + (SAYS[state] || SAYS.open);
}

/**
 * The ring for local time h:m in one of the six states.
 * Open: a gap of 18 degrees each side of the dot. Held: the full ring, the dot outlined in the card
 * colour. Soon: Held with a pulsing halo. Now: a moment-coloured disc. Kept: a check in place of the
 * hand. Missed: an open ring in the muted colour with a hollow dot.
 */
export function ringSVG({ h, m = 0, state = "open", size = 128, label, decorative = false } = {}) {
  const s = STATES.includes(state) ? state : "open";
  const a = angle(h, m);
  const [dx, dy] = point(a, RING), [hx, hy] = point(a, HAND);
  // The ring is one circle; its dash pattern (in app.css) leaves the gap, turned to sit around the dot.
  // A circle's dash starts at 3 o'clock, which is 90 degrees on the dial.
  const turn = round(a + GAP - 90);
  const text = (label || ringLabel(h, m, s)).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  // Small rings next to a title (32 px and under) are drawn bolder, without the hand, and hidden from screen readers.
  const mini = size <= 32 ? " ring-mini" : "";
  const a11y = decorative || mini ? 'aria-hidden="true"' : `role="img" aria-label="${text}"`;
  return `<svg class="ring ring-${s}${mini}" width="${size}" height="${size}" viewBox="0 0 120 120" fill="none" ${a11y}>` +
    `<path class="r-night" d="${arc(150, 270, NIGHT)}" stroke-width="8" stroke-linecap="round"/>` +
    `<circle class="r-disc" cx="60" cy="60" r="46"/>` +
    `<circle class="r-ring" cx="60" cy="60" r="${RING}" pathLength="360" stroke-width="5" stroke-linecap="round" transform="rotate(${turn} 60 60)"/>` +
    `<path class="r-hand" d="M60 60L${hx} ${hy}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle class="r-pivot" cx="60" cy="60" r="4"/>` +
    `<path class="r-check" d="M42 62l12 12 24-27" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle class="r-halo" cx="${dx}" cy="${dy}" r="15"/>` +
    `<circle class="r-out" cx="${dx}" cy="${dy}" r="${DOT + 3}"/>` +
    `<circle class="r-dot" cx="${dx}" cy="${dy}" r="${DOT}"/>` +
    `</svg>`;
}
