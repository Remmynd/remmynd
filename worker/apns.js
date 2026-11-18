// Apple push, for the iPhone app: a crew member checking in, a kudos, signed with the account's APNs key (a JWT made
// here with WebCrypto, no libraries). A phone registers its device token against the signed-in account; nothing else
// about the phone is kept. A push says only who in the crew did what ("Lee is on the way"): never which reminder.
//
//   POST /api/push/apple { token, env }   this phone's device token ("sandbox" for test builds, else production)
//   POST /api/push/apple/off { token }    forget it (signing out)
//
// Secrets: APNS_KEY (the .p8 file's contents), APNS_KEY_ID, APNS_TEAM. Without them nothing is sent.

import { signedIn, d1Store } from "./account.js";

export const TOPIC = "space.remmynd.app";
const TOKEN = /^[a-f0-9]{64,200}$/i;
export const APNS_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS apns_devices (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, env TEXT NOT NULL, created INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS apns_devices_user ON apns_devices (user_id)",
];

let ready = null;
export function apnsStore(db) {
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const st = (sql, ...a) => db.prepare(sql).bind(...a);
  return {
    ready: () => (ready ||= db.batch(APNS_SCHEMA.map(s => db.prepare(s))).catch(e => { ready = null; throw e; })),
    put: d => st("INSERT INTO apns_devices (token, user_id, env, created) VALUES (?, ?, ?, ?) ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, env = excluded.env", d.token, d.user_id, d.env, d.created).run(),
    drop: token => st("DELETE FROM apns_devices WHERE token = ?", token).run(),
    of: users => users.length ? all("SELECT token, user_id, env FROM apns_devices WHERE user_id IN (" + users.map(() => "?").join(",") + ")", ...users) : [],
    deleteUser: user => st("DELETE FROM apns_devices WHERE user_id = ?", user).run(),
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = new TextEncoder();

/** The .p8 key, as a signing key. */
async function importKey(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

let cached = { jwt: "", at: 0, kid: "" };
/** The provider token Apple wants: an ES256 JWT, reused for up to 50 minutes (Apple allows one an hour). */
export async function providerToken(env, now = Date.now()) {
  if (cached.jwt && cached.kid === env.APNS_KEY_ID && now - cached.at < 50 * 60e3) return cached.jwt;
  const head = b64u(enc.encode(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID })));
  const claims = b64u(enc.encode(JSON.stringify({ iss: env.APNS_TEAM, iat: Math.floor(now / 1000) })));
  const key = await importKey(env.APNS_KEY);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims));
  cached = { jwt: head + "." + claims + "." + b64u(sig), at: now, kid: env.APNS_KEY_ID };
  return cached.jwt;
}
export const configured = env => !!(env && env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM);

/** One push to one phone. Answers Apple's status (0 when it couldn't be reached). */
export async function sendApple(env, device, payload, { type = "alert", topic = TOPIC, priority = 10, collapse } = {}, deps = {}) {
  const host = device.env === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const headers = { authorization: "bearer " + await providerToken(env), "apns-topic": topic, "apns-push-type": type, "apns-priority": String(priority), "content-type": "application/json" };
  if (collapse) headers["apns-collapse-id"] = collapse.slice(0, 64);
  try {
    const res = await (deps.fetch || fetch)(host + "/3/device/" + device.token, { method: "POST", headers, body: JSON.stringify(payload) });
    return res.status;
  } catch { return 0; }
}

/** An alert to every phone of these accounts. Tokens Apple says are gone are forgotten. */
export async function tellAccounts(env, users, alert, data = {}, deps = {}) {
  if (!configured(env) || !users.length || (!env.DB && !deps.store)) return 0;
  const store = deps.store || apnsStore(env.DB);
  await store.ready();
  let sent = 0;
  for (const d of await store.of(users)) {
    const status = await sendApple(env, d, { aps: { alert, sound: "default", "thread-id": data.crew || "remmynd" }, ...data }, { collapse: data.collapse }, deps);
    if (status === 200) sent++;
    if (status === 410 || status === 400) await store.drop(d.token);
  }
  return sent;
}

export async function handleApple(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Push isn't set up on this server." }, 503);
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const now = deps.now || Date.now();
  const s = await signedIn(request, deps.accounts || d1Store(env.DB), now);
  if (!s) return json({ error: "Sign in first.", need: "signin" }, 401);
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 2048)) || {}; } catch {}
  const token = String(body.token || "");
  if (!TOKEN.test(token)) return json({ error: "That isn't a device token." }, 400);
  const store = deps.store || apnsStore(env.DB);
  await store.ready();
  if (url.pathname.replace(/\/+$/, "").endsWith("/off")) { await store.drop(token); return json({ ok: true }); }
  await store.put({ token: token.toLowerCase(), user_id: s.user.id, env: body.env === "sandbox" ? "sandbox" : "production", created: now });
  return json({ ok: true, sending: configured(env) });
}
