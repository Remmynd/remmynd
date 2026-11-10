// GET /stats: the public numbers on the For hosts page, as {"stars": n, "downloads": n}.
//
// The page never asks GitHub or npm itself (no requests to other hosts, spec section 3): this
// Worker asks their public addresses, sends nothing about the visitor, and keeps the answer in
// Cloudflare's cache for an hour. A number that can't be fetched is null, and its tile stays hidden.
const SOURCES = {
  stars: ["https://api.github.com/repos/Remmynd/remmynd", j => j.stargazers_count],
  downloads: ["https://api.npmjs.org/downloads/point/last-week/remmynd", j => j.downloads],
};
const HOUR = 3600, RETRY = 300;
const CACHE_KEY = "https://remmynd.space/stats";

async function one(fetcher, [url, pick]) {
  try {
    const res = await fetcher(url, { headers: { "User-Agent": "remmynd.space", Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const n = pick(await res.json());
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}

/** The numbers, fetched now. */
export async function fetchStats(fetcher = fetch) {
  const keys = Object.keys(SOURCES);
  const values = await Promise.all(keys.map(k => one(fetcher, SOURCES[k])));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

export async function statsResponse(request, env, ctx, fetcher = fetch) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const cache = globalThis.caches && caches.default;
  if (cache) { const hit = await cache.match(CACHE_KEY); if (hit) return hit; }
  const stats = await fetchStats(fetcher);
  // A full answer is kept for an hour; one with a gap is tried again after five minutes.
  const age = Object.values(stats).every(v => v !== null) ? HOUR : RETRY;
  const res = new Response(JSON.stringify(stats), { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=" + age,
  } });
  if (cache) { const put = cache.put(CACHE_KEY, res.clone()); if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put; }
  return res;
}
