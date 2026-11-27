// GET /og/<page>.png  The live link-preview picture for a shared page (drawn by worker/ogimage.js):
//   /og/r/<payload>.png        a reminder link        /og/x/<code>.png     a challenge
//   /og/@<handle>.png          a host's page          /og/d/<id>.png       a drop (never what's inside)
//   /og/@<handle>/<slug>.png   a launch               /og/dare/<code>.png  a dare
// Pages add ?v=<five-minute mark>, so each newly sent link gets a fresh picture; a picture is kept
// (here and by apps) for five minutes. Anything unknown is sent to the plain /og.png, so a preview
// always has a picture. Like the pages, nothing is stored or logged about who asked.
import { cardPNG } from "./ogimage.js";
import { decode } from "../lib/remmynd.js";
import { reminderCard } from "./preview.js";
import { readCount } from "./count.js";
import { hostCard } from "./hosts.js";
import { challengeCard } from "./challenges.js";
import { dropCard, dareCard } from "./drops.js";

const KEEP = "public, max-age=300";

/** The card for a picture's path (without /og and .png), or null. */
export async function cardFor(env, path, deps = {}) {
  const now = deps.now || Date.now();
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "r" && parts.length === 2 && parts[1].length <= 2000 && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
    const r = decode(parts[1]);
    if (!r) return null;
    const count = r.count ? await readCount(env, parts[1], { now, store: deps.counts }).catch(() => 0) : 0;
    return reminderCard(r, now, count);
  }
  if (parts[0] && parts[0].startsWith("@") && parts.length <= 2) return hostCard(env, parts[0].slice(1).toLowerCase(), parts[1] || "", deps);
  if (parts.length !== 2) return null;
  if (parts[0] === "x") return challengeCard(env, parts[1], deps);
  if (parts[0] === "d") return dropCard(env, parts[1], deps);
  if (parts[0] === "dare") return dareCard(env, parts[1], deps);
  return null;
}

export async function ogResponse(request, env, url, ctx, deps = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const m = /^\/og(\/.+)\.png$/.exec(decodeURIComponent(url.pathname));
  const plain = () => Response.redirect(url.origin + "/og.png", 302);
  if (!m) return plain();
  const cache = deps.cache === undefined ? globalThis.caches?.default : deps.cache;
  const key = new Request(url.toString(), { method: "GET" });
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return request.method === "HEAD" ? new Response(null, hit) : hit;
  let card = null;
  try { card = await cardFor(env, m[1], deps); } catch { card = null; }
  if (!card) return plain();
  const res = new Response(await cardPNG(card), {
    headers: { "Content-Type": "image/png", "Cache-Control": KEEP, "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
      "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*" }
  });
  if (cache) { const put = cache.put(key, res.clone()).catch(() => {}); ctx && ctx.waitUntil ? ctx.waitUntil(put) : await put; }
  return request.method === "HEAD" ? new Response(null, res) : res;
}
