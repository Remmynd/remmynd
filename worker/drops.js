// Drops and dares.
//
// A drop is a photo, voice note or message that opens at a set time ("open at midnight on your birthday"). The phone
// scrambles it with AES-GCM under a key that lives only in the link, after the # (remmynd.space/d/<id>#k=<key>), so
// this server keeps bytes it can't read, and won't hand them over before the opening time. Anyone with the link can
// open it once it's time, in the app or in a browser (the page unscrambles it on the device).
//
// A dare is a link with a countdown ("50 push-ups before 9pm"). People take it, and close it by posting a proof photo
// before the time runs out; the photo is scrambled the same way, with the key in the dare's link. The dare's words and
// the first names of the people who took it are kept as written; the public page shows only the counts.
//
//   POST /api/drop/new            { opens, meta, file, name }   make one (signed in); meta is the scrambled message
//   POST /api/drop/<id>/file      scrambled bytes                the photo or voice note, once, before it opens
//   POST /api/drop/<id>/read      {}                             when it opens, and once open the scrambled message
//   GET  /api/drop/<id>/file                                     the scrambled bytes, once it's open
//   POST /api/drop/<id>/save      { on }                         keep it in my list, so my phone tells me when it opens
//   POST /api/drop/mine           {}                             drops you made or saved
//   GET  /d/<id>                                                 the page: a countdown, then the drop itself
//
//   POST /api/dare/new            { what, by, name }             make one (signed in)
//   POST /api/dare/<code>/read    {}                             the dare and who took it (and which one is you)
//   POST /api/dare/<code>/take    { name }                       take it, before the time runs out
//   POST /api/dare/<code>/proof   scrambled bytes                close it with a proof photo, before the time runs out
//   GET  /api/dare/<code>/proof/<tid>                            someone's scrambled proof photo
//   POST /api/dare/mine           {}                             dares you made or took
//   GET  /dare/<code>                                            the public page: the dare, the countdown, the counts
//
// Everything is deleted 30 days after a drop opens or a dare closes. Files live in the private CHAT_FILES bucket under
// drops/ and dares/.

import { ogImageURL, ogImageTags, inText, leftText } from "./ogimage.js";
import { signedIn, d1Store } from "./account.js";
import { planFor, proNeeded, FREE } from "./pro.js";
import { tellAccounts } from "./apns.js";
import { tally } from "./numbers.js";
import { escapeHTML as esc } from "./preview.js";

const DAY = 864e5;
export const DROP_LIMITS = { meta: 6000, fileBytes: 700 * 1024, ahead: 366 * DAY, waiting: 20, name: 30, what: 120, minDare: 10 * 60e3, maxDare: 30 * DAY,
  dares: 20, takers: 100, keep: 30 * DAY };
const ID = /^[a-z0-9]{10}$/, TID = /^[a-z0-9]{10}$/, META = /^[A-Za-z0-9_-]{40,8000}$/;

export const DROP_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS drop_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, opens INTEGER NOT NULL, meta TEXT NOT NULL, file INTEGER NOT NULL, told INTEGER NOT NULL, created INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS drop_items_user ON drop_items (user_id)",
  "CREATE TABLE IF NOT EXISTS drop_saves (id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (id, user_id))",
  "CREATE INDEX IF NOT EXISTS drop_saves_user ON drop_saves (user_id)",
  "CREATE TABLE IF NOT EXISTS dare_items (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, what TEXT NOT NULL, by_at INTEGER NOT NULL, told INTEGER NOT NULL, created INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS dare_items_user ON dare_items (user_id)",
  "CREATE TABLE IF NOT EXISTS dare_takers (code TEXT NOT NULL, user_id TEXT NOT NULL, tid TEXT NOT NULL, name TEXT NOT NULL, taken INTEGER NOT NULL, proof INTEGER, PRIMARY KEY (code, user_id))",
  "CREATE INDEX IF NOT EXISTS dare_takers_user ON dare_takers (user_id)",
];

let ready = null;
export function dropStore(db) {
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const st = (sql, ...a) => db.prepare(sql).bind(...a);
  const dropGone = id => [st("DELETE FROM drop_saves WHERE id = ?", id), st("DELETE FROM drop_items WHERE id = ?", id)];
  const dareGone = c => [st("DELETE FROM dare_takers WHERE code = ?", c), st("DELETE FROM dare_items WHERE code = ?", c)];
  const proofKeys = async c => (await all("SELECT tid FROM dare_takers WHERE code = ? AND proof IS NOT NULL", c)).map(r => "dares/" + c + "/" + r.tid);
  return {
    ready: () => (ready ||= db.batch(DROP_SCHEMA.map(s => db.prepare(s))).catch(e => { ready = null; throw e; })),
    drop: id => one("SELECT * FROM drop_items WHERE id = ?", id),
    makeDrop: d => st("INSERT INTO drop_items (id, user_id, name, opens, meta, file, told, created) VALUES (?, ?, ?, ?, ?, ?, 0, ?)", d.id, d.user_id, d.name, d.opens, d.meta, d.file, d.created).run(),
    setFile: (id, size) => st("UPDATE drop_items SET file = ? WHERE id = ?", size, id).run(),
    waiting: async (user, now) => ((await one("SELECT COUNT(*) AS n FROM drop_items WHERE user_id = ? AND opens > ?", user, now)) || {}).n || 0,
    saved: async (id, user) => !!(await one("SELECT id FROM drop_saves WHERE id = ? AND user_id = ?", id, user)),
    saves: async id => ((await one("SELECT COUNT(*) AS n FROM drop_saves WHERE id = ?", id)) || {}).n || 0,
    save: (id, user, on) => on ? st("INSERT OR IGNORE INTO drop_saves (id, user_id) VALUES (?, ?)", id, user).run() : st("DELETE FROM drop_saves WHERE id = ? AND user_id = ?", id, user).run(),
    myDrops: user => all("SELECT d.* FROM drop_items d WHERE d.user_id = ? OR d.id IN (SELECT id FROM drop_saves WHERE user_id = ?) ORDER BY d.opens DESC LIMIT 50", user, user),

    dare: c => one("SELECT * FROM dare_items WHERE code = ?", c),
    makeDare: d => st("INSERT INTO dare_items (code, user_id, name, what, by_at, told, created) VALUES (?, ?, ?, ?, ?, 0, ?)", d.code, d.user_id, d.name, d.what, d.by_at, d.created).run(),
    open: async (user, now) => ((await one("SELECT COUNT(*) AS n FROM dare_items WHERE user_id = ? AND by_at > ?", user, now)) || {}).n || 0,
    takers: c => all("SELECT * FROM dare_takers WHERE code = ? ORDER BY taken", c),
    taker: (c, user) => one("SELECT * FROM dare_takers WHERE code = ? AND user_id = ?", c, user),
    take: t => st("INSERT INTO dare_takers (code, user_id, tid, name, taken, proof) VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT (code, user_id) DO UPDATE SET name = excluded.name", t.code, t.user_id, t.tid, t.name, t.taken).run(),
    proved: (c, user, at) => st("UPDATE dare_takers SET proof = ? WHERE code = ? AND user_id = ?", at, c, user).run(),
    myDares: user => all("SELECT d.* FROM dare_items d WHERE d.user_id = ? OR d.code IN (SELECT code FROM dare_takers WHERE user_id = ?) ORDER BY d.by_at DESC LIMIT 50", user, user),
    daresToTell: now => all("SELECT * FROM dare_items WHERE told = 0 AND by_at <= ? LIMIT 50", now),
    toldDare: c => st("UPDATE dare_items SET told = 1 WHERE code = ?", c).run(),

    /** Drops that opened 30 days ago and dares that closed 30 days ago. Answers the file keys to delete. */
    clean: async now => {
      const drops = await all("SELECT id, file FROM drop_items WHERE opens < ? LIMIT 100", now - DROP_LIMITS.keep);
      const dares = await all("SELECT code FROM dare_items WHERE by_at < ? LIMIT 100", now - DROP_LIMITS.keep);
      const keys = drops.filter(d => d.file > 0).map(d => "drops/" + d.id);
      for (const d of dares) keys.push(...await proofKeys(d.code));
      const q = [...drops.flatMap(d => dropGone(d.id)), ...dares.flatMap(d => dareGone(d.code))];
      if (q.length) await db.batch(q);
      return keys;
    },
    /** Deleting an account: its drops and dares go (with their files), and it leaves everything it saved or took. */
    deleteUser: async user => {
      const drops = await all("SELECT id, file FROM drop_items WHERE user_id = ?", user);
      const dares = await all("SELECT code FROM dare_items WHERE user_id = ?", user);
      const took = await all("SELECT code, tid FROM dare_takers WHERE user_id = ? AND proof IS NOT NULL", user);
      const keys = drops.filter(d => d.file > 0).map(d => "drops/" + d.id).concat(took.map(t => "dares/" + t.code + "/" + t.tid));
      for (const d of dares) keys.push(...await proofKeys(d.code));
      await db.batch([...drops.flatMap(d => dropGone(d.id)), ...dares.flatMap(d => dareGone(d.code)),
        st("DELETE FROM drop_saves WHERE user_id = ?", user), st("DELETE FROM dare_takers WHERE user_id = ?", user)]);
      return [...new Set(keys)];
    },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rid = () => { const a = crypto.getRandomValues(new Uint8Array(10)), abc = "abcdefghjkmnpqrstuvwxyz023456789"; return [...a].map(x => abc[x & 31]).join(""); };
const line = (v, n) => String(v || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
async function readBody(request) { try { const b = JSON.parse((await request.text()).slice(0, 10000)); return b && typeof b === "object" ? b : {}; } catch { return {}; } }
const bytesOut = obj => new Response(obj.body, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox", "content-disposition": "attachment" } });
async function bytesIn(request) {
  if (Number(request.headers.get("content-length") || 0) > DROP_LIMITS.fileBytes) return { error: json({ error: "That file is too big." }, 413) };
  const b = new Uint8Array(await request.arrayBuffer());
  if (b.length < 29) return { error: json({ error: "That file is empty." }, 400) };
  if (b.length > DROP_LIMITS.fileBytes) return { error: json({ error: "That file is too big." }, 413) };
  return { bytes: b };
}

function dropView(d, user, now, extra = {}) {
  const open = d.opens <= now;
  return { id: d.id, from: d.name, opens: d.opens, open, file: d.file > 0, mine: !!user && d.user_id === user, meta: open ? d.meta : null, ...extra };
}
function dareView(d, takers, user, now) {
  const closed = d.by_at <= now;
  const people = takers.map(t => ({ tid: t.tid, name: t.name, state: t.proof ? "done" : closed ? "missed" : "taken", at: t.proof || t.taken, taken: t.taken, me: !!user && t.user_id === user }));
  return { code: d.code, what: d.what, from: d.name, by: d.by_at, closed, mine: !!user && d.user_id === user, took: people.length, done: people.filter(p => p.state === "done").length, people };
}

/** Every minute: tell a darer their dare closed, and clear out what's 30 days old. */
export async function runDrops(env, now = Date.now(), deps = {}) {
  if (!env.DB && !deps.store) return 0;
  const store = deps.store || dropStore(env.DB), tell = deps.tell || tellAccounts, bucket = deps.files || env.CHAT_FILES;
  await store.ready();
  // A drop opening is told by the phones themselves (a local alert at the opening time, which needs no connection).
  for (const d of await store.daresToTell(now)) {
    await store.toldDare(d.code);
    const t = await store.takers(d.code), done = t.filter(x => x.proof).length;
    await tell(env, [d.user_id], { title: "Your dare closed", body: t.length ? done + " of " + t.length + " did it: " + d.what : "Nobody took it: " + d.what }, { dare: d.code, kind: "dare", collapse: "x" + d.code }, deps);
  }
  const keys = await store.clean(now);
  if (bucket && keys.length) await bucket.delete(keys);
  return keys.length;
}

/** Deleting an account (account.js). */
export async function deleteDropsOf(env, user) {
  const store = dropStore(env.DB);
  await store.ready();
  const keys = await store.deleteUser(user);
  if (env.CHAT_FILES && keys.length) await env.CHAT_FILES.delete(keys);
}

export async function handleDrop(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Drops aren't set up on this server." }, 503);
  const store = deps.store || dropStore(env.DB), now = deps.now || Date.now(), bucket = deps.files || env.CHAT_FILES;
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(3);
  await store.ready();

  if (request.method === "GET" && parts.length === 2 && parts[1] === "file") {
    const d = ID.test(parts[0]) ? await store.drop(parts[0]) : null;
    if (!d || !d.file || !bucket) return json({ error: "Not found." }, 404);
    if (d.opens > now) return json({ error: "It isn't time yet.", opens: d.opens }, 425);
    const obj = await bucket.get("drops/" + d.id);
    return obj ? bytesOut(obj) : json({ error: "Not found." }, 404);
  }
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const accounts = deps.accounts || d1Store(env.DB);
  const s = await signedIn(request, accounts, now), user = s ? s.user.id : null;

  // Reading a drop needs only the link: the key is in it, and before the time there's nothing to read.
  if (parts.length === 2 && parts[1] === "read") {
    const d = ID.test(parts[0]) ? await store.drop(parts[0]) : null;
    if (!d) return json({ error: "There's no drop at this link. It may have opened more than 30 days ago." }, 404);
    return json(dropView(d, user, now, { saved: user ? await store.saved(d.id, user) : false }));
  }
  if (!user) return json({ error: "Sign in first.", need: "signin" }, 401);

  if (parts.length === 1 && parts[0] === "new") {
    const body = await readBody(request);
    const opens = Math.round(Number(body.opens));
    if (!(opens > now + 30e3 && opens <= now + DROP_LIMITS.ahead)) return json({ error: "Pick a time from a minute from now to a year ahead." }, 400);
    const meta = String(body.meta || "");
    if (!META.test(meta) || meta.length > DROP_LIMITS.meta) return json({ error: "That message is too long." }, 400);
    const waiting = await store.waiting(user, now);
    if ((await planFor(env, accounts, s.user, now)).limited && waiting >= FREE.drops)
      return proNeeded("The free plan keeps " + FREE.drops + " of your drops waiting at a time. Pro keeps up to " + DROP_LIMITS.waiting + ".", FREE.drops);
    if (waiting >= DROP_LIMITS.waiting) return json({ error: "That's " + DROP_LIMITS.waiting + " drops waiting to open. Wait for one to open." }, 429);
    const d = { id: rid(), user_id: user, name: line(body.name, DROP_LIMITS.name) || "A friend", opens, meta, file: body.file ? -1 : 0, created: now };
    await store.makeDrop(d);
    await tally(env, "drop.made", 1, now);
    return json(dropView(d, user, now));
  }
  if (parts.length === 1 && parts[0] === "mine") {
    const list = await store.myDrops(user);
    return json({ drops: await Promise.all(list.map(async d => dropView(d, user, now, { saved: await store.saved(d.id, user), saves: d.user_id === user ? await store.saves(d.id) : undefined }))) });
  }
  const [id, act] = parts;
  const d = parts.length === 2 && ID.test(id || "") ? await store.drop(id) : null;
  if (!d) return json({ error: "There's no drop at this link." }, 404);
  if (act === "file") {
    if (d.user_id !== user) return json({ error: "Only the person who made this drop can add to it." }, 403);
    if (d.file !== -1) return json({ error: d.file > 0 ? "This drop already has its photo or voice note." : "This drop is a message only." }, 400);
    if (d.opens <= now) return json({ error: "This drop has already opened." }, 400);
    if (!bucket) return json({ error: "Photos and voice notes aren't set up on this server." }, 503);
    const r = await bytesIn(request);
    if (r.error) return r.error;
    await bucket.put("drops/" + d.id, r.bytes, { httpMetadata: { contentType: "application/octet-stream" } });
    await store.setFile(d.id, r.bytes.length);
    return json({ ok: true });
  }
  if (act === "save") {
    const body = await readBody(request);
    await store.save(d.id, user, body.on !== false);
    return json(dropView(d, user, now, { saved: body.on !== false }));
  }
  return json({ error: "Not found." }, 404);
}

export async function handleDare(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Dares aren't set up on this server." }, 503);
  const store = deps.store || dropStore(env.DB), now = deps.now || Date.now(), bucket = deps.files || env.CHAT_FILES, tell = deps.tell || tellAccounts;
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(3);
  await store.ready();

  if (request.method === "GET" && parts.length === 3 && parts[1] === "proof") {
    const d = ID.test(parts[0]) ? await store.dare(parts[0]) : null;
    const t = d && TID.test(parts[2]) ? (await store.takers(d.code)).find(x => x.tid === parts[2] && x.proof) : null;
    if (!t || !bucket) return json({ error: "Not found." }, 404);
    const obj = await bucket.get("dares/" + d.code + "/" + t.tid);
    return obj ? bytesOut(obj) : json({ error: "Not found." }, 404);
  }
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const accounts = deps.accounts || d1Store(env.DB);
  const s = await signedIn(request, accounts, now);
  if (!s) return json({ error: "Sign in to take part.", need: "signin" }, 401);
  const user = s.user.id;

  if (parts.length === 1 && parts[0] === "new") {
    const body = await readBody(request);
    const what = line(body.what, DROP_LIMITS.what);
    if (!what) return json({ error: "Say what the dare is, like “50 push-ups”." }, 400);
    const by = Math.round(Number(body.by));
    if (!(by >= now + DROP_LIMITS.minDare && by <= now + DROP_LIMITS.maxDare)) return json({ error: "Give it from 10 minutes to 30 days." }, 400);
    const open = await store.open(user, now);
    // Free: three dares of yours open at a time (taking others' is never limited). Pro: up to DROP_LIMITS.dares.
    if ((await planFor(env, accounts, s.user, now)).limited && open >= FREE.dares)
      return proNeeded("The free plan keeps " + FREE.dares + " of your dares open at a time. Pro keeps up to " + DROP_LIMITS.dares + ".", FREE.dares);
    if (open >= DROP_LIMITS.dares) return json({ error: "That's " + DROP_LIMITS.dares + " dares running. Wait for one to close." }, 429);
    const d = { code: rid(), user_id: user, name: line(body.name, DROP_LIMITS.name) || "A friend", what, by_at: by, created: now };
    await store.makeDare(d);
    await tally(env, "dare.made", 1, now);
    return json(dareView(d, [], user, now));
  }
  if (parts.length === 1 && parts[0] === "mine") {
    const list = await store.myDares(user);
    return json({ dares: await Promise.all(list.map(async d => dareView(d, await store.takers(d.code), user, now))) });
  }
  const [cd, act] = parts;
  const d = parts.length === 2 && ID.test(cd || "") ? await store.dare(cd) : null;
  if (!d) return json({ error: "There's no dare at this link. It may have closed more than 30 days ago." }, 404);
  if (act === "read") return json(dareView(d, await store.takers(cd), user, now));
  if (act === "take") {
    const body = await readBody(request);
    const name = line(body.name, DROP_LIMITS.name);
    if (!name) return json({ error: "Add your first name, so they know it's you." }, 400);
    if (d.by_at <= now) return json({ error: "Time's up on this dare." }, 400);
    const had = await store.taker(cd, user);
    if (!had && (await store.takers(cd)).length >= DROP_LIMITS.takers) return json({ error: "This dare is full." }, 403);
    await store.take({ code: cd, user_id: user, tid: had ? had.tid : rid(), name, taken: had ? had.taken : now });
    if (!had) {
      await tally(env, "dare.taken", 1, now);
      if (d.user_id !== user) await tell(env, [d.user_id], { title: name + " took your dare", body: d.what }, { dare: cd, kind: "dare" }, deps);
    }
    return json(dareView(d, await store.takers(cd), user, now));
  }
  if (act === "proof") {
    const t = await store.taker(cd, user);
    if (!t) return json({ error: "Take the dare first." }, 403);
    if (d.by_at <= now) return json({ error: "Time's up on this dare." }, 400);
    if (!bucket) return json({ error: "Photos aren't set up on this server." }, 503);
    const r = await bytesIn(request);
    if (r.error) return r.error;
    await bucket.put("dares/" + cd + "/" + t.tid, r.bytes, { httpMetadata: { contentType: "application/octet-stream" } });
    await store.proved(cd, user, now);
    await tally(env, "dare.done", 1, now);
    if (d.user_id !== user) await tell(env, [d.user_id], { title: t.name + " did your dare", body: d.what + ". See the proof." }, { dare: cd, kind: "dare" }, deps);
    return json(dareView(d, await store.takers(cd), user, now));
  }
  return json({ error: "Not found." }, 404);
}

const page = (title, body, nonce, head = "") => new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title>' +
  '<meta property="og:title" content="' + esc(title) + '"><meta name="robots" content="noindex">' + head + '<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0B0B0B;color:#fff;padding:40px 16px}' +
  '.w{max-width:480px;margin:0 auto}.eye{color:#FFB52E;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px}h1{font-size:40px;line-height:1.08;margin:8px 0 12px}' +
  '.big{font-size:56px;font-weight:800;font-variant-numeric:tabular-nums;color:#FFB52E;margin:24px 0}.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:24px 0}' +
  '.nums div{background:#1a1a1a;border-radius:16px;padding:16px}.nums b{display:block;font-size:30px;color:#FFB52E}.nums span{color:#aaa;font-size:14px}' +
  '.msg{font-size:24px;line-height:1.35;white-space:pre-wrap;background:#1a1a1a;border-radius:20px;padding:20px}img{max-width:100%;border-radius:20px}audio{width:100%}' +
  '.btn{display:inline-block;background:#FFB52E;color:#0B0B0B;font-weight:700;text-decoration:none;padding:16px 24px;border-radius:16px}.small{color:#999;font-size:14px}a{color:#FFB52E}</style>' +
  '<body><div class="w">' + body + '<p class="small" style="margin-top:40px"><a href="/">remmynd</a> · reminders that make sure it happens</p></div></body></html>',
  { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; img-src blob:; media-src blob:" + (nonce ? "; script-src 'nonce-" + nonce + "'" : "") } });
const missing = (what) => { const r = page("Not found · remmynd", "<h1>There's no " + what + " here</h1><p>The link may be wrong, or it ended more than 30 days ago.</p>"); return new Response(r.body, { status: 404, headers: r.headers }); };

/** The card for a drop's live picture (worker/og.js): who it's from and when it opens, never what's inside. */
export async function dropCard(env, id, deps = {}) {
  if (!ID.test(id) || (!env.DB && !deps.store)) return null;
  const store = deps.store || dropStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const d = await store.drop(id);
  if (!d) return null;
  const open = d.opens <= now;
  return { theme: "dark", eye: "Drop", title: "A drop from " + d.name, line: "Only people with this exact link can open it",
    big: open ? "It's open" : "Opens " + inText(d.opens - now), stats: [] };
}

/** The card for a dare's live picture: the dare, the time left, how many took it and did it. No names of takers, no photos. */
export async function dareCard(env, cd, deps = {}) {
  if (!ID.test(cd) || (!env.DB && !deps.store)) return null;
  const store = deps.store || dropStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const d = await store.dare(cd);
  if (!d) return null;
  const v = dareView(d, await store.takers(cd), null, now);
  return { theme: "dark", eye: d.name + " dares you", title: d.what, line: v.closed ? "Time's up" : "Prove it with a photo before time runs out",
    big: v.closed ? "Time's up" : leftText(d.by_at - now), tone: v.closed ? "quiet" : "",
    stats: [{ n: v.took, label: "took it" }, { n: v.done, label: "did it" }] };
}

/** The drop's page: a countdown until it opens, then the drop itself, unscrambled in the browser with the key after the #. */
export async function dropPage(request, env, url, deps = {}) {
  const id = url.pathname.split("/")[2] || "";
  if (!ID.test(id) || (!env.DB && !deps.store)) return missing("drop");
  const store = deps.store || dropStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const d = await store.drop(id);
  if (!d) return missing("drop");
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const body = '<p class="eye">A drop from ' + esc(d.name) + '</p><h1 id="h">' + (d.opens <= now ? "It's open" : "Opens soon") + '</h1>' +
    '<div id="c" class="big"></div><div id="out"></div>' +
    '<p><a class="btn" href="https://remmynd.space/d/' + esc(id) + '">Open in the remmynd app</a></p><p class="small" id="s">Only people with this exact link can open it. remmynd itself can\'t see what\'s inside.</p>' +
    '<script nonce="' + nonce + '">var __name = function (f) { return f; };(' + viewer.toString() + ')(' + JSON.stringify({ id, opens: d.opens, now }) + ');</script>';
  return page("A drop from " + d.name + " · remmynd", body, nonce, ogImageTags(ogImageURL(url.origin, "/d/" + id, now), "A drop from " + d.name, esc));
}

// Runs in the browser: the countdown, then fetch the scrambled drop and unscramble it with the key from the link. It's sent as its
// own source text, and the bundler wraps functions in a __name() helper, so the page defines that helper too.
function viewer(o) {
  const $ = id => document.getElementById(id), skew = Date.now() - o.now;
  const un = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const k = (location.hash.match(/k=([A-Za-z0-9_-]{43})/) || [])[1];
  const open = async (key, b) => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12)));
  async function show() {
    $("c").textContent = ""; $("h").textContent = "It's open";
    if (!k) { $("out").textContent = "This link is missing its key. Ask for the whole link."; return; }
    try {
      const r = await (await fetch("/api/drop/" + o.id + "/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
      const key = await crypto.subtle.importKey("raw", un(k), "AES-GCM", false, ["decrypt"]);
      const m = JSON.parse(new TextDecoder().decode(await open(key, un(r.meta))));
      if (m.text) { const p = document.createElement("p"); p.className = "msg"; p.textContent = m.text; $("out").append(p); }
      if (r.file) {
        const bytes = await open(key, new Uint8Array(await (await fetch("/api/drop/" + o.id + "/file")).arrayBuffer()));
        const url = URL.createObjectURL(new Blob([bytes], { type: m.kind === "voice" ? "audio/mp4" : "image/jpeg" }));
        const el = document.createElement(m.kind === "voice" ? "audio" : "img"); el.src = url; if (m.kind === "voice") el.controls = true; $("out").append(el);
      }
    } catch (e) { $("out").textContent = "This drop couldn't be opened. The link may be incomplete."; }
  }
  function tick() {
    const left = o.opens - (Date.now() - skew);
    if (left <= 0) return show();
    const s = Math.floor(left / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    $("c").textContent = (d ? d + "d " : "") + String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    setTimeout(tick, 1000 - (Date.now() % 1000));
  }
  tick();
}

/** The dare's public page: the dare, the time left, how many took it and did it. No names, no photos. */
export async function darePage(request, env, url, deps = {}) {
  const cd = url.pathname.split("/")[2] || "";
  if (!ID.test(cd) || (!env.DB && !deps.store)) return missing("dare");
  const store = deps.store || dropStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const d = await store.dare(cd);
  if (!d) return missing("dare");
  const v = dareView(d, await store.takers(cd), null, now);
  const left = d.by_at - now, h = Math.floor(left / 3600e3), m = Math.floor(left % 3600e3 / 60e3);
  const body = '<p class="eye">' + esc(d.name) + ' dares you</p><h1>' + esc(d.what) + '</h1>' +
    '<p class="small">' + (v.closed ? "Time's up." : "Time left: " + (h >= 48 ? Math.floor(h / 24) + " days" : h + "h " + m + "m") + ". Prove it with a photo before then.") + '</p>' +
    '<div class="nums"><div><b>' + v.took + '</b><span>took it</span></div><div><b>' + v.done + '</b><span>did it</span></div><div><b>' + (v.closed ? v.took - v.done : v.took - v.done) + '</b><span>' + (v.closed ? "missed" : "still going") + '</span></div></div>' +
    (v.closed ? '<p class="small">Make your own dare in the remmynd app.</p>' : '<p><a class="btn" href="https://remmynd.space/dare/' + esc(cd) + '">Take the dare in remmynd</a></p><p class="small">Open this link on your iPhone with remmynd installed.</p>');
  return page(d.name + " dares you: " + d.what, body, "", ogImageTags(ogImageURL(url.origin, "/dare/" + cd, now), d.name + " dares you: " + d.what, esc));
}
