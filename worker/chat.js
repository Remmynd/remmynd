// Vanishing chat: one small room per reminder, readable only by people who hold its link.
//
// The key never reaches this server. Devices work out a room id and a key from the secret in the link (the private
// link itself, or the #k= piece a shared link gets when someone starts a chat), scramble each message with AES-GCM,
// and send only the scrambled text. This server stores that text under the room id, wakes the other devices that
// asked to be told (an empty ping, as for alerts), and deletes the room and every message 24 hours after the
// reminder ends, or at once when anyone in it ends it for everyone. It never learns who is talking, what they
// say, or which reminder a room belongs to.
//
//   POST /api/chat/<room>/read  { since }                       messages after `since`, and when the room vanishes
//   POST /api/chat/<room>/post  { body, me, ends, endpoint? }   add one scrambled message
//   POST /api/chat/<room>/watch { endpoint, me, on }            this device wants (or no longer wants) a ping
//   POST /api/chat/<room>/end   { }                             delete it now, for everyone
//   POST /api/chat/inbox        { endpoint }                    which watched rooms have new messages (the service worker)
//   POST /api/chat/<room>/file  scrambled bytes, ?me=            a photo or voice note; signed-in accounts only
//   GET  /api/chat/<room>/file/<id>                             the scrambled bytes back
//
// Photos and voice notes live in a private R2 bucket (CHAT_FILES), as bytes this server can't read, under
// <room>/<id>. Sending one needs a signed-in account and counts toward a daily limit, kept per account and day
// with no record of which chat it went to. They are deleted with their chat.

import { validEndpoint } from "./push.js";
import { signedIn, d1Store } from "./account.js";

const DAY = 864e5;
export const LIMITS = { people: 20, messages: 500, body: 2400, life: 400 * DAY, after: DAY, files: 30, fileBytes: 400 * 1024, perDay: 30 };
const ROOM = /^[A-Za-z0-9_-]{22}$/, ME = /^[A-Za-z0-9_-]{8,24}$/, BODY = /^[A-Za-z0-9_-]+$/, FILE = /^[a-f0-9]{20}$/;

export const CHAT_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS chat_rooms (id TEXT PRIMARY KEY, ends INTEGER NOT NULL, created INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS chat_msgs (id TEXT PRIMARY KEY, room TEXT NOT NULL, me TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS chat_msgs_room ON chat_msgs (room, at)",
  "CREATE TABLE IF NOT EXISTS chat_people (room TEXT NOT NULL, me TEXT NOT NULL, endpoint TEXT, PRIMARY KEY (room, me))",
  "CREATE TABLE IF NOT EXISTS chat_inbox (endpoint TEXT NOT NULL, room TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (endpoint, room))",
  "CREATE TABLE IF NOT EXISTS chat_gone (id TEXT PRIMARY KEY, until INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS chat_files (id TEXT PRIMARY KEY, room TEXT NOT NULL, at INTEGER NOT NULL, size INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS chat_files_room ON chat_files (room)",
  "CREATE TABLE IF NOT EXISTS chat_uploads (user_id TEXT NOT NULL, day INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user_id, day))"
];

let ready = null;
export function chatStore(db) {
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const st = (sql, ...a) => db.prepare(sql).bind(...a);
  const gone = id => [st("DELETE FROM chat_files WHERE room = ?", id), st("DELETE FROM chat_msgs WHERE room = ?", id), st("DELETE FROM chat_people WHERE room = ?", id), st("DELETE FROM chat_inbox WHERE room = ?", id), st("DELETE FROM chat_rooms WHERE id = ?", id)];
  return {
    ready: () => (ready ||= db.batch(CHAT_SCHEMA.map(s => db.prepare(s))).catch(e => { ready = null; throw e; })),
    room: id => one("SELECT * FROM chat_rooms WHERE id = ?", id),
    isGone: async id => !!(await one("SELECT id FROM chat_gone WHERE id = ?", id)),
    makeRoom: (id, ends, now) => st("INSERT OR IGNORE INTO chat_rooms (id, ends, created) VALUES (?, ?, ?)", id, ends, now).run(),
    count: async id => (await one("SELECT COUNT(*) AS n FROM chat_msgs WHERE room = ?", id)).n,
    people: id => all("SELECT me, endpoint FROM chat_people WHERE room = ?", id),
    join: (id, me) => st("INSERT OR IGNORE INTO chat_people (room, me, endpoint) VALUES (?, ?, NULL)", id, me).run(),
    watch: (id, me, endpoint) => db.batch([st("UPDATE chat_people SET endpoint = NULL WHERE endpoint = ? AND room = ?", endpoint, id), st("UPDATE chat_people SET endpoint = ? WHERE room = ? AND me = ?", endpoint, id, me)]),
    unwatch: (id, me) => st("UPDATE chat_people SET endpoint = NULL WHERE room = ? AND me = ?", id, me).run(),
    add: (m, tell, now) => db.batch([st("INSERT INTO chat_msgs (id, room, me, at, body) VALUES (?, ?, ?, ?, ?)", m.id, m.room, m.me, m.at, m.body),
      ...tell.flatMap(e => [st("INSERT INTO chat_inbox (endpoint, room, n, at) VALUES (?, ?, 1, ?) ON CONFLICT (endpoint, room) DO UPDATE SET n = n + 1, at = excluded.at", e, m.room, now),
        st("INSERT OR REPLACE INTO pings (id, endpoint, at, created) VALUES (?, ?, ?, ?)", "c" + m.id, e, now, now)])]),
    since: (id, at) => all("SELECT id, me, at, body FROM chat_msgs WHERE room = ? AND at > ? ORDER BY at, id LIMIT 200", id, at),
    takeInbox: async endpoint => { const r = await all("SELECT room, n FROM chat_inbox WHERE endpoint = ?", endpoint); if (r.length) await st("DELETE FROM chat_inbox WHERE endpoint = ?", endpoint).run(); return r; },
    fileCount: async id => (await one("SELECT COUNT(*) AS n FROM chat_files WHERE room = ?", id)).n,
    file: (id, fid) => one("SELECT id FROM chat_files WHERE room = ? AND id = ?", id, fid),
    fileIds: async id => (await all("SELECT id FROM chat_files WHERE room = ?", id)).map(r => r.id),
    addFile: f => st("INSERT INTO chat_files (id, room, at, size) VALUES (?, ?, ?, ?)", f.id, f.room, f.at, f.size).run(),
    upload: async (user, day) => { await st("INSERT INTO chat_uploads (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = n + 1", user, day).run(); return (await one("SELECT n FROM chat_uploads WHERE user_id = ? AND day = ?", user, day)).n; },
    end: (id, until) => db.batch([...gone(id), st("INSERT OR REPLACE INTO chat_gone (id, until) VALUES (?, ?)", id, until)]),
    clean: async now => {
      const old = await all("SELECT id, ends FROM chat_rooms WHERE ends < ? LIMIT 100", now - LIMITS.after);
      const files = old.length ? await all("SELECT room, id FROM chat_files WHERE room IN (" + old.map(() => "?").join(",") + ")", ...old.map(r => r.id)) : [];
      const q = old.flatMap(r => [...gone(r.id), st("INSERT OR REPLACE INTO chat_gone (id, until) VALUES (?, ?)", r.id, now + 30 * DAY)]);
      q.push(st("DELETE FROM chat_gone WHERE until < ?", now), st("DELETE FROM chat_uploads WHERE day < ?", Math.floor(now / DAY) - 2));
      await db.batch(q);
      return { rooms: old.map(r => r.id), files: files.map(f => f.room + "/" + f.id) };
    }
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
async function readBody(request) {
  try { const b = JSON.parse((await request.text()).slice(0, 8192)); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}

/** Every minute: rooms whose reminder ended more than a day ago are deleted, with everything in them. */
export async function cleanChats(env, now = Date.now(), deps = {}) {
  if (!env.DB && !deps.store) return 0;
  const store = deps.store || chatStore(env.DB), bucket = deps.files || env.CHAT_FILES;
  await store.ready();
  const { rooms, files } = await store.clean(now);
  if (bucket && files.length) for (let i = 0; i < files.length; i += 1000) await bucket.delete(files.slice(i, i + 1000));
  return rooms.length;
}
const dropFiles = async (bucket, room, ids) => { if (bucket && ids.length) await bucket.delete(ids.map(id => room + "/" + id)); };

export async function handleChat(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Chat isn't set up on this server." }, 503);
  const store = deps.store || chatStore(env.DB), now = deps.now || Date.now(), bucket = deps.files || env.CHAT_FILES;
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(3); // ["<room>", "post"], ["<room>", "file", "<id>"] or ["inbox"]

  // A file back: the scrambled bytes, never cached, never run as anything.
  if (request.method === "GET" && parts.length === 3 && parts[1] === "file") {
    const [id, , fid] = parts;
    if (!ROOM.test(id) || !FILE.test(fid) || !bucket) return json({ error: "Not found." }, 404);
    await store.ready();
    const room = await store.room(id);
    if (await store.isGone(id) || (room && room.ends < now - LIMITS.after)) return json({ ended: true }, 410);
    if (!room) return json({ error: "Not found." }, 404);
    if (!await store.file(id, fid)) return json({ error: "Not found." }, 404);
    const obj = await bucket.get(id + "/" + fid);
    if (!obj) return json({ error: "Not found." }, 404);
    return new Response(obj.body, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox", "content-disposition": "attachment" } });
  }
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  await store.ready();

  // A file in: signed-in accounts only, a few a day, small, and only into a room that exists.
  if (parts.length === 2 && parts[1] === "file") {
    const id = parts[0], me = url.searchParams.get("me") || "";
    if (!ROOM.test(id)) return json({ error: "Not found." }, 404);
    if (!bucket) return json({ error: "Photos and voice notes aren't set up on this server." }, 503);
    const accounts = deps.accounts || d1Store(env.DB);
    const s = await signedIn(request, accounts, now);
    if (!s) return json({ error: "Sign in to send photos and voice notes.", need: "signin" }, 401);
    if (await store.isGone(id)) return json({ ended: true }, 410);
    const room = await store.room(id);
    if (!room) return json({ error: "Say something first." }, 404);
    if (room.ends < now - LIMITS.after) return json({ ended: true }, 410);
    if (!ME.test(me) || !(await store.people(id)).some(p => p.me === me)) return json({ error: "Say something first." }, 403);
    const len = Number(request.headers.get("content-length") || 0);
    if (len > LIMITS.fileBytes) return json({ error: "That file is too big." }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length < 29 || bytes.length > LIMITS.fileBytes) return json({ error: bytes.length < 29 ? "That file is empty." : "That file is too big." }, bytes.length < 29 ? 400 : 413);
    if (await store.fileCount(id) >= LIMITS.files) return json({ error: "This chat is full. It holds " + LIMITS.files + " photos and voice notes." }, 403);
    if (await store.upload(s.user.id, Math.floor(now / DAY)) > LIMITS.perDay) return json({ error: "That's " + LIMITS.perDay + " photos and voice notes today. Try again tomorrow." }, 429);
    const fid = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    await bucket.put(id + "/" + fid, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
    await store.addFile({ id: fid, room: id, at: now, size: bytes.length });
    return json({ id: fid });
  }

  const body = await readBody(request);
  const endpoint = validEndpoint(body.endpoint) ? body.endpoint : null;
  if (parts.length === 1 && parts[0] === "inbox") return json({ rooms: endpoint ? await store.takeInbox(endpoint) : [] });
  const [id, act] = parts;
  if (parts.length !== 2 || !ROOM.test(id)) return json({ error: "Not found." }, 404);
  const ended = () => json({ ended: true, msgs: [] }, 410);
  if (await store.isGone(id)) return ended();
  let room = await store.room(id);
  if (room && room.ends < now - LIMITS.after) return ended();

  if (act === "read") {
    const since = Number(body.since) || 0;
    if (!room) return json({ ends: null, msgs: [] });
    return json({ ends: room.ends + LIMITS.after, msgs: await store.since(id, since) });
  }
  if (act === "end") { if (room) { const ids = await store.fileIds(id); await store.end(id, room.ends + 30 * DAY); await dropFiles(bucket, id, ids); } return json({ ended: true }); }

  const me = ME.test(body.me || "") ? body.me : null;
  if (!me) return json({ error: "Missing who you are in this chat." }, 400);
  const people = room ? await store.people(id) : [];
  const known = people.some(p => p.me === me);

  if (act === "watch") {
    if (!room) return json({ error: "There's nothing in this chat yet." }, 404);
    if (!known && body.on) {
      if (people.length >= LIMITS.people) return json({ error: "This chat is full. It holds " + LIMITS.people + " people." }, 403);
      await store.join(id, me);
    }
    if (body.on && endpoint) await store.watch(id, me, endpoint); else await store.unwatch(id, me);
    return json({ watching: !!(body.on && endpoint) });
  }
  if (act === "post") {
    const text = typeof body.body === "string" ? body.body : "";
    if (!text || text.length > LIMITS.body || !BODY.test(text)) return json({ error: "That message is too long." }, 400);
    if (!room) {
      const ends = Math.min(Math.max(Number(body.ends) || 0, now), now + LIMITS.life);
      await store.makeRoom(id, ends, now);
      room = await store.room(id);
    }
    if (!known && people.length >= LIMITS.people) return json({ error: "This chat is full. It holds " + LIMITS.people + " people." }, 403);
    if (await store.count(id) >= LIMITS.messages) return json({ error: "This chat is full. It holds " + LIMITS.messages + " messages." }, 403);
    if (!known) await store.join(id, me);
    if (endpoint) await store.watch(id, me, endpoint);
    const tell = [...new Set(people.filter(p => p.me !== me && p.endpoint && p.endpoint !== endpoint).map(p => p.endpoint))];
    const m = { id: rid(), room: id, me, at: Math.max(now, 1), body: text };
    await store.add(m, tell, now);
    return json({ id: m.id, at: m.at, ends: room.ends + LIMITS.after });
  }
  return json({ error: "Not found." }, 404);
}
