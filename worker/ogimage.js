// Link-preview pictures: the card a chat app shows when someone pastes a remmynd link.
//
// Each shared page (a reminder, a launch, a challenge, a drop, a dare) points its og:image at
// /og/…png?v=<five-minute mark> (worker/og.js), so an app that fetches the picture when the link is
// sent gets where things stand right then: "in 2h 14m", "Live now", "Day 8 of 21", "3 took it".
// The picture is drawn here, with no library: letters come from worker/og-font.js (the site's own
// Geist fonts, drawn once by scripts/og-font.swift), shapes are worked out per pixel, and the result
// is written as a PNG. It shows only what the page itself already shows.

import { FACES, SIZE, PIXELS } from "./og-font.js";

export const W = 1200, H = 630;
const PAD = 72;

export const THEMES = {
  light: { bg: [0xF4, 0xF5, 0xF7], ink: [0x0E, 0x0F, 0x11], mu: [0x66, 0x6C, 0x75], accent: [0xF2, 0xA0, 0x00], tile: [0xFF, 0xFF, 0xFF], eye: [0x66, 0x6C, 0x75], num: [0x0E, 0x0F, 0x11], live: [0xE5, 0x48, 0x4D] },
  dark: { bg: [0x0B, 0x0B, 0x0B], ink: [0xFF, 0xFF, 0xFF], mu: [0xA3, 0xA3, 0xA3], accent: [0xFF, 0xB5, 0x2E], tile: [0x1A, 0x1A, 0x1A], eye: [0xFF, 0xB5, 0x2E], num: [0xFF, 0xB5, 0x2E], live: [0xFF, 0x5A, 0x5F] }
};

/* ---------- letters ---------- */

let fonts = null;
async function loadFonts() {
  if (fonts) return fonts;
  const packed = Uint8Array.from(atob(PIXELS), c => c.charCodeAt(0));
  const raw = new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  if (raw.length !== SIZE) throw new Error("og-font: wrong size");
  const out = {};
  for (const f of FACES) {
    const map = new Map();
    for (const [code, adv, left, top, w, h, off] of f.glyphs) map.set(code, { adv: adv / 64, left, top, w, h, px: raw.subarray(off, off + w * h) });
    out[f.id] = { size: f.size, ascent: f.ascent, map };
  }
  return (fonts = out);
}

/** The letters a face can draw: accents dropped when the face lacks them, anything else (emoji) left out. */
function glyphs(face, text) {
  const out = [];
  for (const ch of String(text)) {
    let g = face.map.get(ch.codePointAt(0));
    if (!g) {
      const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      g = plain && face.map.get(plain.codePointAt(0));
    }
    if (!g && /\s/.test(ch)) g = face.map.get(32);
    if (g) out.push(g);
  }
  return out;
}

const measure = (face, text, track = 0) => glyphs(face, text).reduce((w, g) => w + g.adv + track, 0) - (text ? track : 0);

/** Cuts `text` to `max` pixels wide, ending in an ellipsis when it had to cut. */
function fit(face, text, max) {
  if (measure(face, text) <= max) return text;
  let s = String(text);
  while (s && measure(face, s + "…") > max) s = [...s].slice(0, -1).join("");
  // End on a whole word when that doesn't throw away much of the line.
  const space = s.lastIndexOf(" ");
  if (space > s.length * 0.6) s = s.slice(0, space);
  return s.trimEnd().replace(/[\s,.:;·–—-]+$/, "") + "…";
}

/** Up to `lines` lines of at most `max` pixels, broken at spaces; the last one ends in an ellipsis if it doesn't all fit. */
export function wrap(face, text, max, lines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean), out = [];
  let cur = "";
  while (words.length) {
    const next = cur ? cur + " " + words[0] : words[0];
    if (measure(face, next) <= max || !cur) { cur = next; words.shift(); if (measure(face, cur) > max && !words.length) break; continue; }
    out.push(cur); cur = "";
    if (out.length === lines - 1) break;
  }
  const rest = [cur, ...words].filter(Boolean).join(" ");
  if (rest) out.push(fit(face, rest, max));
  return out.slice(0, lines).map(l => fit(face, l, max));
}

/* ---------- the canvas ---------- */

class Canvas {
  constructor(w, h, bg) {
    this.w = w; this.h = h; this.px = new Uint8Array(w * h * 3);
    this.px.set(bg, 0);
    for (let n = 3; n < this.px.length; n *= 2) this.px.copyWithin(n, 0, Math.min(n, this.px.length - n));
  }
  blend(x, y, c, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3, p = this.px;
    if (a >= 1) { p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; return; }
    p[i] += (c[0] - p[i]) * a; p[i + 1] += (c[1] - p[i + 1]) * a; p[i + 2] += (c[2] - p[i + 2]) * a;
  }
  /** Writes `text` with its baseline at y; returns where the pen ended. */
  text(face, text, x, y, c, track = 0) {
    for (const g of glyphs(face, text)) {
      const gx = Math.round(x) + g.left, gy = Math.round(y) - g.top;
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) { const a = g.px[j * g.w + i]; if (a) this.blend(gx + i, gy + j, c, a / 255); }
      x += g.adv + track;
    }
    return x;
  }
  /** A shape given by its signed distance (pixels, negative inside), smoothed over one pixel at the edge. */
  shape(x0, y0, x1, y1, dist, c) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) this.blend(x, y, c, Math.min(1, Math.max(0, 0.5 - dist(x + 0.5, y + 0.5))));
  }
  roundRect(x, y, w, h, r, c) {
    const cx = x + w / 2, cy = y + h / 2, hw = w / 2 - r, hh = h / 2 - r;
    this.shape(x - 1, y - 1, x + w + 1, y + h + 1, (px, py) => {
      const dx = Math.max(Math.abs(px - cx) - hw, 0), dy = Math.max(Math.abs(py - cy) - hh, 0);
      return Math.hypot(dx, dy) - r + Math.min(Math.max(Math.abs(px - cx) - hw, Math.abs(py - cy) - hh), 0);
    }, c);
  }
  circle(cx, cy, r, c) { this.shape(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => Math.hypot(x - cx, y - cy) - r, c); }
  ring(cx, cy, r, width, c) { this.shape(cx - r - width, cy - r - width, cx + r + width, cy + r + width, (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - width / 2, c); }
}

/* ---------- PNG ---------- */

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An RGB canvas as PNG bytes. Each row uses the "up" filter, so flat areas squeeze to almost nothing. */
export async function png(canvas) {
  const { w, h, px } = canvas, row = w * 3, raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (row + 1), s = y * row;
    raw[o] = 2;
    if (y === 0) raw.set(px.subarray(0, row), o + 1);
    else for (let i = 0; i < row; i++) raw[o + 1 + i] = (px[s + i] - px[s - row + i]) & 255;
  }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const head = new Uint8Array(13), dv = new DataView(head.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); head[8] = 8; head[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/* ---------- the card ---------- */

/**
 * Draws a card. `card`: { theme: "light" | "dark", eye, title, line, big, tone: "live" | "quiet" | "",
 * stats: [{ n, label }] (up to three) }. Returns PNG bytes, 1200 × 630.
 */
export async function cardPNG(card) {
  const f = await loadFonts(), t = THEMES[card.theme] || THEMES.light, c = new Canvas(W, H, t.bg);
  const inner = W - 2 * PAD;

  // The remmynd mark and name.
  c.ring(PAD + 20, PAD + 22, 17, 5, t.ink);
  c.circle(PAD + 20 + 17 * Math.cos(-0.7), PAD + 22 + 17 * Math.sin(-0.7), 6.5, t.accent);
  c.text(f.brand, "remmynd", PAD + 54, PAD + 36, t.ink);

  // Eyebrow, title and the line under it.
  let y = PAD + 124;
  if (card.eye) { c.text(f.eye, fit(f.eye, String(card.eye).toUpperCase(), inner), PAD, y, t.eye, 2); y += 14; }
  const lines = wrap(f.title, card.title || "remmynd", inner, 2);
  for (const l of lines) { y += 80; c.text(f.title, l, PAD, y, t.ink); }
  if (card.line) c.text(f.body, fit(f.body, card.line, inner), PAD, y + 58, t.mu);

  // Bottom row: the state on the left, the numbers on the right.
  const bottom = H - PAD;
  const tileW = s => Math.max(measure(f.num, String(s.n)), measure(f.small, s.label)) + 48;
  let stats = (card.stats || []).filter(s => s && s.label).slice(0, 3);
  const bigText = card.big ? fit(f.big, card.big, inner) : "";
  const dot = card.tone === "live" ? 52 : 0, bigW = bigText ? measure(f.big, bigText) + dot : 0;
  const statsW = () => stats.reduce((n, s) => n + tileW(s) + 16, 0) - (stats.length ? 16 : 0);
  while (stats.length && bigW + 40 + statsW() > inner) stats = stats.slice(0, -1);
  if (bigText) {
    if (dot) c.circle(PAD + 16, bottom - 32, 15, t.live);
    c.text(f.big, bigText, PAD + dot, bottom - 4, card.tone === "quiet" ? t.mu : card.tone === "live" ? t.live : t.ink);
  }
  let x = W - PAD - statsW();
  for (const s of stats) {
    const w = tileW(s);
    c.roundRect(x, bottom - 120, w, 120, 22, t.tile);
    c.text(f.num, String(s.n), x + 24, bottom - 120 + 62, t.num);
    c.text(f.small, s.label, x + 24, bottom - 120 + 100, t.mu);
    x += w + 16;
  }
  return png(c);
}

/* ---------- time words and tags ---------- */

/** "in 12 min", "in 3h 5m", "in 4 days" for `ms` ahead. */
export function inText(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  if (m < 60) return "in " + m + " min";
  if (m < 48 * 60) return "in " + Math.floor(m / 60) + "h" + (m % 60 ? " " + (m % 60) + "m" : "");
  return "in " + Math.round(m / 1440) + " days";
}

/** "2h 14m left", "3 days left". */
export const leftText = ms => inText(ms).slice(3) + " left";

/** The picture's address for a page: the same path under /og/, marked with the five-minute slot, so a newly sent link gets a fresh picture. */
export function ogImageURL(origin, path, now = Date.now()) {
  return origin + "/og" + path + ".png?v=" + Math.floor(now / 300000).toString(36);
}

/** The image tags for a page, every value escaped by the caller's `esc`. */
export function ogImageTags(src, alt, esc) {
  return '<meta property="og:image" content="' + esc(src) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
    '<meta property="og:image:alt" content="' + esc(alt) + '"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' + esc(src) + '">';
}
