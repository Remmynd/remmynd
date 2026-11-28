// Last one standing: a challenge like "7am club, 21 days". Anyone with the link joins before it starts (or on day
// one, before the deadline); each day you check in before the deadline, in the challenge's own time zone; miss a day
// and you're out. Everyone sees how many started and how many are still standing, and the first names of the people
// in it. The public page (/x/<code>) shows only the counts.
//
//   POST /api/challenge/new          { title, days, deadline: "HH:MM", tz, start: "YYYY-MM-DD" }   make one (signed in)
//   POST /api/challenge/<code>/read  {}           the challenge, today, and everyone in it (signed in: which one is you)
//   POST /api/challenge/<code>/join  { name }
//   POST /api/challenge/<code>/checkin {}         today's check-in, before the deadline
//   POST /api/challenge/<code>/leave {}
//   POST /api/challenge/mine         {}           the challenges you're in
//   GET  /x/<code>                   the public page: title, day, started and still standing, Join in the app
//
// Kept: the title, length, deadline and time zone the maker chose, and for each person the first name they chose and
// the days they checked in. Deleted a week after the challenge ends.

import { ogImageURL, ogImageTags } from "./ogimage.js";
import { signedIn, d1Store } from "./account.js";
import { planFor, proNeeded, FREE } from "./pro.js";
import { tally } from "./numbers.js";
import { escapeHTML as esc } from "./preview.js";

const DAY = 864e5;
export const CHALLENGE_LIMITS = { title: 60, name: 30, minDays: 3, maxDays: 100, members: 500, perUser: 10, aheadDays: 60, keepDays: 7 };
export const LENGTHS = [7, 14, 21, 30];
const CODE = /^[a-z0-9]{8}$/, HHMM = /^([01]\d|2[0-3]):[0-5]\d$/, DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CHALLENGE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS challenge_runs (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, days INTEGER NOT NULL, deadline TEXT NOT NULL, tz TEXT NOT NULL, start TEXT NOT NULL, ends INTEGER NOT NULL, created INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS challenge_people (code TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, joined INTEGER NOT NULL, PRIMARY KEY (code, user_id))",
  "CREATE INDEX IF NOT EXISTS challenge_people_user ON challenge_people (user_id)",
  "CREATE TABLE IF NOT EXISTS challenge_days (code TEXT NOT NULL, user_id TEXT NOT NULL, day INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, user_id, day))",
];

let ready = null;
export function challengeStore(db) {
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const st = (sql, ...a) => db.prepare(sql).bind(...a);
  return {
    ready: () => (ready ||= db.batch(CHALLENGE_SCHEMA.map(s => db.prepare(s))).catch(e => { ready = null; throw e; })),
    get: code => one("SELECT * FROM challenge_runs WHERE code = ?", code),
    make: c => st("INSERT INTO challenge_runs (code, user_id, title, days, deadline, tz, start, ends, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", c.code, c.user_id, c.title, c.days, c.deadline, c.tz, c.start, c.ends, c.created).run(),
    madeBy: async (user, now) => ((await one("SELECT COUNT(*) AS n FROM challenge_runs WHERE user_id = ? AND ends > ?", user, now)) || {}).n || 0,
    people: code => all("SELECT * FROM challenge_people WHERE code = ? ORDER BY joined", code),
    person: (code, user) => one("SELECT * FROM challenge_people WHERE code = ? AND user_id = ?", code, user),
    join: p => st("INSERT INTO challenge_people (code, user_id, name, joined) VALUES (?, ?, ?, ?) ON CONFLICT (code, user_id) DO UPDATE SET name = excluded.name", p.code, p.user_id, p.name, p.joined).run(),
    leave: (code, user) => db.batch([st("DELETE FROM challenge_days WHERE code = ? AND user_id = ?", code, user), st("DELETE FROM challenge_people WHERE code = ? AND user_id = ?", code, user)]),
    days: code => all("SELECT user_id, day FROM challenge_days WHERE code = ?", code),
    checkin: (code, user, day, at) => st("INSERT OR IGNORE INTO challenge_days (code, user_id, day, at) VALUES (?, ?, ?, ?)", code, user, day, at).run(),
    mine: user => all("SELECT c.* FROM challenge_runs c JOIN challenge_people p ON p.code = c.code WHERE p.user_id = ? ORDER BY c.ends", user),
    clean: async now => {
      const old = await all("SELECT code FROM challenge_runs WHERE ends < ? LIMIT 100", now - CHALLENGE_LIMITS.keepDays * DAY);
      if (old.length) await db.batch(old.flatMap(r => ["challenge_days", "challenge_people"].map(t => st("DELETE FROM " + t + " WHERE code = ?", r.code)).concat(st("DELETE FROM challenge_runs WHERE code = ?", r.code))));
      return old.length;
    },
    deleteUser: user => db.batch([st("DELETE FROM challenge_days WHERE user_id = ?", user), st("DELETE FROM challenge_people WHERE user_id = ?", user)]),
  };
}

// ---------- days and deadlines, in the challenge's own time zone ----------

/** The local date ("YYYY-MM-DD") and minutes past midnight at `now`, in `tz`. */
export function localNow(tz, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { date: parts.year + "-" + parts.month + "-" + parts.day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const dayNumber = date => Math.round(Date.parse(date + "T00:00:00Z") / DAY);
export const addDays = (date, n) => new Date((dayNumber(date) + n) * DAY).toISOString().slice(0, 10);
const deadlineMinutes = d => Number(d.slice(0, 2)) * 60 + Number(d.slice(3));

/** The moment of a day's deadline, in ms: found by walking from the UTC guess to the local clock. */
export function deadlineAt(c, index) {
  const date = addDays(c.start, index), want = deadlineMinutes(c.deadline);
  let t = Date.parse(date + "T" + c.deadline + ":00Z");
  for (let i = 0; i < 3; i++) {
    const l = localNow(c.tz, t);
    const diff = (dayNumber(date) - dayNumber(l.date)) * 1440 + (want - l.minutes);
    if (!diff) break;
    t += diff * 60e3;
  }
  return t;
}

/** Where the challenge is today: its day index (0 = the first day), and whether today's check-in is still open. */
export function today(c, now) {
  const l = localNow(c.tz, now);
  const index = dayNumber(l.date) - dayNumber(c.start);
  const open = index >= 0 && index < c.days && l.minutes < deadlineMinutes(c.deadline);
  return { index, open, deadline: index >= 0 && index < c.days ? deadlineAt(c, index) : null, started: index >= 0, over: index >= c.days || (index === c.days - 1 && !open) };
}

/** One person's run: days kept, whether they're out (and on which day), and whether they finished. */
export function standing(c, kept, now) {
  const t = today(c, now);
  // The days whose deadline has passed: every one of them needed a check-in.
  const due = Math.min(c.days, t.index + (t.open || t.index < 0 ? 0 : 1));
  let out = null;
  for (let d = 0; d < due; d++) if (!kept.has(d)) { out = d; break; }
  return { kept: kept.size, out, done: out === null && due >= c.days, today: kept.has(t.index) };
}

// ---------- the API ----------

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const code = () => { const a = crypto.getRandomValues(new Uint8Array(8)), abc = "abcdefghjkmnpqrstuvwxyz023456789"; return [...a].map(x => abc[x & 31]).join(""); };
const line = (v, n) => String(v || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const isZone = tz => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
async function readBody(request) { try { const b = JSON.parse((await request.text()).slice(0, 4096)); return b && typeof b === "object" ? b : {}; } catch { return {}; } }

/** The challenge as people in it see it. */
export async function view(store, c, user, now) {
  const people = await store.people(c.code), days = await store.days(c.code);
  const by = new Map(people.map(p => [p.user_id, new Set()]));
  for (const d of days) if (by.has(d.user_id)) by.get(d.user_id).add(d.day);
  const t = today(c, now);
  const members = people.map(p => ({ name: p.name, ...standing(c, by.get(p.user_id), now), ...(p.user_id === user ? { me: true } : {}) }));
  const left = members.filter(m => m.out === null).length;
  return { code: c.code, title: c.title, days: c.days, deadline: c.deadline, tz: c.tz, start: c.start, today: t,
    started: members.length, standing: left, mine: c.user_id === user, members: members.sort((a, b) => (a.out === null) === (b.out === null) ? b.kept - a.kept : a.out === null ? -1 : 1) };
}

/** Every minute: challenges that ended a week ago go, with everyone's days. */
export async function cleanChallenges(env, now = Date.now(), deps = {}) {
  if (!env.DB && !deps.store) return 0;
  const store = deps.store || challengeStore(env.DB);
  await store.ready();
  return store.clean(now);
}

export async function handleChallenge(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Challenges aren't set up on this server." }, 503);
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const store = deps.store || challengeStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const accounts = deps.accounts || d1Store(env.DB);
  const s = await signedIn(request, accounts, now);
  if (!s) return json({ error: "Sign in to take part.", need: "signin" }, 401);
  const user = s.user.id, body = await readBody(request);
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(3);

  if (parts.length === 1 && parts[0] === "new") {
    const title = line(body.title, CHALLENGE_LIMITS.title);
    if (!title) return json({ error: "Give it a name, like “7am club”." }, 400);
    const days = Math.round(Number(body.days));
    if (!(days >= CHALLENGE_LIMITS.minDays && days <= CHALLENGE_LIMITS.maxDays)) return json({ error: "A challenge runs from 3 to 100 days." }, 400);
    if (!HHMM.test(String(body.deadline || ""))) return json({ error: "Pick the time to check in by." }, 400);
    const tz = isZone(body.tz) ? body.tz : "UTC";
    const todayDate = localNow(tz, now).date;
    const start = DATE.test(String(body.start || "")) ? body.start : addDays(todayDate, 1);
    const gap = dayNumber(start) - dayNumber(todayDate);
    if (gap < 0 || gap > CHALLENGE_LIMITS.aheadDays) return json({ error: "Start it today or within the next 60 days." }, 400);
    const running = await store.madeBy(user, now);
    // Free: one challenge you started at a time (joining others' is never limited). Pro: up to perUser.
    if ((await planFor(env, accounts, s.user, now)).limited && running >= FREE.challenges)
      return proNeeded("The free plan runs " + FREE.challenges + " challenge you started at a time. Pro runs up to " + CHALLENGE_LIMITS.perUser + ".", FREE.challenges);
    if (running >= CHALLENGE_LIMITS.perUser) return json({ error: "That's " + CHALLENGE_LIMITS.perUser + " challenges running. Wait for one to end." }, 429);
    const c = { code: code(), user_id: user, title, days, deadline: body.deadline, tz, start, created: now };
    c.ends = deadlineAt(c, days - 1);
    if (gap === 0 && !today(c, now).open) return json({ error: "Today's check-in time has passed. Start it tomorrow." }, 400);
    await store.make(c);
    await store.join({ code: c.code, user_id: user, name: line(body.name, CHALLENGE_LIMITS.name) || "Host", joined: now });
    await tally(env, "challenge.started", 1, now);
    return json(await view(store, c, user, now));
  }
  if (parts.length === 1 && parts[0] === "mine") {
    const list = await store.mine(user);
    return json({ challenges: await Promise.all(list.map(c => view(store, c, user, now))) });
  }
  const [cd, act] = parts;
  if (parts.length !== 2 || !CODE.test(cd || "")) return json({ error: "Not found." }, 404);
  const c = await store.get(cd);
  if (!c) return json({ error: "There's no challenge at this link." }, 404);
  const me = await store.person(cd, user);

  if (act === "read") return json(await view(store, c, user, now));
  if (act === "join") {
    const name = line(body.name, CHALLENGE_LIMITS.name);
    if (!name) return json({ error: "Add your first name, so everyone knows it's you." }, 400);
    const t = today(c, now);
    if (!me && (t.index > 0 || (t.index === 0 && !t.open))) return json({ error: "This challenge has started. Joining closes at the first day's check-in." }, 403);
    if (!me && (await store.people(cd)).length >= CHALLENGE_LIMITS.members) return json({ error: "This challenge is full." }, 403);
    await store.join({ code: cd, user_id: user, name, joined: me ? me.joined : now });
    if (!me) await tally(env, "challenge.joined", 1, now);
    return json(await view(store, c, user, now));
  }
  if (!me) return json({ error: "Join the challenge first." }, 403);
  if (act === "checkin") {
    const t = today(c, now);
    if (t.index < 0) return json({ error: "It hasn't started yet. The first check-in is on " + c.start + "." }, 400);
    if (!t.open) return json({ error: t.index >= c.days ? "This challenge is over." : "Today's check-in closed at " + c.deadline + "." }, 400);
    const days = new Set((await store.days(cd)).filter(d => d.user_id === user).map(d => d.day));
    if (standing(c, days, now).out !== null) return json({ error: "You're out of this one. Start your own and go again." }, 400);
    await store.checkin(cd, user, t.index, now);
    await tally(env, "challenge.checkin", 1, now);
    return json(await view(store, c, user, now));
  }
  if (act === "leave") { await store.leave(cd, user); return json({ left: true }); }
  return json({ error: "Not found." }, 404);
}

/** The card for the challenge's live picture (worker/og.js), or null when there's no such challenge. Counts only, no names. */
export async function challengeCard(env, cd, deps = {}) {
  if (!CODE.test(cd) || (!env.DB && !deps.store)) return null;
  const store = deps.store || challengeStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const c = await store.get(cd);
  if (!c) return null;
  const v = await view(store, c, null, now), t = v.today;
  return { theme: "dark", eye: "Last one standing", title: c.title, line: "Check in by " + c.deadline + " every day (" + c.tz.replace(/_/g, " ") + ")",
    big: t.index < 0 ? "Starts " + c.start : t.over ? "Finished" : "Day " + (t.index + 1) + " of " + c.days, tone: t.over ? "quiet" : "",
    stats: [{ n: v.started, label: "started" }, { n: v.standing, label: "still in" }, { n: c.days, label: "days" }] };
}

/** The public page: the name, where it's up to, how many started and how many are still standing. No names. */
export async function challengePage(request, env, url, deps = {}) {
  const cd = url.pathname.split("/")[2] || "";
  const notFound = () => new Response(shell("Not found · remmynd", "<h1>There's no challenge here</h1><p>The link may be wrong, or it ended more than a week ago.</p>"), { status: 404, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
  if (!CODE.test(cd) || (!env.DB && !deps.store)) return notFound();
  const store = deps.store || challengeStore(env.DB), now = deps.now || Date.now();
  await store.ready();
  const c = await store.get(cd);
  if (!c) return notFound();
  const v = await view(store, c, null, now), t = v.today;
  const where = t.index < 0 ? "Starts " + c.start : t.over ? "Finished" : "Day " + (t.index + 1) + " of " + c.days;
  const body = '<p class="ch-eye">Last one standing</p><h1>' + esc(c.title) + '</h1>' +
    '<p class="ch-where">' + esc(where) + ' · check in by ' + esc(c.deadline) + ' every day (' + esc(c.tz.replace(/_/g, " ")) + ')</p>' +
    '<div class="ch-nums"><div><b>' + v.started + '</b><span>started</span></div><div><b>' + v.standing + '</b><span>still standing</span></div><div><b>' + c.days + '</b><span>days</span></div></div>' +
    (t.index <= 0 && !(t.index === 0 && !t.open) ? '<p><a class="ch-btn" href="https://remmynd.space/x/' + esc(cd) + '">Join in the remmynd app</a></p><p class="ch-small">Open this link on your iPhone with remmynd installed. Miss a day and you\'re out.</p>'
      : '<p class="ch-small">Joining has closed. Start your own in the remmynd app.</p>');
  const image = ogImageTags(ogImageURL(url.origin, "/x/" + cd, now), c.title + ": " + where + ", " + v.standing + " still standing", esc);
  return new Response(shell(c.title + " · remmynd", body, image), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'" } });
}

function shell(title, body, head = "") {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title>' +
    '<meta property="og:title" content="' + esc(title) + '">' + head + '<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0B0B0B;color:#fff;padding:40px 16px}' +
    '.w{max-width:480px;margin:0 auto}.ch-eye{color:#FFB52E;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px}h1{font-size:44px;line-height:1.05;margin:8px 0 12px}' +
    '.ch-where{color:#bbb}.ch-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:28px 0}.ch-nums div{background:#1a1a1a;border-radius:16px;padding:16px}' +
    '.ch-nums b{display:block;font-size:34px;color:#FFB52E;font-variant-numeric:tabular-nums}.ch-nums span{color:#aaa;font-size:14px}' +
    '.ch-btn{display:inline-block;background:#FFB52E;color:#0B0B0B;font-weight:700;text-decoration:none;padding:16px 24px;border-radius:16px}.ch-small{color:#999;font-size:14px}a{color:#FFB52E}</style>' +
    '<body><div class="w">' + body + '<p class="ch-small" style="margin-top:40px"><a href="/">remmynd</a> · reminders that make sure it happens</p></div></body></html>';
}
