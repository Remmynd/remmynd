// Embeds: the reminder card any site can show in an iframe.
//
// GET /embed/<payload>  The card for a shared link: the moment ring, the title, the time and a
//                       Remind me button that opens the reminder on remmynd.space in a new tab.
// GET /embed/example    The example card For hosts shows: Demo day, next Friday at 5 PM.
//
// The card's first line is a countdown ("in 12 days", "1d 04:12:09", "Live now", "Ended"). The
// Worker writes its first value, so the card is right before its script runs; embed.js keeps it
// current. ?screen=1 is the layout for large screens, streams and the last slide of a talk: the
// ring, the title, the countdown in large type and a QR code of the link, with no button.
//
// Like /r/, the reminder is read from the address only to draw the card. Nothing is stored, logged
// or cached. ?theme=light or ?theme=dark pins a theme; without it the card follows the system.
// Private links (/#…) never reach a server, so they can't be embedded.
import { decode, describeWhen } from "../lib/remmynd.js";
import { ringSVG, ringLabel } from "../public/ring.js";
import { countdown } from "../public/clock.js";
import { qrSVG } from "../public/qr.js";
import { escapeHTML } from "./preview.js";

const MAX_PAYLOAD = 2000;
const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const MARK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.947 7.775A9 9 0 1 1 14.781 3.44" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12L15.214 8.17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.24" fill="currentColor"/></svg>';

// The card may sit in a frame on any site; its own scripts and styles come only from here.
export const EMBED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors *";
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex",
  "Content-Security-Policy": EMBED_CSP, "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin"
};

/** The hour and minute of a moment in a time zone. */
function clock(d, timeZone) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(d)) p[x.type] = x.value;
  return [Number(p.hour) % 24, Number(p.minute)];
}

/** Next Friday at 17:00 UTC: the example card's time before the page shows it in the visitor's zone. */
function nextFriday(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17));
  d.setUTCDate(d.getUTCDate() + ((12 - d.getUTCDay()) % 7 || 7));
  return d;
}

export function embedHTML(r, { link, origin, theme = "", example = false, now = Date.now(), screen = false }) {
  const zone = r.timeZone || "UTC", start = r.start.getTime(), end = start + r.durationMinutes * 60000;
  const state = now >= end ? "missed" : now >= start ? "now" : start - now <= 36e5 ? "soon" : "open";
  const [h, m] = clock(r.start, zone);
  const title = escapeHTML(r.title), href = escapeHTML(link), when = escapeHTML(describeWhen(r.start, zone));
  const left = '<b class="em-left">' + countdown(start, end, now) + "</b>", from = r.host ? '<span class="em-host"> · from ' + escapeHTML(r.host) + "</span>" : "";
  const head = '<!doctype html>\n<html lang="en"' + (theme ? ' data-theme="' + theme + '"' : "") + '>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="robots" content="noindex">\n<title>' + title + ' · remmynd</title>\n<link rel="stylesheet" href="/embed.css">\n</head>\n<body' + (screen ? ' class="screen"' : "") + '>\n' +
    '<main class="em' + (screen ? " em-screen" : "") + '" data-start="' + start + '" data-end="' + end + '"' + (example ? " data-example" : "") + '>\n';
  const tail = '<script type="module" src="/embed.js"></script>\n</body>\n</html>\n';
  if (screen) {
    // For a big screen: nothing to tap, so the link is a QR code instead of a button.
    return head + '<div class="es-main">' + ringSVG({ h, m, state, size: 160, label: ringLabel(h, m, state) }) +
      '<span class="em-label">Reminder' + (r.host ? " · from " + escapeHTML(r.host) : "") + '</span><h1 class="em-title">' + title + "</h1>" +
      '<p class="em-left">' + countdown(start, end, now) + '</p><p class="em-when">' + when + "</p></div>\n" +
      '<figure class="es-qr">' + qrSVG(link, { label: "QR code that opens the reminder for " + r.title }) + "<figcaption>Scan to get reminded</figcaption></figure>\n" +
      '<span class="em-by">' + MARK + "remmynd</span>\n</main>\n" + tail;
  }
  return head +
    '<a class="em-main" href="' + href + '" target="_blank" rel="noopener">' + ringSVG({ h, m, state, size: 52, label: ringLabel(h, m, state) }) +
    '<span class="em-text"><span class="em-label">' + left + from + '</span><b class="em-title">' + title + '</b><span class="em-when">' + when + '</span></span></a>\n' +
    '<a class="em-btn" href="' + href + '" target="_blank" rel="noopener" aria-label="Remind me about ' + title + '">' + BELL + 'Remind me</a>\n' +
    '<a class="em-by" href="' + escapeHTML(origin) + '/" target="_blank" rel="noopener">' + MARK + 'remmynd</a>\n</main>\n' + tail;
}

export async function embedResponse(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const p = url.pathname.slice("/embed/".length).replace(/\/+$/, "");
  const t = url.searchParams.get("theme"), theme = t === "light" || t === "dark" ? t : "", screen = url.searchParams.get("screen") === "1";
  let r, link, example = false;
  if (p === "example") {
    example = true; link = url.origin + "/example";
    r = { title: "Demo day", start: nextFriday(), durationMinutes: 60, host: "", timeZone: "" };
  } else {
    r = p && p.length <= MAX_PAYLOAD && /^[A-Za-z0-9_-]+$/.test(p) ? decode(p) : null;
    link = url.origin + "/r/" + p;
  }
  if (!r) return new Response("Not a remmynd reminder", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  return new Response(request.method === "HEAD" ? null : embedHTML(r, { link, origin: url.origin, theme, example, screen }), { headers: HEADERS });
}
