// Optional sign-in: passkeys, or a 6-digit code by email; sync across devices; email reminders.
//
// No account is needed to use remmynd. Signing in keeps the person's email address and their
// reminders and links on this server, so they sync across devices and can be emailed. Private
// links (/#…) are never synced: they stay on the device. Everything is deleted with the account.
//
// Routes (JSON, never cached):
//   GET  /api/me                     who is signed in
//   POST /api/auth/email/start       send a 6-digit code        { email }
//   POST /api/auth/email/verify      sign in with the code      { email, code }
//   POST /api/auth/passkey/options   start a passkey sign-in
//   POST /api/auth/passkey/verify    finish a passkey sign-in
//   POST /api/passkeys/options       start adding a passkey (signed in)
//   POST /api/passkeys/add           finish adding a passkey
//   POST /api/passkeys/delete        remove a passkey           { id }
//   POST /api/auth/signout
//   POST /api/account/settings       { emailAlerts }
//   POST /api/account/delete         the account and everything in it
//   POST /api/sync                   { since, items: [{ kind, key, data, updated, deleted }] }
//   GET|POST /api/mail/stop?u=&t=    one-click "stop email reminders"
import { describeWhen } from "../lib/remmynd.js";
import { b64url, randomId, verifyRegistration, verifyAssertion, ALGS } from "./webauthn.js";

const DAY = 864e5;
const SESSION_MS = 180 * DAY;
const CODE_MS = 10 * 60e3;
const MAX_ITEMS = 2000;
const MAX_DATA = 4096;
const SENDS_PER_HOUR = 300;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const enc = new TextEncoder();
const hash = async s => b64url(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, email_alerts INTEGER NOT NULL DEFAULT 1, stop_token TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, name TEXT, created INTEGER NOT NULL, last_used INTEGER)",
  "CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys (user_id)",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)",
  "CREATE TABLE IF NOT EXISTS codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL, sends INTEGER NOT NULL DEFAULT 1, window_start INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id TEXT, kind TEXT NOT NULL, expires INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS items (user_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, kind, key))",
  "CREATE INDEX IF NOT EXISTS items_updated ON items (user_id, updated)",
  "CREATE TABLE IF NOT EXISTS mails (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS mails_at ON mails (at)",
  "CREATE INDEX IF NOT EXISTS mails_user_key ON mails (user_id, key)",
  "CREATE TABLE IF NOT EXISTS sends (hour INTEGER PRIMARY KEY, n INTEGER NOT NULL)",
];

/* ---------- storage: D1 in production, an in-memory stand-in in the tests ---------- */
let schemaReady = null;
export function d1Store(db) {
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const st = (sql, ...a) => db.prepare(sql).bind(...a);
  return {
    ready: () => (schemaReady ||= db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { schemaReady = null; throw e; })),
    userByEmail: e => one("SELECT * FROM users WHERE email = ?", e),
    userById: id => one("SELECT * FROM users WHERE id = ?", id),
    createUser: u => run("INSERT INTO users (id, email, created, email_alerts, stop_token) VALUES (?, ?, ?, 1, ?)", u.id, u.email, u.created, u.stop_token),
    setEmailAlerts: (id, on) => run("UPDATE users SET email_alerts = ? WHERE id = ?", on ? 1 : 0, id),
    stopEmails: (id, token) => run("UPDATE users SET email_alerts = 0 WHERE id = ? AND stop_token = ?", id, token),
    deleteUser: id => db.batch([...["passkeys", "sessions", "items", "mails"].map(t => st("DELETE FROM " + t + " WHERE user_id = ?", id)), st("DELETE FROM users WHERE id = ?", id)]),
    passkeysOf: id => all("SELECT id, name, created, last_used FROM passkeys WHERE user_id = ? ORDER BY created", id),
    passkey: id => one("SELECT * FROM passkeys WHERE id = ?", id),
    addPasskey: p => run("INSERT INTO passkeys (id, user_id, public_key, alg, sign_count, name, created) VALUES (?, ?, ?, ?, 0, ?, ?)", p.id, p.userId, p.publicKey, p.alg, p.name, p.created),
    usePasskey: (id, count, now) => run("UPDATE passkeys SET sign_count = ?, last_used = ? WHERE id = ?", count, now, id),
    deletePasskey: (userId, id) => run("DELETE FROM passkeys WHERE id = ? AND user_id = ?", id, userId),
    createSession: s => run("INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)", s.hash, s.userId, s.created, s.expires),
    session: h => one("SELECT * FROM sessions WHERE token_hash = ?", h),
    extendSession: (h, expires) => run("UPDATE sessions SET expires = ? WHERE token_hash = ?", expires, h),
    deleteSession: h => run("DELETE FROM sessions WHERE token_hash = ?", h),
    code: email => one("SELECT * FROM codes WHERE email = ?", email),
    putCode: c => run("INSERT OR REPLACE INTO codes (email, code_hash, expires, tries, sent, sends, window_start) VALUES (?, ?, ?, 0, ?, ?, ?)", c.email, c.code_hash, c.expires, c.sent, c.sends, c.window_start),
    tryCode: email => run("UPDATE codes SET tries = tries + 1 WHERE email = ?", email),
    deleteCode: email => run("DELETE FROM codes WHERE email = ?", email),
    countSend: async hour => { await run("INSERT INTO sends (hour, n) VALUES (?, 1) ON CONFLICT(hour) DO UPDATE SET n = n + 1", hour); return (await one("SELECT n FROM sends WHERE hour = ?", hour))?.n || 0; },
    putChallenge: c => run("INSERT INTO challenges (id, challenge, user_id, kind, expires) VALUES (?, ?, ?, ?, ?)", c.id, c.challenge, c.userId || null, c.kind, c.expires),
    takeChallenge: async id => { const c = await one("SELECT * FROM challenges WHERE id = ?", id); if (c) await run("DELETE FROM challenges WHERE id = ?", id); return c; },
    items: (userId, since) => all("SELECT kind, key, data, updated, deleted FROM items WHERE user_id = ? AND updated > ? ORDER BY updated LIMIT 2000", userId, since),
    itemUpdated: async (userId, kind, key) => (await one("SELECT updated FROM items WHERE user_id = ? AND kind = ? AND key = ?", userId, kind, key))?.updated || 0,
    countItems: async userId => (await one("SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND deleted = 0", userId))?.n || 0,
    putItems: (userId, list) => list.length ? db.batch(list.map(x => st("INSERT INTO items (user_id, kind, key, data, updated, deleted) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, kind, key) DO UPDATE SET data = excluded.data, updated = excluded.updated, deleted = excluded.deleted WHERE excluded.updated >= items.updated", userId, x.kind, x.key, x.data, x.updated, x.deleted ? 1 : 0))) : null,
    reminders: userId => all("SELECT key, data FROM items WHERE user_id = ? AND kind = 'reminder' AND deleted = 0", userId),
    setMails: (userId, key, list) => db.batch([st("DELETE FROM mails WHERE user_id = ? AND key = ?", userId, key), ...list.map(m => st("INSERT INTO mails (id, user_id, key, at, kind) VALUES (?, ?, ?, ?, ?)", m.id, userId, key, m.at, m.kind))]),
    clearMails: userId => run("DELETE FROM mails WHERE user_id = ?", userId),
    dueMails: now => all("SELECT m.id, m.kind, m.at, i.data, u.email, u.email_alerts, u.id AS user_id, u.stop_token FROM mails m JOIN users u ON u.id = m.user_id LEFT JOIN items i ON i.user_id = m.user_id AND i.kind = 'reminder' AND i.key = m.key AND i.deleted = 0 WHERE m.at <= ? ORDER BY m.at LIMIT 100", now),
    deleteMail: id => run("DELETE FROM mails WHERE id = ?", id),
    cleanup: now => db.batch([st("DELETE FROM sessions WHERE expires < ?", now), st("DELETE FROM codes WHERE expires < ? AND window_start < ?", now, now - 3600e3), st("DELETE FROM challenges WHERE expires < ?", now),
      st("DELETE FROM mails WHERE at < ?", now - DAY), st("DELETE FROM sends WHERE hour < ?", Math.floor(now / 3600e3) - 48), st("DELETE FROM items WHERE deleted = 1 AND updated < ?", now - 90 * DAY)]),
  };
}

/* ---------- email through Resend ---------- */
const FROM = env => env.MAIL_FROM || "remmynd <reminders@remmynd.space>";
export function resendMailer(env, fetcher = fetch) {
  return async msg => {
    const res = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(env), to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers || {} }),
    });
    return res.status;
  };
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const page = (title, body) => '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title>' +
  '<body style="font-family:system-ui,sans-serif;background:#F5F6F7;color:#0E0F11;margin:0;padding:32px 16px"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:22px;padding:28px">' + body +
  '<p style="color:#666C75;font-size:13px;margin:24px 0 0">remmynd by Zoof04 Inc. Free, no tracking.</p></div></body></html>';
const button = (href, label) => '<p style="margin:20px 0"><a href="' + esc(href) + '" style="display:inline-block;background:#F2A000;color:#0E0F11;font-weight:600;text-decoration:none;padding:14px 22px;border-radius:16px">' + esc(label) + '</a></p>';

export function codeMail(code) {
  const spaced = code.slice(0, 3) + " " + code.slice(3);
  return {
    subject: "Your remmynd code: " + code,
    text: "Enter " + spaced + " to sign in to remmynd. It works for 10 minutes.\n\nIf you didn't ask for it, ignore this email: nothing happens.\n\nremmynd by Zoof04 Inc.",
    html: page("Your remmynd code", '<h1 style="font-size:22px;margin:0 0 12px">Your sign-in code</h1><p style="font-size:34px;font-weight:700;letter-spacing:.12em;margin:12px 0">' + spaced +
      '</p><p style="margin:0">It works for 10 minutes.</p><p style="color:#666C75">If you didn\'t ask for it, ignore this email: nothing happens.</p>'),
  };
}

/** A reminder email. Links only ever point at this site. */
export function reminderMail(d, kind, stopUrl, origin) {
  const when = describeWhen(new Date(d.start), d.tz || "UTC");
  const lead = kind === "before" ? "In 1 hour: " : kind === "back" ? "Back now: " : "Starting now: ";
  let link = "";
  try { const u = new URL(d.share); if (u.origin === origin) link = u.href; } catch {}
  const place = typeof d.place === "string" && /^https?:\/\//i.test(d.place) ? "" : (d.place || "");
  const plan = typeof d.plan === "string" ? d.plan.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return {
    subject: lead + d.title,
    text: [lead + d.title, when, place, plan ? "Your plan: " + plan : "", "", link ? "Open it: " + link : "", "", "Stop email reminders: " + stopUrl, "remmynd by Zoof04 Inc."].filter((l, i, a) => l || a[i - 1]).join("\n"),
    html: page(lead + d.title, '<p style="color:#666C75;margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase">' + esc(lead.replace(": ", "")) + '</p><h1 style="font-size:24px;margin:0 0 8px">' + esc(d.title) + '</h1><p style="margin:0">' + esc(when) + '</p>' +
      (place ? '<p style="margin:6px 0 0;color:#4A4F57">' + esc(place) + '</p>' : '') +
      (plan ? '<p style="margin:14px 0 0;padding:12px 14px;border-radius:12px;background:#F5F6F7"><span style="display:block;color:#666C75;font-size:12px;letter-spacing:.06em;text-transform:uppercase">Your plan</span>' + esc(plan) + '</p>' : '') + (link ? button(link, "Open the reminder") : '') +
      '<p style="color:#666C75;font-size:13px"><a href="' + esc(stopUrl) + '" style="color:#666C75">Stop email reminders</a></p>'),
    headers: { "List-Unsubscribe": "<" + stopUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

/** The emails a held reminder should get: 1 hour before and at the start, or once at its new time. */
export function mailsFor(d, now) {
  if (!d || d.state !== "held" || !Number.isFinite(d.start)) return [];
  if (d.replanAt > now) return [{ kind: "back", at: d.replanAt }];
  return [{ kind: "before", at: d.start - 3600e3 }, { kind: "start", at: d.start }].filter(m => m.at > now);
}

/* ---------- requests ---------- */
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const cookie = (url, token, maxAge) => "rm_s=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (url.protocol === "https:" ? "; Secure" : "");
async function readJSON(request, limit = 16384) {
  if (+(request.headers.get("content-length") || 0) > limit) return null;
  const text = await request.text();
  if (text.length > limit) return null;
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch { return null; }
}
const sixDigits = () => { const a = new Uint32Array(1); do crypto.getRandomValues(a); while (a[0] >= 4294000000); return String(a[0] % 1e6).padStart(6, "0"); };
const cleanEmail = e => typeof e === "string" && e.length <= 254 && EMAIL.test(e.trim()) ? e.trim().toLowerCase() : null;

async function signedIn(request, store, now) {
  const m = /(?:^|;\s*)rm_s=([A-Za-z0-9_-]{20,100})/.exec(request.headers.get("cookie") || "");
  if (!m) return null;
  const h = await hash(m[1]), s = await store.session(h);
  if (!s || s.expires < now) return null;
  if (s.expires - now < SESSION_MS - 7 * DAY) await store.extendSession(h, now + SESSION_MS);
  const user = await store.userById(s.user_id);
  return user ? { user, hash: h, token: m[1] } : null;
}

async function startSession(store, userId, url, now) {
  const token = randomId(32);
  await store.createSession({ hash: await hash(token), userId, created: now, expires: now + SESSION_MS });
  return cookie(url, token, SESSION_MS / 1000);
}

async function me(store, user) {
  const keys = await store.passkeysOf(user.id);
  return { signedIn: true, email: user.email, emailAlerts: !!user.email_alerts, passkeys: keys.map(k => ({ id: k.id, name: k.name || "Passkey", created: k.created, lastUsed: k.last_used || null })) };
}

async function scheduleMails(store, user, key, data, now) {
  await store.setMails(user.id, key, user.email_alerts ? mailsFor(data, now).map(m => ({ ...m, id: randomId(12) })) : []);
}

export async function handleAccount(request, env, url, ctx, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Sign-in isn't set up on this server." }, 503);
  const store = deps.store || d1Store(env.DB);
  const now = deps.now || Date.now();
  const mailer = deps.mailer || (env.RESEND_API_KEY ? resendMailer(env) : null);
  await store.ready();
  const path = url.pathname;

  // One-click "stop email reminders", from the link in every reminder email.
  if (path === "/api/mail/stop") {
    const u = url.searchParams.get("u") || "", t = url.searchParams.get("t") || "";
    if (/^[A-Za-z0-9_-]{8,64}$/.test(u) && /^[A-Za-z0-9_-]{16,64}$/.test(t)) await store.stopEmails(u, t);
    return new Response(page("Email reminders are off", '<h1 style="font-size:22px;margin:0 0 12px">Email reminders are off</h1><p>You won\'t get reminder emails any more. Turn them back on any time in your account at remmynd.space.</p>'),
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  }

  if (path === "/api/me") {
    const s = await signedIn(request, store, now);
    return s ? json(await me(store, s.user)) : json({ signedIn: false });
  }

  // Everything else changes something: POST, JSON, and only from this site.
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  if (!/^application\/json\b/.test(request.headers.get("content-type") || "")) return json({ error: "Send JSON." }, 415);
  const body = await readJSON(request, path === "/api/sync" ? 262144 : 16384);
  if (!body) return json({ error: "That request isn't valid JSON." }, 400);
  const rpId = url.hostname, origin = url.origin;

  /* ---------- sign in with a code by email ---------- */
  if (path === "/api/auth/email/start") {
    const email = cleanEmail(body.email);
    if (!email) return json({ error: "That email address doesn't look right." }, 400);
    // Local testing only: with DEV_SHOW_CODE=1 in .dev.vars and no email key, the code comes back in the response.
    const dev = !mailer && env.DEV_SHOW_CODE === "1";
    if (!mailer && !dev) return json({ error: "Email isn't set up on this server yet." }, 503);
    const prev = await store.code(email);
    if (prev && now - prev.sent < 60e3) return json({ error: "A code is on its way. You can ask again in a minute." }, 429);
    const fresh = !prev || now - prev.window_start > 3600e3;
    if (!fresh && prev.sends >= 5) return json({ error: "Too many codes for this address. Try again in an hour." }, 429);
    if ((await store.countSend(Math.floor(now / 3600e3))) > SENDS_PER_HOUR) return json({ error: "remmynd is sending a lot of emails right now. Try again soon." }, 503);
    const code = sixDigits();
    await store.putCode({ email, code_hash: await hash(email + ":" + code), expires: now + CODE_MS, sent: now, sends: fresh ? 1 : prev.sends + 1, window_start: fresh ? now : prev.window_start });
    if (dev) return json({ ok: true, devCode: code });
    const status = await mailer({ to: email, ...codeMail(code) }).catch(() => 0);
    if (status < 200 || status >= 300) { await store.deleteCode(email); return json({ error: "The code couldn't be sent. Check the address and try again." }, 502); }
    return json({ ok: true });
  }

  if (path === "/api/auth/email/verify") {
    const email = cleanEmail(body.email), code = String(body.code || "").replace(/\s+/g, "");
    if (!email || !/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code from the email." }, 400);
    const c = await store.code(email);
    if (!c || c.expires < now || c.tries >= 5) return json({ error: "That code has expired. Ask for a new one." }, 400);
    if (c.code_hash !== await hash(email + ":" + code)) { await store.tryCode(email); return json({ error: "That code isn't right." }, 400); }
    await store.deleteCode(email);
    let user = await store.userByEmail(email), isNew = false;
    if (!user) { user = { id: randomId(12), email, created: now, email_alerts: 1, stop_token: randomId(24) }; await store.createUser(user); isNew = true; }
    return json({ ...(await me(store, user)), isNew }, 200, { "set-cookie": await startSession(store, user.id, url, now) });
  }

  /* ---------- sign in with a passkey ---------- */
  if (path === "/api/auth/passkey/options") {
    const id = randomId(16), challenge = randomId(32);
    await store.putChallenge({ id, challenge, kind: "auth", expires: now + 5 * 60e3 });
    return json({ challengeId: id, publicKey: { challenge, rpId, userVerification: "preferred", timeout: 120000 } });
  }
  if (path === "/api/auth/passkey/verify") {
    const ch = typeof body.challengeId === "string" ? await store.takeChallenge(body.challengeId) : null;
    if (!ch || ch.kind !== "auth" || ch.expires < now) return json({ error: "That sign-in took too long. Try again." }, 400);
    const key = typeof body.id === "string" ? await store.passkey(body.id) : null;
    if (!key) return json({ error: "This passkey isn't linked to a remmynd account." }, 400);
    try {
      const count = await verifyAssertion(body, { challenge: ch.challenge, origin, rpId, publicKey: key.public_key, alg: key.alg, signCount: key.sign_count });
      await store.usePasskey(key.id, count, now);
    } catch (e) { return json({ error: "The passkey couldn't be checked." }, 400); }
    const user = await store.userById(key.user_id);
    if (!user) return json({ error: "This passkey isn't linked to a remmynd account." }, 400);
    return json(await me(store, user), 200, { "set-cookie": await startSession(store, user.id, url, now) });
  }

  /* ---------- everything below needs a signed-in account ---------- */
  const s = await signedIn(request, store, now);
  if (!s) return json({ error: "Sign in first." }, 401);
  const user = s.user;

  if (path === "/api/auth/signout") {
    await store.deleteSession(s.hash);
    return json({ ok: true }, 200, { "set-cookie": cookie(url, "", 0) });
  }
  if (path === "/api/account/delete") {
    await store.deleteUser(user.id);
    return json({ ok: true }, 200, { "set-cookie": cookie(url, "", 0) });
  }
  if (path === "/api/account/settings") {
    if (typeof body.emailAlerts !== "boolean") return json({ error: "Nothing to change." }, 400);
    await store.setEmailAlerts(user.id, body.emailAlerts);
    user.email_alerts = body.emailAlerts ? 1 : 0;
    if (body.emailAlerts) for (const r of await store.reminders(user.id)) { let d = null; try { d = JSON.parse(r.data); } catch {} await scheduleMails(store, user, r.key, d, now); }
    else await store.clearMails(user.id);
    return json(await me(store, user));
  }

  if (path === "/api/passkeys/options") {
    const id = randomId(16), challenge = randomId(32);
    await store.putChallenge({ id, challenge, userId: user.id, kind: "reg", expires: now + 5 * 60e3 });
    const existing = await store.passkeysOf(user.id);
    return json({ challengeId: id, publicKey: {
      challenge, rp: { id: rpId, name: "remmynd" }, user: { id: b64url(enc.encode(user.id)), name: user.email, displayName: user.email },
      pubKeyCredParams: [ALGS.ES256, ALGS.EdDSA, ALGS.RS256].map(alg => ({ type: "public-key", alg })),
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
      attestation: "none", timeout: 120000, excludeCredentials: existing.map(k => ({ type: "public-key", id: k.id })),
    } });
  }
  if (path === "/api/passkeys/add") {
    const ch = typeof body.challengeId === "string" ? await store.takeChallenge(body.challengeId) : null;
    if (!ch || ch.kind !== "reg" || ch.user_id !== user.id || ch.expires < now) return json({ error: "Adding the passkey took too long. Try again." }, 400);
    let key;
    try { key = await verifyRegistration(body, { challenge: ch.challenge, origin }); } catch (e) { return json({ error: "That passkey couldn't be added." }, 400); }
    if (await store.passkey(key.id)) return json({ error: "That passkey is already added." }, 409);
    const name = typeof body.name === "string" ? body.name.slice(0, 60) : "Passkey";
    await store.addPasskey({ ...key, userId: user.id, name, created: now });
    return json(await me(store, user));
  }
  if (path === "/api/passkeys/delete") {
    if (typeof body.id !== "string") return json({ error: "Which passkey?" }, 400);
    await store.deletePasskey(user.id, body.id);
    return json(await me(store, user));
  }

  /* ---------- sync ---------- */
  if (path === "/api/sync") {
    const since = Number.isFinite(body.since) ? body.since : 0;
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (incoming.length > 500) return json({ error: "Too many changes at once." }, 413);
    const clean = [];
    for (const x of incoming) {
      if (!x || (x.kind !== "reminder" && x.kind !== "link") || typeof x.key !== "string" || !x.key || x.key.length > 2100) return json({ error: "A change isn't valid." }, 400);
      if (x.key.includes("/#")) continue; // private links stay on the device
      const data = x.deleted ? null : JSON.stringify(x.data ?? null);
      if (data && data.length > MAX_DATA) return json({ error: "A reminder is too large to sync." }, 413);
      if (data && /"share":"[^"]*\/#/.test(data)) continue;
      clean.push({ kind: x.kind, key: x.key, data, deleted: !!x.deleted, updated: Math.min(Number(x.updated) || now, now) });
    }
    if (clean.some(x => !x.deleted) && (await store.countItems(user.id)) + clean.length > MAX_ITEMS) return json({ error: "Your account holds the most reminders it can. Delete some old ones." }, 413);
    // Emails follow the newest version of each reminder.
    const mailWork = [];
    for (const x of clean) if (x.kind === "reminder" && x.updated >= await store.itemUpdated(user.id, x.kind, x.key)) mailWork.push(x);
    await store.putItems(user.id, clean);
    for (const x of mailWork) await scheduleMails(store, user, x.key, x.deleted ? null : JSON.parse(x.data), now);
    const items = (await store.items(user.id, since)).map(r => ({ kind: r.kind, key: r.key, updated: r.updated, deleted: !!r.deleted, data: r.deleted || !r.data ? null : JSON.parse(r.data) }));
    return json({ now, items });
  }

  return json({ error: "Not found." }, 404);
}

/** Runs every minute from the cron trigger: sends the reminder emails that are due. */
export async function sendDueMails(env, now = Date.now(), deps = {}) {
  if ((!env.DB && !deps.store) || (!env.RESEND_API_KEY && !deps.mailer)) return { sent: 0 };
  const store = deps.store || d1Store(env.DB), mailer = deps.mailer || resendMailer(env), origin = deps.origin || "https://remmynd.space";
  await store.ready();
  let sent = 0;
  for (const r of await store.dueMails(now + 30e3)) {
    let d = null; try { d = JSON.parse(r.data); } catch {}
    let done = true;
    if (r.email_alerts && d && d.state === "held" && r.at > now - 3600e3) {
      const stop = origin + "/api/mail/stop?u=" + encodeURIComponent(r.user_id) + "&t=" + encodeURIComponent(r.stop_token);
      const status = await mailer({ to: r.email, ...reminderMail(d, r.kind, stop, origin) }).catch(() => 0);
      if (status >= 200 && status < 300) sent++;
      else if (status === 0 || status === 429 || status >= 500) done = false; // try again next minute
    }
    if (done) await store.deleteMail(r.id);
  }
  await store.cleanup(now);
  return { sent };
}
