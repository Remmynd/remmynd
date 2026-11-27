// Shared links and hand-written links.
//
// GET /r/<payload>  The app shell, with link-preview tags (title, time) for this reminder, so chat
//                   apps can show a card. The reminder is read from the address only to fill those
//                   tags. Nothing is stored or logged, and the response is never cached.
// GET /new?t=…&at=… A reminder written as query parameters. When the time is exact (tz given, or
//                   at carries Z or an offset) it redirects to the /r/ link. Otherwise it serves the
//                   shell and the page reads the time in the visitor's zone.
import { decode, fromQuery, toPath, describeWhen } from "../lib/remmynd.js";
import { ogImageURL, ogImageTags, inText } from "./ogimage.js";

const MAX_PAYLOAD = 2000;
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The reminder in a /r/ path, or null when it is missing, too long or not valid. */
export function readShared(pathname) {
  const p = pathname.slice(3).replace(/\/+$/, "");
  if (!p || p.length > MAX_PAYLOAD || !/^[A-Za-z0-9_-]+$/.test(p)) return null;
  return decode(p);
}

/** The preview tags for a reminder, every value escaped. `image` is its live picture (worker/og.js). */
export function previewTags(reminder, url, image) {
  const title = escapeHTML(reminder.title);
  const desc = escapeHTML(describeWhen(reminder.start, reminder.timeZone) + " · Tap to get reminded");
  return [
    `<title>${title} · remmynd</title>`,
    `<meta name="description" content="${desc}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${escapeHTML(url)}">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="robots" content="noindex">`,
    image ? ogImageTags(image, reminder.title + ", " + describeWhen(reminder.start, reminder.timeZone), escapeHTML) : ""
  ].filter(Boolean).join("\n");
}

// The tags previewTags() replaces. The rest of the head stays as it is.
const REPLACED = ["title", 'meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]',
  'meta[property="og:url"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]', 'link[rel="canonical"]',
  'meta[property="og:image"]', 'meta[property="og:image:width"]', 'meta[property="og:image:height"]', 'meta[property="og:image:alt"]',
  'meta[name="twitter:card"]', 'meta[name="twitter:image"]'];

/** The card for a reminder's live picture: what it is, when, and how long until it starts. */
export function reminderCard(r, now, count = 0) {
  const start = r.start.getTime(), end = start + (r.durationMinutes || 0) * 60000;
  const big = now >= end ? "Ended" : now >= start ? "Live now" : inText(start - now);
  return { theme: "light", eye: r.host ? "Reminder from " + r.host : "Reminder", title: r.title, line: describeWhen(r.start, r.timeZone),
    big, tone: now >= end ? "quiet" : now >= start ? "live" : "", stats: count >= 10 ? [{ n: count, label: "in" }] : [] };
}

async function shell(env, url) {
  return env.ASSETS.fetch(new Request(new URL("/", url)));
}

/** /share (the Android share sheet): the app itself; the page reads the shared text from its own address. */
export async function shareResponse(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  return noStore(await shell(env, url));
}

function noStore(res) {
  const out = new Response(res.body, res);
  out.headers.delete("ETag");
  out.headers.delete("Content-Length");
  for (const [k, v] of Object.entries(NO_STORE)) out.headers.set(k, v);
  return out;
}

export async function sharedResponse(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const page = await shell(env, url);
  const reminder = readShared(url.pathname);
  // A bad payload gets the plain shell; the page shows the maker.
  if (!reminder || !page.ok) return noStore(page);
  const path = url.pathname.replace(/\/+$/, "");
  const tags = previewTags(reminder, url.origin + url.pathname, ogImageURL(url.origin, path));
  let rewriter = new HTMLRewriter();
  for (const selector of REPLACED) rewriter = rewriter.on(selector, { element(el) { el.remove(); } });
  rewriter = rewriter.on("head", { element(el) { el.append(tags, { html: true }); } });
  return noStore(rewriter.transform(page));
}

export async function newResponse(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const q = url.searchParams, at = (q.get("at") || "").trim();
  if (q.get("tz") || /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(at)) {
    const event = fromQuery(q);
    if (event) return new Response(null, { status: 302, headers: { Location: url.origin + toPath(event), ...NO_STORE } });
  }
  return noStore(await shell(env, url));
}
