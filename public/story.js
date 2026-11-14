/* remmynd Story card: a 1080 by 1920 picture for Stories and statuses, drawn on this device with a
 * canvas. Nothing is uploaded. app.js loads this on the first tap of Story, after it has copied the
 * link inside that tap. The card prints the date and time, never time left, because a picture can't
 * tick. The lower third stays empty, for Instagram's Link and Countdown stickers: no outside app can
 * place a link or a ticking countdown in a Story, so the sheet says how to add them. */
import { describeWhen, placeLabel } from "./remmynd.js";
import { angle, arc, point, GEOMETRY as G } from "./ring.js";

export const W = 1080, H = 1920;
const SANS = ", system-ui, -apple-system, sans-serif";

/**
 * The card's words. Pure: the same reminder always gives the same lines, and `when` is a date and time, never
 * "tomorrow" or "in 3 days". joiner: the card of someone who's in, with `you`, their place in a public count.
 * lastCall: the host's card near the start ("Last call"); it stays up for a day, so it too prints the date and time.
 */
export function lines({ title, start }, { timeZone, joiner = false, you = 0, lastCall = false } = {}) {
  return {
    kicker: "REMINDER",
    top: joiner ? "I'm in." : lastCall ? "Last call" : "",
    place: joiner ? placeLabel(you) : "",
    title: String(title || "").replace(/\s+/g, " ").trim(),
    when: describeWhen(start, timeZone),
    cta: "Tap the link to get reminded"
  };
}

/** Lines of at most `width`, measured with measure(text). Past `max` lines, the last one ends in an ellipsis. */
export function wrap(text, width, measure, max = Infinity) {
  const out = [];
  let cur = "";
  for (const word of String(text).split(" ").filter(Boolean)) {
    const next = cur ? cur + " " + word : word;
    if (measure(next) <= width) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = word;
    // A word wider than the line is broken where it must be.
    while (measure(cur) > width && cur.length > 1) {
      let i = cur.length - 1;
      while (i > 1 && measure(cur.slice(0, i)) > width) i--;
      out.push(cur.slice(0, i)); cur = cur.slice(i);
    }
  }
  if (cur) out.push(cur);
  if (out.length <= max) return out;
  const kept = out.slice(0, max);
  let last = kept[max - 1];
  while (last && measure(last + "…") > width) last = last.slice(0, -1).trimEnd();
  kept[max - 1] = last + "…";
  return kept;
}

/** Share the picture where the browser can share files; otherwise save it. */
export function canShareFile(nav, file) {
  try { return !!(nav && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] })); } catch (e) { return false; }
}

/** The Snapchat link: Snapchat's own share address with the reminder link. No script from another host. */
export const snapURL = link => "https://www.snapchat.com/share?link=" + encodeURIComponent(link);

function colours() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  return { bg: v("--band"), ink: v("--on-band"), muted: v("--on-band-muted"), night: v("--band-line"), accent: v("--band-accent") };
}

function hm(start, timeZone) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(start));
  const get = t => +p.find(x => x.type === t).value;
  return [get("hour") % 24, get("minute")];
}

// The moment ring, from ring.js's own geometry. Open for the host; held, a full ring, for someone who's in;
// kept, with a check in place of the hand, for the year card.
function ring(ctx, x, y, size, [h, m], look, c) {
  const held = look !== "open";
  const a = angle(h, m), [dx, dy] = point(a, G.RING), [hx, hy] = point(a, G.HAND);
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / 120, size / 120);
  ctx.lineCap = "round";
  const stroke = (path, w, colour) => { ctx.lineWidth = w; ctx.strokeStyle = colour; ctx.stroke(path); };
  const disc = (cx, cy, r, colour) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill(); };
  stroke(new Path2D(arc(150, 270, G.NIGHT)), 8, c.night);
  const full = new Path2D(); full.arc(60, 60, G.RING, 0, Math.PI * 2);
  stroke(held ? full : new Path2D(arc(a + G.GAP, a - G.GAP, G.RING)), 5, c.ink);
  if (look === "kept") stroke(new Path2D("M42 62l12 12 24-27"), 6, c.ink);
  else { stroke(new Path2D(`M60 60L${hx} ${hy}`), 5, c.ink); disc(60, 60, 4, c.ink); }
  if (held) disc(dx, dy, G.DOT + 3, c.bg);
  disc(dx, dy, G.DOT, c.accent);
  ctx.restore();
}

// The remmynd mark and name, as on the site.
function mark(ctx, cx, y, c) {
  ctx.font = "600 44px Geist" + SANS;
  const name = "remmynd", tw = ctx.measureText(name).width, s = 56, gap = 16, x = cx - (s + gap + tw) / 2;
  ctx.save();
  ctx.translate(x, y - s / 2 - 14); ctx.scale(s / 24, s / 24);
  ctx.lineCap = "round"; ctx.lineWidth = 2.2; ctx.strokeStyle = c.ink;
  ctx.stroke(new Path2D("M19.947 7.775A9 9 0 1 1 14.781 3.44")); ctx.stroke(new Path2D("M12 12L15.214 8.17"));
  ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(12, 12, 1.43, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(17.785, 5.106, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = c.ink; ctx.textAlign = "left"; ctx.fillText(name, x + s + gap, y);
}

/** Draw the card and give back the PNG. */
// A blank card in the band colours, once the site's fonts are ready.
async function canvas() {
  try { await Promise.all([document.fonts.load('700 100px "Geist"'), document.fonts.load('500 34px "Geist Mono"')]); } catch (e) { /* the fallback fonts */ }
  await document.fonts.ready;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"), c = colours();
  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  return { cv, ctx, c };
}
const png = cv => new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error("no picture")), "image/png"));

export async function draw(ev, { timeZone, joiner = false, you = 0, lastCall = false } = {}) {
  const L = lines(ev, { timeZone, joiner, you, lastCall });
  const { cv, ctx, c } = await canvas(), cx = W / 2, width = W - 2 * 112;

  ring(ctx, cx - 160, 230, 320, hm(ev.start, timeZone), joiner ? "held" : "open", c);
  ctx.font = "500 34px 'Geist Mono', ui-monospace, monospace";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "6px";
  ctx.fillStyle = c.muted; ctx.fillText(L.kicker, cx, 640);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  let y = 640;
  if (L.top) { ctx.font = "600 72px Geist" + SANS; ctx.fillStyle = c.accent; y += 110; ctx.fillText(L.top, cx, y); }
  if (L.place) { ctx.font = "600 40px 'Geist Mono', ui-monospace, monospace"; ctx.fillStyle = c.muted; y += 56; ctx.fillText(L.place, cx, y); }
  // The title, as large as fits above the when and the line under it.
  const room = 1010 - y;
  let set = null;
  for (const [size, max] of [[112, 2], [96, 2], [84, 3], [72, 3], [64, 3], [56, 3], [52, 3]]) {
    ctx.font = "700 " + size + "px Geist" + SANS;
    const t = wrap(L.title, width, s => ctx.measureText(s).width);
    const lh = Math.round(size * 1.08);
    set = { size, lh, t: t.length > max ? wrap(L.title, width, s => ctx.measureText(s).width, max) : t };
    if (t.length <= max && size * 0.9 + lh * (t.length - 1) + 40 <= room) break;
  }
  ctx.font = "700 " + set.size + "px Geist" + SANS; ctx.fillStyle = c.ink;
  y += 40 + Math.round(set.size * 0.9);
  set.t.forEach((t, i) => ctx.fillText(t, cx, y + i * set.lh));
  y += set.lh * (set.t.length - 1);

  ctx.font = "500 50px Geist" + SANS; ctx.fillStyle = c.ink; y += 100; ctx.fillText(L.when, cx, y);
  ctx.font = "600 42px Geist" + SANS; ctx.fillStyle = c.accent; y += 76; ctx.fillText(L.cta, cx, y);
  mark(ctx, cx, 1236, c);
  // Below 1280 px: nothing. The stickers go there.
  return png(cv);
}

/** The year card's line, from this device's own list: "Kept 41 of 47 in 2026". No streaks. */
export const yearLine = ({ k, n, y }) => "Kept " + k + " of " + n + " in " + y;

/** The year card: the kept ring and the year's line. */
export async function drawYear(year) {
  const { cv, ctx, c } = await canvas(), cx = W / 2;
  ring(ctx, cx - 200, 300, 400, [12, 0], "kept", c);
  ctx.font = "700 112px Geist" + SANS; ctx.fillStyle = c.ink;
  // One line where it fits; otherwise "Kept 41 of 47" over "in 2026".
  const line = yearLine(year), t = ctx.measureText(line).width <= W - 2 * 112 ? [line] : [line.replace(/ in \d+$/, ""), "in " + year.y];
  t.forEach((x, i) => ctx.fillText(x, cx, 900 + i * 122));
  mark(ctx, cx, 1236, c);
  return png(cv);
}

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
let back = null, url = "";

function onKey(e) { if (e.key === "Escape") close(); }
function close() {
  const el = $("#st-sheet");
  if (!el) return;
  el.remove(); document.removeEventListener("keydown", onKey);
  if (url) { URL.revokeObjectURL(url); url = ""; }
  if (back && back.isConnected) back.focus();
}

// The sheet itself: a dialog that closes with Esc, ×, or a tap outside it.
function sheet(html, from) {
  if (!$('link[href="/story.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/story.css"; document.head.append(l); }
  close();
  back = from || document.activeElement;
  const el = document.createElement("div");
  el.className = "sheet"; el.id = "st-sheet";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "st-t");
  el.innerHTML = '<div class="sheet-card st-card"><button type="button" class="sheet-x" aria-label="Close">×</button>' + html + "</div>";
  document.body.append(el);
  document.addEventListener("keydown", onKey);
  el.addEventListener("click", e => { if (e.target === el || e.target.closest(".sheet-x")) close(); });
  el.querySelector(".sheet-x").focus();
  return el;
}

const goButton = share => '<button type="button" class="btn ink" data-k="go" disabled>' + (share ? "Share the card" : "Save picture") + "</button>";
const fileName = t => "remmynd-" + (String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "story") + ".png";

// The card's picture and its button: Share the card where the browser can share files, Save picture elsewhere.
async function picture(el, name, share, make, toast) {
  let file = null;
  const go = el.querySelector('[data-k="go"]');
  const save = () => { const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); };
  go.addEventListener("click", async () => {
    if (!file) return;
    if (share) {
      try { await navigator.share({ files: [file] }); } catch (err) { if (err && err.name !== "AbortError") save(); }
    } else save();
  });
  try {
    const blob = await make();
    if (!el.isConnected) return;
    file = new File([blob], name, { type: "image/png" });
    url = URL.createObjectURL(blob);
    const img = el.querySelector(".st-pic img");
    img.src = url; img.hidden = false;
    go.disabled = false;
  } catch (e) {
    if (el.isConnected && toast) toast("Couldn't open it here. Try again.");
  }
}

/**
 * The Story sheet. copied is the promise from copying the link inside the tap (true once it's on the
 * clipboard); copy(text, message) is the app's own, for the Copy link button when it wasn't.
 */
export async function open({ ev, link, timeZone, joiner = false, you = 0, lastCall = false, copied, copy, toast, from } = {}) {
  const L = lines(ev, { timeZone, joiner, you, lastCall }), name = fileName(L.title);
  const share = canShareFile(navigator, new File([""], name, { type: "image/png" }));
  const el = sheet('<h2 id="st-t">Card ready.</h2>' +
    '<div class="st-pic"><img alt="Your Story card: ' + esc(L.title) + ", " + esc(L.when) + '" width="1080" height="1920" hidden></div>' +
    '<ol class="st-steps"><li>1. In your Story, add the Link sticker and paste.</li><li>2. If you like, add the Countdown sticker and set it to ' + esc(L.when) + '.</li></ol>' +
    '<button type="button" class="btn" data-k="copy" hidden>Copy link</button>' + goButton(share) +
    '<p class="st-snap"><a class="btn" href="' + esc(snapURL(link)) + '" target="_blank" rel="noopener">Snapchat</a><span>In Snapchat, attach the link with the paperclip.<span class="st-copied" hidden> It is copied.</span></span></p>', from);

  // Say "The link is copied." only once it is.
  const said = ok => {
    if (!el.isConnected) return;
    el.querySelector("#st-t").textContent = ok ? "Card ready. The link is copied." : "Card ready.";
    el.querySelector(".st-copied").hidden = !ok;
    el.querySelector('[data-k="copy"]').hidden = !!ok;
  };
  Promise.resolve(copied).then(said, () => said(false));
  el.querySelector('[data-k="copy"]').addEventListener("click", () => copy(link, "Link copied", () => said(true)));
  await picture(el, name, share, () => draw(ev, { timeZone, joiner, you, lastCall }), toast);
}

/** Share your year: the kept line on Coming up opens this, with this device's own numbers for the year. */
export async function openYear({ k, n, y, toast, from } = {}) {
  const name = fileName("kept-" + y), share = canShareFile(navigator, new File([""], name, { type: "image/png" }));
  const el = sheet('<h2 id="st-t">Share your year</h2>' +
    '<div class="st-pic"><img alt="' + esc(yearLine({ k, n, y })) + '" width="1080" height="1920" hidden></div>' + goButton(share), from);
  await picture(el, name, share, () => drawYear({ k, n, y }), toast);
}
