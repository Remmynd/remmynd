// Push notifications, the private way.
//
// The phone keeps the reminder (title, time, link) in its own storage. This server only
// stores: a random id, the browser's push address, and when to ping it. At that time it
// sends an EMPTY push (no payload), the phone wakes up, looks up what's due in its own
// storage and shows the notification. Rows are deleted as soon as they're sent.

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                     // Chrome, Edge on Android, Samsung Internet
  /^updates\.push\.services\.mozilla\.com$/,    // Firefox
  /^([a-z0-9-]+\.)*push\.apple\.com$/,          // Safari and iPhone Home Screen apps
  /^([a-z0-9-]+\.)*notify\.windows\.com$/       // Edge on Windows
];
const ID = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_PINGS_PER_REQUEST = 8;
const MAX_ROWS_PER_ENDPOINT = 200;
const MAX_AHEAD_MS = 400 * 864e5;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});

export function validEndpoint(s) {
  if (typeof s !== "string" || s.length > 1024) return false;
  let u; try { u = new URL(s); } catch { return false; }
  return u.protocol === "https:" && !u.username && !u.password && PUSH_HOSTS.some(re => re.test(u.hostname));
}

async function readJSON(request) {
  const len = +(request.headers.get("content-length") || 0);
  if (len > 8192) return null;
  const text = await request.text();
  if (text.length > 8192) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function handlePush(request, env, url) {
  if (url.pathname === "/push/key") {
    if (!env.VAPID_PUBLIC_KEY || !env.DB) return json({ error: "Notifications aren't set up on this server yet." }, 503);
    return json({ key: env.VAPID_PUBLIC_KEY });
  }
  if (!env.DB || !env.VAPID_PUBLIC_KEY) return json({ error: "Notifications aren't set up on this server yet." }, 503);
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const body = await readJSON(request);
  if (!body || !validEndpoint(body.endpoint)) return json({ error: "That isn't a valid push address." }, 400);

  if (url.pathname === "/push/schedule") {
    const pings = Array.isArray(body.pings) ? body.pings : [];
    const now = Date.now();
    if (!pings.length || pings.length > MAX_PINGS_PER_REQUEST) return json({ error: "Send between 1 and 8 pings." }, 400);
    for (const p of pings) {
      if (!p || !ID.test(p.id) || !Number.isFinite(p.at) || p.at < now - 60e3 || p.at > now + MAX_AHEAD_MS) {
        return json({ error: "A ping has a bad id or time." }, 400);
      }
    }
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM pings WHERE endpoint = ?").bind(body.endpoint).first();
    if ((count?.n || 0) + pings.length > MAX_ROWS_PER_ENDPOINT) return json({ error: "Too many reminders on this device." }, 429);
    const stmt = env.DB.prepare("INSERT OR REPLACE INTO pings (id, endpoint, at, created) VALUES (?, ?, ?, ?)");
    await env.DB.batch(pings.map(p => stmt.bind(p.id, body.endpoint, Math.round(p.at), now)));
    return json({ ok: true, scheduled: pings.length });
  }

  if (url.pathname === "/push/cancel") {
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter(id => ID.test(id)).slice(0, 50);
    if (!ids.length) return json({ ok: true, cancelled: 0 });
    const stmt = env.DB.prepare("DELETE FROM pings WHERE id = ? AND endpoint = ?");
    await env.DB.batch(ids.map(id => stmt.bind(id, body.endpoint)));
    return json({ ok: true, cancelled: ids.length });
  }

  return json({ error: "Not found." }, 404);
}

/* ---------- sending ---------- */
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = s => b64url(new TextEncoder().encode(s));

export async function vapidAuthorization(endpoint, env, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64urlText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64urlText(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:connect@zoof04.com" }));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(header + "." + claims));
  return "vapid t=" + header + "." + claims + "." + b64url(sig) + ", k=" + env.VAPID_PUBLIC_KEY;
}

async function sendEmptyPush(endpoint, env) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: await vapidAuthorization(endpoint, env), TTL: "3600", Urgency: "high", "Content-Length": "0" }
  });
  return res.status;
}

/** Runs every minute from the cron trigger. */
export async function sendDuePings(env, now = Date.now(), send = sendEmptyPush) {
  if (!env.DB || !env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return { sent: 0 };
  const { results = [] } = await env.DB.prepare("SELECT id, endpoint, at FROM pings WHERE at <= ? ORDER BY at LIMIT 500").bind(now + 30e3).all();
  const byEndpoint = new Map();
  for (const r of results) { if (!byEndpoint.has(r.endpoint)) byEndpoint.set(r.endpoint, []); byEndpoint.get(r.endpoint).push(r); }
  const done = [];
  let sent = 0;
  for (const [endpoint, rows] of byEndpoint) {
    let status = 0;
    try { status = await send(endpoint, env); } catch { status = 0; }
    const ok = status >= 200 && status < 300;
    const gone = status === 404 || status === 410 || status === 400 || status === 403;
    const tooOld = rows.every(r => r.at < now - 3600e3);
    if (ok) sent++;
    if (ok || gone || tooOld) done.push(...rows.map(r => r.id));
    if (gone) await env.DB.prepare("DELETE FROM pings WHERE endpoint = ?").bind(endpoint).run();
  }
  if (done.length) {
    const stmt = env.DB.prepare("DELETE FROM pings WHERE id = ?");
    for (let i = 0; i < done.length; i += 50) await env.DB.batch(done.slice(i, i + 50).map(id => stmt.bind(id)));
  }
  await env.DB.prepare("DELETE FROM pings WHERE at < ?").bind(now - 864e5).run();
  return { sent, cleared: done.length };
}
