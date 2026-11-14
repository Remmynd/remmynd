// The public count (ADDENDUM-1, slice 5): how many people tapped Remind me on one reminder, only
// when its host switched the count on (`c: 1` in the link). One number per reminder. No names, no
// addresses, no device ids, no cookies. A row is deleted 30 days after the reminder ends.
//
// GET  /count/<payload>  {"n": 128}. 404 unless the payload is a reminder with the count on.
// POST /count/<payload>  Adds one: {"n": 129, "you": 129}. Only from this site's own pages. Refused
//                        after the reminder ends (410), beyond 600 joins a minute for one reminder,
//                        and beyond 20 a minute from one network (429). The network limit is
//                        Cloudflare's rate limiter, keyed in passing; remmynd stores no address.
// Both are never cached.
import { decode } from "../lib/remmynd.js";

const MAX_PAYLOAD = 2000;
export const PER_MINUTE = 600;
export const KEEP_MS = 30 * 864e5;
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...extra } });

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, ends INTEGER NOT NULL, win INTEGER NOT NULL, win_n INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS counts_ends ON counts (ends)"
];

/** SHA-256 of the link's payload, in hex: the only key a count has. */
export async function countKey(payload) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- storage: D1 in production, an in-memory stand-in in the tests ---------- */
let schemaReady = null;
export function d1Counts(db) {
  return {
    ready: () => (schemaReady ||= db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { schemaReady = null; throw e; })),
    get: async key => { const r = await db.prepare("SELECT n FROM counts WHERE key = ?").bind(key).first(); return r ? r.n : 0; },
    // One statement, so two taps at once can't both slip past the minute's cap. No row back: capped.
    join: async (key, ends, minute, cap) => {
      const r = await db.prepare(
        "INSERT INTO counts (key, n, ends, win, win_n) VALUES (?, 1, ?, ?, 1) " +
        "ON CONFLICT(key) DO UPDATE SET n = n + 1, win_n = CASE WHEN win = ? THEN win_n + 1 ELSE 1 END, win = ? " +
        "WHERE win <> ? OR win_n < ? RETURNING n").bind(key, ends, minute, minute, minute, minute, cap).first();
      return r ? r.n : null;
    },
    clean: before => db.prepare("DELETE FROM counts WHERE ends < ?").bind(before).run()
  };
}

// The badge and the card read a count at most once a minute per reminder (per Worker instance).
const seen = new Map();
export async function readCount(env, payload, { now = Date.now(), store } = {}) {
  const s = store || (env && env.DB ? d1Counts(env.DB) : null);
  if (!s) return 0;
  const hit = seen.get(payload);
  if (hit && now - hit.at < 60e3) return hit.n;
  let n = 0;
  try { await s.ready(); n = await s.get(await countKey(payload)); } catch (e) { return hit ? hit.n : 0; }
  if (seen.size > 5000) seen.clear();
  seen.set(payload, { n, at: now });
  return n;
}

export async function handleCount(request, env, url, { store, now = Date.now(), limiter } = {}) {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, HEAD, POST" });
  const m = /^\/count\/([A-Za-z0-9_-]{1,2000})$/.exec(url.pathname);
  const payload = m && m[1].length <= MAX_PAYLOAD ? m[1] : "";
  const r = payload ? decode(payload) : null;
  if (!r || !r.count) return json({ error: "No count for this link." }, 404);
  const s = store || (env.DB ? d1Counts(env.DB) : null);
  if (!s) return json({ error: "Counts aren't set up on this server." }, 503);
  await s.ready();
  const key = await countKey(payload);
  if (method !== "POST") return json({ n: await s.get(key) });

  // Only this site's own pages add to a count.
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const ends = r.start.getTime() + (r.durationMinutes || 60) * 60000;
  if (now >= ends) return json({ error: "This reminder has ended." }, 410);
  const lim = limiter || env.COUNT_LIMIT;
  if (lim) {
    const ip = request.headers.get("cf-connecting-ip") || "";
    try { const { success } = await lim.limit({ key: ip + "|" + key }); if (!success) return json({ error: "Too many at once. Try again in a minute." }, 429); } catch (e) { /* the limiter is down: the minute cap still holds */ }
  }
  const n = await s.join(key, ends, Math.floor(now / 60000), PER_MINUTE);
  if (n == null) return json({ error: "Too many at once. Try again in a minute." }, 429);
  return json({ n, you: n });
}

/** The cron: forget each count 30 days after its reminder ended. */
export async function cleanCounts(env, { store, now = Date.now() } = {}) {
  const s = store || (env.DB ? d1Counts(env.DB) : null);
  if (!s) return;
  try { await s.ready(); await s.clean(now - KEEP_MS); } catch (e) { /* next hour */ }
}
