// The live badge: a picture that counts down, for any website, README or forum.
//
// GET /b/<payload>.svg  The badge for a shared link: the moment ring at the host's hour, the title,
//                       a clock, the time and a Remind me pill, with the remmynd mark.
//                       ?theme=light or ?theme=dark pins a theme; without it the picture follows the
//                       viewer's system. ?size=mini gives the one-line form.
// GET /b/example.svg    Demo day, a little over a day away, so the example always ticks.
//
// A browser showing an SVG through an image tag runs CSS animations, but runs no script, loads
// nothing else and ignores taps. So the picture holds no script, no links and no other file; the
// Worker writes the time left at the moment of the request and CSS animations count down from
// there; the snippet wraps the picture in a link. Each digit is a column of digits moved by steps,
// started part-way through with a negative delay, so the first frame is right even where
// animations don't run. State changes (Soon, Live now, Ended) are delayed animations too, so a
// picture left open stays true. Like /r/ and /embed/, the reminder is read from the address only
// to draw it: nothing is stored or logged. Private links (/#…) never reach a server, so they have
// no badge.
import { decode, describeWhen } from "../lib/remmynd.js";
import { angle, point, arc } from "../public/ring.js";
import { clockText } from "../public/clock.js";
import { escapeHTML } from "./preview.js";

const MAX_PAYLOAD = 2000;
const HOUR = 3600, DAY = 86400;

// The picture's own style rules only: it can't load anything.
export const BADGE_CSP = "default-src 'none'; style-src 'unsafe-inline'";
const CACHE = { far: "public, max-age=600", near: "no-cache", soon: "no-cache", now: "no-cache", ended: "public, max-age=86400" };

// The colours from docs/v2/tokens.css. A picture can't read app.css, so it carries its own.
const LIGHT = { bg: "#FFFFFF", ln: "#E3E5E8", ink: "#0E0F11", mu: "#666C75", mo: "#F2A000", om: "#0E0F11", ti: "#FFF4D9", ot: "#5A4300", ni: "rgba(14,15,17,.1)" };
const DARK = { bg: "#17191D", ln: "#2A2D33", ink: "#F4F5F6", mu: "#A3A8B0", mo: "#C8F53B", om: "#0B0C0E", ti: "rgba(200,245,59,.16)", ot: "#C8F53B", ni: "rgba(244,245,246,.14)" };
const vars = c => Object.entries(c).map(([k, v]) => "--" + k + ":" + v).join(";");
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const r2 = n => Math.round(n * 100) / 100 + 0;
const two = n => String(n).padStart(2, "0");

/** far, near, soon, now or ended, for a reminder from `start` to `end` (ms) seen at `now` (ms). */
export function badgeState(start, end, now) {
  if (now >= end) return "ended";
  if (now >= start) return "now";
  const left = (start - now) / 1000;
  return left <= HOUR ? "soon" : left <= 2 * DAY ? "near" : "far";
}

// What the clock shows ("in 12 days", "1d 04:12:09", "04:12:09") is shared with the card: public/clock.js.
export { clockText };

// The clock's columns, each a list of the values it shows from top to bottom, each for `per` seconds.
export const COLUMNS = {
  h: { vals: Array.from({ length: 24 }, (_, i) => two(23 - i)), per: HOUR },
  mt: { vals: ["5", "4", "3", "2", "1", "0"], per: 600 },
  mo: { vals: [..."9876543210"], per: 60 },
  st: { vals: ["5", "4", "3", "2", "1", "0"], per: 10 },
  so: { vals: [..."9876543210"], per: 1 }
};

/** Where a column is with `left` seconds to go: the value showing, its index, and the animation delay (seconds, never positive). */
export function column(key, left) {
  const c = COLUMNS[key], cycle = c.vals.length * c.per;
  let x = left % cycle;
  if (x <= 0) x += cycle;
  const used = cycle - x, index = Math.min(c.vals.length - 1, Math.floor(used / c.per));
  return { value: c.vals[index], index, delay: -r2(used) || 0 };
}

// How wide a line of text is likely to be, in em: the Worker can't measure text, so it estimates.
const charW = c => c.codePointAt(0) >= 0x2E80 ? 1 : " iljtfr.,:;'!|()[]".includes(c) ? 0.32 : "mwMW@%".includes(c) ? 0.86 : /[A-Z0-9#&]/.test(c) ? 0.66 : 0.56;
/** The title cut to about `max` pixels at `size`, ending in an ellipsis when cut, and its estimated width. */
export function fit(text, size, max) {
  const chars = [...String(text).replace(/\s+/g, " ").trim()];
  const width = chars.reduce((n, c) => n + charW(c) * size, 0);
  if (width <= max) return { text: chars.join(""), width };
  let out = "", w = 0;
  for (const c of chars) { const cw = charW(c) * size; if (w + cw > max - 0.6 * size) break; out += c; w += cw; }
  return { text: out.trimEnd() + "…", width: w + 0.6 * size };
}

// The parts of a picture that come and go: shown from `on` to `off` seconds after it loads.
function phase(id, on, off = Infinity) {
  const a = [];
  if (on > 0) a.push("in 1ms " + r2(on) + "s forwards");
  if (off < Infinity) a.push("out 1ms " + r2(off) + "s forwards");
  return a.length ? "#" + id + "{" + (on > 0 ? "opacity:0;" : "") + "animation:" + a.join(",") + "}" : "";
}

// The moment ring in the 0 0 120 120 box of ring.js, drawn with its helpers and inline colours.
function ring(h, m, look) {
  const a = angle(h, m), [dx, dy] = point(a, 44), [hx, hy] = point(a, 30);
  const hand = (c) => '<path d="M60 60L' + hx + " " + hy + '" stroke="var(--' + c + ')" stroke-width="7" stroke-linecap="round"/><circle cx="60" cy="60" r="5" fill="var(--' + c + ')"/>';
  if (look === "now") return '<circle cx="60" cy="60" r="46" fill="var(--mo)"/>' + hand("om") + '<circle cx="' + dx + '" cy="' + dy + '" r="8" fill="var(--om)"/>';
  const ink = look === "ended" ? "mu" : "ink";
  return '<path d="' + arc(a + 18, a - 18, 44) + '" stroke="var(--' + ink + ')" stroke-width="7" stroke-linecap="round"/>' + hand(ink) +
    (look === "ended" ? '<circle cx="' + dx + '" cy="' + dy + '" r="8" fill="var(--bg)" stroke="var(--mu)" stroke-width="5"/>'
      : '<circle cx="' + dx + '" cy="' + dy + '" r="10" fill="var(--mo)"/>');
}

/** The clock's digit columns as SVG, starting at x, with the Soon colour change and the drop of "1d" timed in. */
function clockSVG(left, { x, top, step, base, adv, shift }) {
  const cols = [], css = [];
  const col = (key, at) => {
    const c = COLUMNS[key], { index, delay } = column(key, left), n = c.vals.length, id = "c" + cols.length;
    css.push("#" + id + "{animation:c" + n + " " + n * c.per + "s steps(" + n + ") " + delay + "s infinite}");
    cols.push('<svg x="' + r2(at) + '" y="' + top + '" width="' + r2(c.vals[0].length * adv + 1) + '" height="' + step + '"><g id="' + id + '" transform="translate(0 ' + -index * step + ')"><text x="' +
      // One text, every glyph placed: the x and y lists set each character on its own row.
      c.vals.flatMap(v => [...v].map((_, j) => r2(j * adv))).join(" ") + '" y="' + c.vals.flatMap((v, i) => [...v].map(() => base + i * step)).join(" ") + '">' + c.vals.join("") + "</text></g></svg>");
  };
  const days = left > DAY, x0 = days ? x + 3 * adv : x;
  col("h", x0); col("mt", x0 + 3 * adv); col("mo", x0 + 4 * adv); col("st", x0 + 6 * adv); col("so", x0 + 7 * adv);
  const colon = dx => '<text x="' + r2(x0 + dx * adv) + '" y="' + (top + base) + '">:</text>';
  let out = '<g id="hm">' + cols.join("") + colon(2) + colon(5) + "</g>";
  if (days) {
    out = '<text id="dd" x="' + r2(x) + '" y="' + (top + base) + '">1d</text>' + out;
    css.push(phase("dd", 0, left - DAY), "#hm{animation:sh 1ms " + r2(left - DAY) + "s forwards}@keyframes sh{from,to{transform:translateX(-" + r2(shift) + "px)}}");
  }
  return { svg: out, css: css.join("") };
}

const KEYFRAMES = (n, step) => "@keyframes c" + n + "{from{transform:translateY(0)}to{transform:translateY(-" + n * step + "px)}}";

/** The badge as an SVG string for reminder r seen at `now` (ms). size: "" or "mini". theme: "", "light" or "dark". */
export function liveBadgeSVG(r, { now = Date.now(), theme = "", size = "" } = {}) {
  const zone = r.timeZone || "UTC", start = r.start.getTime(), end = start + (r.durationMinutes || 60) * 60000;
  const state = badgeState(start, end, now), L = (start - now) / 1000, E = (end - now) / 1000;
  const when = describeWhen(r.start, zone), alt = escapeHTML(fit(r.title, 1, 100).text + ", " + when + ". Tap to get reminded.");
  const line = escapeHTML(when.toUpperCase().replace(", ", " · "));
  const ended = escapeHTML(new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", year: "numeric" }).format(r.start).toUpperCase());
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(r.start)) p[x.type] = x.value;
  const h = Number(p.hour) % 24, m = Number(p.minute);
  const ticking = state === "near" || state === "soon";
  const mini = size === "mini";
  const css = [], parts = [];

  // Geometry for each size. Mini: one line, a card-coloured title half and an ink clock half.
  const g = mini
    ? { step: 14, base: 11, adv: 7.2, top: 7, H: 28 }
    : { step: 26, base: 19, adv: 13.2, top: 40, H: 96 };
  const t = mini ? fit(r.title, 12, 180) : fit(r.title, 15, 158);
  let W, cx;
  if (mini) {
    // The clock half is as wide as its widest moment: the clock, "in 12 days", "• Live now" or "Ended".
    const widths = [5 * g.adv];
    if (state === "far") widths.push(clockText(L).length * g.adv);
    if (ticking) widths.push((L > DAY ? 11 : 8) * g.adv);
    if (state !== "ended") widths.push(10 + 8 * g.adv);
    cx = Math.ceil(28 + t.width + 10);
    W = Math.ceil(cx + 20 + Math.max(...widths));
  } else W = 360;
  const tx = mini ? cx + 10 : 88; // where the clock starts
  const seg = fill => '<path d="M' + cx + " .5H" + (W - 14) + "A13.5 13.5 0 0 1 " + (W - 14) + " 27.5H" + cx + 'Z" fill="var(--' + fill + ')"/>';
  const big = (text, cls) => '<text class="' + cls + '" x="' + tx + '" y="' + (g.top + g.base) + '">' + text + "</text>";
  // Text takes its colour from a class, since the style rules outrank fill attributes.
  const pill = (text, fill, cls, stroke) => mini ? "" : '<rect x="254.5" y="22.5" width="89" height="29" rx="14.5" fill="var(--' + fill + ')"' + (stroke ? ' stroke="var(--ln)"' : "") + '/><text class="pl ' + cls + '" x="299" y="41.5">' + text + "</text>";
  const date = text => mini ? "" : '<text class="dt" x="88" y="79">' + text + "</text>";
  const ringAt = look => mini ? "" : '<g transform="translate(18 20) scale(.4667)" fill="none">' + ring(h, m, look) + "</g>";

  // Before the start: the clock (or "in 12 days"), the time and Remind me.
  if (state === "far" || ticking) {
    let body, soonPart = "";
    if (ticking) {
      const c = clockSVG(L, { x: tx, top: g.top, step: g.step, base: g.base, adv: g.adv, shift: 3 * g.adv });
      const at = mini ? when.split(", ")[1].replace(/ \S+$/, "") : when;
      body = '<g id="k" class="ck' + (mini ? " ckm" : "") + '">' + c.svg + '</g><text id="rd" class="rd' + (mini ? " fb" : "") + '" x="' + tx + '" y="' + (g.top + g.base) + '">' + escapeHTML(at) + "</text>";
      // The last hour: the clock on the moment colour (mini) or tint, and the dot glowing.
      const soon = L - HOUR, normal = mini ? "bg" : "ink", lit = mini ? "om" : "ot";
      soonPart = mini ? '<g id="s">' + seg("mo") + "</g>"
        : '<g id="s"><rect x="' + (tx - 6) + '" y="' + (g.top - 1) + '" width="' + r2(8 * g.adv + 12) + '" height="' + (g.step + 2) + '" rx="7" fill="var(--ti)"/>' +
          '<g transform="translate(18 20) scale(.4667)"><circle class="halo" cx="' + point(angle(h, m), 44).join('" cy="') + '" r="16" fill="var(--mo)"/></g></g>';
      css.push(c.css, phase("s", soon, L),
        "#k{fill:var(--" + (soon > 0 ? normal + ");animation:tn 1ms " + r2(soon) + "s forwards}" : lit + ")}") + "@keyframes tn{from,to{fill:var(--" + lit + ")}}" +
        ".halo{transform-box:fill-box;transform-origin:center;animation:halo 2s ease-out infinite}@keyframes halo{0%{transform:scale(.6);opacity:.6}80%,100%{transform:scale(1.3);opacity:0}}" +
        "#rd{display:none}@media (prefers-reduced-motion:reduce){#k,#t{display:none}#rd{display:inline}.halo{animation:none;opacity:.35}}");
    } else body = big(escapeHTML(clockText(L)), mini ? "ck ckm fb" : "ck");
    const ringPart = '<g id="a">' + ringAt("open") + (mini ? seg("ink") : "") + "</g>";
    // The halo sits under the ring; the mini's moment colour sits over its ink half.
    parts.push(...(mini ? [ringPart, soonPart] : [soonPart, ringPart]));
    parts.push('<g id="a2">' + body + (mini ? "" : '<g id="t">' + date(line) + "</g>") + pill("Remind me", "mo", "fo") + "</g>");
    css.push(phase("a", 0, L), phase("a2", 0, L));
  }
  // From the start to the end: Live now, and Open.
  if (state !== "ended") {
    parts.push('<g id="n">' + ringAt("now") + (mini ? seg("mo") : "") + '<circle cx="' + (mini ? tx + 3 : 93) + '" cy="' + (mini ? 14 : 51.5) + '" r="' + (mini ? 3 : 4.5) + '" fill="var(--' + (mini ? "om" : "mo") + ')"/>' +
      '<text class="ck' + (mini ? " ckm fo" : "") + '" x="' + (tx + (mini ? 10 : 15)) + '" y="' + (g.top + g.base) + '">Live now</text>' + date(line) + pill("Open", "ink", "fb") + "</g>");
    css.push(phase("n", L, E));
  }
  // After the end: Ended, and the date with its year.
  parts.push('<g id="e">' + ringAt("ended") + (mini ? seg("ln") : "") + big("Ended", mini ? "ck ckm mu" : "ck mu") + date(ended) + pill("Make yours", "bg", "", true) + "</g>");
  css.push(phase("e", E));

  const colours = theme === "dark" ? vars(DARK) : vars(LIGHT);
  const style = ":root{" + colours + "}" + (theme ? "" : "@media (prefers-color-scheme:dark){:root{" + vars(DARK) + "}}") +
    "text{font-family:" + SANS + ";fill:var(--ink)}.tt{font-weight:600;font-size:" + (mini ? 12 : 15) + "px}" +
    ".ck,.ck text{font:700 22px " + MONO + "}.ckm,.ckm text{font-size:12px;font-weight:600}.ck text{fill:inherit}.mu{fill:var(--mu)}.fo{fill:var(--om)}.fb{fill:var(--bg)}" +
    ".rd{font-weight:600;font-size:" + (mini ? 12 : 13) + "px}.dt{font:500 10.5px " + MONO + ";letter-spacing:.04em;fill:var(--mu)}.pl{font-weight:600;font-size:13px;text-anchor:middle}.mk{font-weight:600;font-size:11px;fill:var(--mu)}" +
    KEYFRAMES(24, g.step) + KEYFRAMES(10, g.step) + KEYFRAMES(6, g.step) + "@keyframes in{from,to{opacity:1}}@keyframes out{from,to{opacity:0}}" + css.join("");

  const mark = mini
    ? '<g transform="translate(8 7) scale(.5833)" fill="none"><path d="M19.947 7.775A9 9 0 1 1 14.781 3.44" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/><path d="M12 12L15.214 8.17" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/><circle cx="17.785" cy="5.106" r="2.4" fill="var(--mo)"/></g>'
    : '<g transform="translate(266 64.5) scale(.5)" fill="none"><path d="M19.947 7.775A9 9 0 1 1 14.781 3.44" stroke="var(--mu)" stroke-width="2.4" stroke-linecap="round"/><path d="M12 12L15.214 8.17" stroke="var(--mu)" stroke-width="2.4" stroke-linecap="round"/></g><text class="mk" x="282" y="74">remmynd</text>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + g.H + '" viewBox="0 0 ' + W + " " + g.H + '" role="img" aria-label="' + alt + '"><title>' + alt + "</title><style>" + style + "</style>" +
    '<rect x=".5" y=".5" width="' + (W - 1) + '" height="' + (g.H - 1) + '" rx="' + (mini ? 13.5 : 19.5) + '" fill="var(--bg)" stroke="var(--ln)"/>' +
    (mini ? "" : '<g transform="translate(18 20) scale(.4667)" fill="none"><path d="' + arc(150, 270, 33) + '" stroke="var(--ni)" stroke-width="8" stroke-linecap="round"/></g>') +
    mark + '<text class="tt" x="' + (mini ? 28 : 88) + '" y="' + (mini ? 18.5 : 32) + '">' + escapeHTML(t.text) + "</text>" + parts.join("") + "</svg>";
}

/** Demo day at 17:00 UTC, the first one more than a day away: always in the ticking Near state. */
export function exampleReminder(now = Date.now()) {
  const d = new Date(now), s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17));
  while (s.getTime() - now <= DAY * 1000) s.setUTCDate(s.getUTCDate() + 1);
  return { title: "Demo day", start: s, durationMinutes: 60, host: "", timeZone: "UTC" };
}

export async function badgeResponse(request, env, url, now = Date.now()) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const m = /^\/b\/([A-Za-z0-9_-]+)\.svg$/.exec(url.pathname);
  const p = m ? m[1] : "";
  const r = p === "example" ? exampleReminder(now) : p && p.length <= MAX_PAYLOAD ? decode(p) : null;
  if (!r) return new Response("Not a remmynd reminder", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const t = url.searchParams.get("theme"), theme = t === "light" || t === "dark" ? t : "";
  const size = url.searchParams.get("size") === "mini" ? "mini" : "";
  const start = r.start.getTime(), state = badgeState(start, start + r.durationMinutes * 60000, now);
  return new Response(request.method === "HEAD" ? null : liveBadgeSVG(r, { now, theme, size }), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CACHE[state], "Content-Security-Policy": BADGE_CSP, "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", "X-Robots-Tag": "noindex"
    }
  });
}
