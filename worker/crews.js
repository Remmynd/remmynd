// Crews: the people doing one shared reminder together. Each one joins with a first name, says "On my way",
// "Running late" or "Can't make it", and shows "Made it" when they do; anyone can send a friend kudos.
//
// The crew id is worked out on the device from the reminder's link (SHA-256, then cut to 22 characters), so this
// server never learns which reminder a crew is for: it keeps only the id, when it ends, and for each member a random
// public id, the first name they chose, their status and when, and their kudos count. A crew and everyone in it are
// deleted a day after the reminder ends. Joining needs a signed-in account; other members see only first names.
//
//   POST /api/crew/<id>/read   {}                    the crew: members (name, status, at, kudos, which one is you)
//   POST /api/crew/<id>/join   { name, ends }        join (or rename); makes the crew on first join
//   POST /api/crew/<id>/status { status }            way | late5 | late15 | cant | made | none
//   POST /api/crew/<id>/kudos  { to }                a kudos to a member (their public id), at most one per pair per 10 s
//   POST /api/crew/<id>/leave  {}
//   POST /api/crew/mine        {}                    kudos sent to you since you last asked, across your crews

import { signedIn, d1Store } from "./account.js";
import { tally } from "./numbers.js";

const DAY = 864e5;
export const CREW_LIMITS = { members: 30, name: 30, life: 400 * DAY, after: DAY, kudosGap: 10e3 };
export const STATUSES = ["way", "late5", "late15", "cant", "made", "none"];
const ID = /^[A-Za-z0-9_-]{22}$/, MID = /^[a-f0-9]{12}$/;

export const CREW_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, ends INTEGER NOT NULL, created INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS crew_members (crew TEXT NOT NULL, user_id TEXT NOT NULL, mid TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, kudos INTEGER NOT NULL DEFAULT 0, joined INTEGER NOT NULL, PRIMARY KEY (crew, user_id))",
  "CREATE INDEX IF NOT EXISTS crew_members_user ON crew_members (user_id)",
  "CREATE TABLE IF NOT EXISTS crew_kudos (crew TEXT NOT NULL, from_mid TEXT NOT NULL, to_mid TEXT NOT NULL, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS crew_kudos_to ON crew_kudos (to_mid, seen)",
];

let ready = null;
export function crewStore(db) {
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const st = (sql, ...a) => db.prepare(sql).bind(...a);
  const drop = id => [st("DELETE FROM crew_kudos WHERE crew = ?", id), st("DELETE FROM crew_members WHERE crew = ?", id), st("DELETE FROM crews WHERE id = ?", id)];
  return {
    ready: () => (ready ||= db.batch(CREW_SCHEMA.map(s => db.prepare(s))).catch(e => { ready = null; throw e; })),
    crew: id => one("SELECT * FROM crews WHERE id = ?", id),
    make: (id, ends, now) => st("INSERT OR IGNORE INTO crews (id, ends, created) VALUES (?, ?, ?)", id, ends, now).run(),
    members: id => all("SELECT * FROM crew_members WHERE crew = ? ORDER BY joined", id),
    member: (id, user) => one("SELECT * FROM crew_members WHERE crew = ? AND user_id = ?", id, user),
    put: m => st("INSERT INTO crew_members (crew, user_id, mid, name, status, at, kudos, joined) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT (crew, user_id) DO UPDATE SET name = excluded.name",
      m.crew, m.user_id, m.mid, m.name, m.status, m.at, m.joined).run(),
    status: (id, user, status, at) => st("UPDATE crew_members SET status = ?, at = ? WHERE crew = ? AND user_id = ?", status, at, id, user).run(),
    leave: (id, user) => st("DELETE FROM crew_members WHERE crew = ? AND user_id = ?", id, user).run(),
    lastKudos: async (id, from, to) => ((await one("SELECT MAX(at) AS at FROM crew_kudos WHERE crew = ? AND from_mid = ? AND to_mid = ?", id, from, to)) || {}).at || 0,
    kudos: (id, from, to, at) => db.batch([st("INSERT INTO crew_kudos (crew, from_mid, to_mid, at) VALUES (?, ?, ?, ?)", id, from, to, at), st("UPDATE crew_members SET kudos = kudos + 1 WHERE crew = ? AND mid = ?", id, to)]),
    inbox: async user => {
      const mine = await all("SELECT crew, mid FROM crew_members WHERE user_id = ?", user);
      if (!mine.length) return [];
      const mids = mine.map(m => m.mid);
      const rows = await all("SELECT k.crew, k.from_mid, k.at, m.name FROM crew_kudos k LEFT JOIN crew_members m ON m.crew = k.crew AND m.mid = k.from_mid WHERE k.seen = 0 AND k.to_mid IN (" + mids.map(() => "?").join(",") + ") ORDER BY k.at", ...mids);
      if (rows.length) await st("UPDATE crew_kudos SET seen = 1 WHERE seen = 0 AND to_mid IN (" + mids.map(() => "?").join(",") + ")", ...mids).run();
      return rows;
    },
    clean: async now => {
      const old = await all("SELECT id FROM crews WHERE ends < ? LIMIT 100", now - CREW_LIMITS.after);
      if (old.length) await db.batch(old.flatMap(r => drop(r.id)));
      return old.length;
    },
    deleteUser: user => st("DELETE FROM crew_members WHERE user_id = ?", user).run(),
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const mid = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");
async function readBody(request) {
  try { const b = JSON.parse((await request.text()).slice(0, 4096)); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}
/** A first name: one line, no more than 30 characters. */
export function cleanName(v) { return String(v || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, CREW_LIMITS.name); }

/** Every minute: crews whose reminder ended more than a day ago go, with everyone in them. */
export async function cleanCrews(env, now = Date.now(), deps = {}) {
  if (!env.DB && !deps.store) return 0;
  const store = deps.store || crewStore(env.DB);
  await store.ready();
  return store.clean(now);
}

const view = (m, me) => ({ id: m.mid, name: m.name, status: m.status, at: m.at, kudos: m.kudos, ...(m.user_id === me ? { me: true } : {}) });

export async function handleCrew(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Crews aren't set up on this server." }, 503);
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const store = deps.store || crewStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const s = await signedIn(request, deps.accounts || d1Store(env.DB), now);
  if (!s) return json({ error: "Sign in to join a crew.", need: "signin" }, 401);
  const user = s.user.id;
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(3);
  const body = await readBody(request);

  if (parts.length === 1 && parts[0] === "mine") {
    const rows = await store.inbox(user);
    return json({ kudos: rows.map(r => ({ crew: r.crew, from: r.name || "Someone", at: r.at })) });
  }
  const [id, act] = parts;
  if (parts.length !== 2 || !ID.test(id)) return json({ error: "Not found." }, 404);
  let crew = await store.crew(id);
  if (crew && crew.ends < now - CREW_LIMITS.after) return json({ ended: true, members: [] }, 410);
  const out = async () => { const ms = await store.members(id); return json({ ends: crew ? crew.ends + CREW_LIMITS.after : null, members: ms.map(m => view(m, user)) }); };

  if (act === "read") return out();
  if (act === "join") {
    const name = cleanName(body.name);
    if (!name) return json({ error: "Add your first name so the crew knows it's you." }, 400);
    if (!crew) {
      const ends = Math.min(Math.max(Number(body.ends) || 0, now), now + CREW_LIMITS.life);
      await store.make(id, ends, now);
      crew = await store.crew(id);
      await tally(env, "crew.started", 1, now);
    }
    const was = await store.member(id, user);
    if (!was && (await store.members(id)).length >= CREW_LIMITS.members) return json({ error: "This crew is full. It holds " + CREW_LIMITS.members + " people." }, 403);
    await store.put({ crew: id, user_id: user, mid: was ? was.mid : mid(), name, status: was ? was.status : "none", at: was ? was.at : now, joined: was ? was.joined : now });
    if (!was) await tally(env, "crew.joined", 1, now);
    return out();
  }
  if (!crew) return json({ error: "There's no crew here yet." }, 404);
  const me = await store.member(id, user);
  if (!me) return json({ error: "Join the crew first." }, 403);
  if (act === "status") {
    if (!STATUSES.includes(body.status)) return json({ error: "That isn't a status." }, 400);
    await store.status(id, user, body.status, now);
    if (body.status === "made") await tally(env, "crew.made", 1, now);
    return out();
  }
  if (act === "kudos") {
    const to = String(body.to || "");
    if (!MID.test(to) || to === me.mid) return json({ error: "Pick someone else in the crew." }, 400);
    if (!(await store.members(id)).some(m => m.mid === to)) return json({ error: "They aren't in this crew." }, 404);
    if (now - await store.lastKudos(id, me.mid, to) < CREW_LIMITS.kudosGap) return json({ error: "Give it a few seconds." }, 429);
    await store.kudos(id, me.mid, to, now);
    await tally(env, "crew.kudos", 1, now);
    return out();
  }
  if (act === "leave") { await store.leave(id, user); return json({ left: true }); }
  return json({ error: "Not found." }, 404);
}
