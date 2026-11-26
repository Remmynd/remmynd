// Host pages: a public page per host at /@handle, and a page per launch at /@handle/<slug>, with a big ticking
// countdown, Remind me, Add to calendar, and a button that sends people to the launch the moment it goes live.
//
// A host is a signed-in account that claimed a handle. A launch lives on the server (so later it can move, and its
// followers can be told); its Remind me is an ordinary shared link (/r/…), made from the launch as it is now.
//
// Pages (HTML, drawn here so they're right before any script runs; public/at.js keeps the clock going):
//   GET /@handle             the host: name, line, link, the next launch with its countdown, then the rest
//   GET /@handle/<slug>      one launch
// API (JSON, signed in, this site only, never cached):
//   GET  /api/host                    the account's handle, profile and launches
//   POST /api/host { handle, name, bio, link }                     claim or change the handle and profile
//   POST /api/host/launch { id?, title, start, dur, tz, dest, count }   publish a launch, or change one
//   POST /api/host/launch/delete { id }
//   POST /api/host/launch/nudge { id, text }   Pro: a message to everyone who saved it, 2 per launch, an hour apart
//   POST /api/host/brand { color }    Pro: the accent colour of the host's pages, one of BRAND_COLORS ("" for remmynd's)
//   POST /api/launch/go { id }        public, this site only: someone tapped "It's live: go now" (a number per launch and day)
//
// Plans (worker/pro.js planOf): once Pro is on offer, a free host has one live launch at a time, can't move or rename
// a launch after someone saved it, reaches their first 100 followers, sees only the saved count, and their pages
// carry a "Made with remmynd" line. Pro lifts all of that and adds an accent colour. Before Pro is on offer, nobody
// is limited. Every check is here, from the account's own Pro status.
//   GET  /api/launch?ids=a,b,c        public: what each launch is now (time, title, link), or that it was cancelled.
//                                     Devices that saved a launch ask this to follow a change; it says nothing about who asks.
//
// Following a change: when a host moves, renames or cancels a launch, every alert waiting for it (worker/push.js
// keeps which launch an alert is for, and nothing else) is pinged at once; each device then asks /api/launch,
// moves or drops its own alerts and says what changed. Signed-in accounts' synced copies and emails move here.
//
// What is public: the handle, name, line and link the host gives, and the launches they publish. Nothing else.
import { signedIn, d1Store, mailsFor } from "./account.js";
import { encode, googleCalendarUrl, LAUNCH_ID } from "../lib/remmynd.js";
import { escapeHTML as esc } from "./preview.js";
import { readCount } from "./count.js";
import { tally } from "./numbers.js";
import { planOf, FREE } from "./pro.js";
import { ogImageURL, inText } from "./ogimage.js";

export const HANDLE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
/** Words the site uses, or that would look like it speaks for remmynd. */
export const RESERVED = new Set(("about account admin api app apps at auth b blog cal calls changelog count docs download embed " +
  "help home host hosts install ios android launch launches login logout mcp me new news open press pricing privacy pro push r " +
  "remmynd roadmap root security settings share signin signup stats status support team terms why www zoof04 official staff").split(" "));
export const MAX_LAUNCHES = 50;
/** Accent colours a Pro host can pick: each one has a light and a dark shade in public/at.css that reads well. */
export const BRAND_COLORS = ["amber", "coral", "rose", "violet", "blue", "teal", "green", "graphite"];
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const needPro = (error, status = 402) => json({ error, need: "pro" }, status);
export const NUDGES = 2, NUDGE_GAP = 3600e3, WORDS = 120, NUDGE_TEXT = 140;
/** How many have saved a launch: devices holding its alerts, or its public count, whichever is more. */
export async function savedBy(env, store, id, deps = {}) {
  const holders = store.launchHolders ? await store.launchHolders(id) : 0;
  const counted = await readCount(env, encode({ title: "x", start: new Date(0), launch: id }), { store: deps.counts }).catch(() => 0);
  return Math.max(holders, counted);
}
const DAY = 864e5;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const isZone = z => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return !!z; } catch { return false; } };
const line = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** What's wrong with a handle, or null. */
export function handleProblem(h) {
  if (!HANDLE.test(h)) return "A handle is 3 to 30 letters, numbers, - or _, starting with a letter or number.";
  if (RESERVED.has(h)) return "That handle is reserved. Try another.";
  return null;
}

/** A web address to send people to: https or http only. "" when empty, null when it isn't one. */
export function safeLink(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  let u; try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password || s.length > 500) return null;
  return u.href;
}

/** A slug from a title, unique among the host's launches. */
export function slugFor(title, taken) {
  const base = String(title).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "launch";
  let s = base, n = 2;
  while (taken.has(s)) s = base + "-" + n++;
  return s;
}

/** The destination's name, for its button: "Product Hunt", "the App Store", or its address. */
export function destName(dest) {
  let h; try { h = new URL(dest).hostname.replace(/^www\./, ""); } catch { return ""; }
  const known = [[/(^|\.)producthunt\.com$/, "Product Hunt"], [/^apps\.apple\.com$/, "the App Store"], [/^play\.google\.com$/, "Google Play"],
    [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"], [/(^|\.)twitch\.tv$/, "Twitch"], [/^(x|twitter)\.com$/, "X"], [/^lu\.ma$|(^|\.)luma\.com$/, "Luma"],
    [/(^|\.)kickstarter\.com$/, "Kickstarter"], [/(^|\.)github\.com$/, "GitHub"], [/(^|\.)linkedin\.com$/, "LinkedIn"], [/(^|\.)zoom\.us$/, "Zoom"],
    [/^meet\.google\.com$/, "Google Meet"], [/(^|\.)eventbrite\.com$/, "Eventbrite"], [/(^|\.)gumroad\.com$/, "Gumroad"], [/(^|\.)substack\.com$/, "Substack"]];
  for (const [re, name] of known) if (re.test(h)) return name;
  return h;
}

/** "Fri, Dec 4 · 7:30 PM EST", in the launch's own zone; the year only when it isn't this year. */
export function whenText(start, tz, now = Date.now()) {
  const year = d => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(d);
  const d = new Date(start), withYear = year(d) !== year(new Date(now));
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  return day + " · " + time;
}

/** Before, live (from the start to the end) or ended. */
export const phaseOf = (l, now) => now >= l.start + l.dur * 60e3 ? "ended" : now >= l.start ? "live" : "before";

/** Days, hours, minutes and seconds left, as the clock shows them. */
export function clockParts(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor(t % 86400 / 3600), m: Math.floor(t % 3600 / 60), s: t % 60 };
}

/** Everything a launch page shows, and its links. */
export function launchView(host, l, origin) {
  const event = { title: l.title, start: new Date(l.start), durationMinutes: l.dur, location: l.dest, host: host.name || "@" + host.handle, timeZone: l.tz, count: !!l.count, launch: l.id };
  const payload = encode(event);
  return {
    id: l.id, slug: l.slug, title: l.title, start: l.start, dur: l.dur, tz: l.tz, dest: l.dest, count: !!l.count, ver: l.updated,
    url: origin + "/@" + host.handle + "/" + l.slug, link: origin + "/r/" + payload, payload,
    ics: "/ics?d=" + payload, google: googleCalendarUrl(event, { base: origin + "/" }), destName: destName(l.dest)
  };
}

/* ---------- the API ---------- */

function cleanProfile(body) {
  const handle = line(body.handle, 40).toLowerCase().replace(/^@/, "");
  const problem = handleProblem(handle);
  if (problem) return { problem };
  const link = safeLink(body.link);
  if (link === null) return { problem: "That link isn't a web address. Try one like yoursite.com." };
  return { handle, name: line(body.name, 60), bio: line(body.bio, 160), link };
}

function cleanLaunch(body, now) {
  const title = line(body.title, 120);
  if (!title) return { problem: "Give it a title, like “Demo Day”." };
  const start = Math.round(Number(body.start));
  if (!Number.isFinite(start) || start < now - 365 * DAY || start > now + 3 * 365 * DAY) return { problem: "Pick a date and time for it." };
  const dur = body.dur == null || body.dur === "" ? 60 : Math.round(Number(body.dur));
  if (!(dur >= 1 && dur <= 1440)) return { problem: "A launch can last from 1 minute to 24 hours." };
  const tz = isZone(body.tz) ? body.tz : "UTC";
  const dest = safeLink(body.dest);
  if (dest === null) return { problem: "That link isn't a web address. Try one like producthunt.com/posts/your-app." };
  return { title, start: Math.round(start / 60000) * 60000, dur, tz, dest, count: !!body.count };
}

/**
 * A launch changed or was cancelled: wake every device holding it, and move signed-in accounts' copies and emails.
 * `now` is the launch as it is now, or null when it was cancelled.
 */
export async function followChange(store, id, now, at, origin) {
  await store.wakeLaunch(id, at);
  for (const it of await store.itemsForLaunch(id)) {
    let d; try { d = JSON.parse(it.data); } catch { continue; }
    if (!d || d.launch !== id || d.state !== "held") continue;
    const next = now ? { ...d, title: now.title, start: now.start, dur: now.dur, place: now.dest, share: now.link, movedFrom: d.movedFrom || (d.start !== now.start ? d.start : undefined), ver: now.ver }
      : { ...d, state: "dropped", cancelled: at };
    await store.putItems(it.user_id, [{ kind: "reminder", key: it.key, data: JSON.stringify(next), deleted: false, updated: at }]);
    const user = await store.userById(it.user_id);
    await store.setMails(it.user_id, it.key, user && user.email_alerts ? mailsFor(next, at).map(m => ({ ...m, id: crypto.randomUUID().replace(/-/g, "").slice(0, 12) })) : []);
  }
}

/** GET /api/launch?ids=…: what each launch is now. Public, the same for everyone who asks, and never cached: a device
 * woken by a change must see it, not an answer from a minute ago. */
export async function launchStateResponse(request, env, url, deps = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Use GET." }, 405);
  if (!env.DB && !deps.store) return json({ launches: {} });
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").filter(x => LAUNCH_ID.test(x)))].slice(0, 50);
  const store = deps.store || d1Store(env.DB);
  await store.ready();
  const out = {};
  for (const l of await store.launchesByIds(ids)) {
    const v = launchView({ handle: l.handle, name: l.name }, l, url.origin);
    out[l.id] = { title: v.title, start: v.start, dur: v.dur, dest: v.dest, url: v.url, link: v.link, ver: v.ver };
  }
  for (const g of await store.goneByIds(ids.filter(i => !out[i]))) out[g.id] = { cancelled: true, title: g.title, at: g.at };
  return new Response(JSON.stringify({ launches: out }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function handleHost(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Accounts aren't set up on this server." }, 503);
  const store = deps.store || d1Store(env.DB), now = deps.now || Date.now();
  await store.ready();
  const path = url.pathname.replace(/\/+$/, "");
  const s = await signedIn(request, store, now), user = s ? s.user : null;
  const out = async () => {
    const host = await store.hostOf(user.id);
    if (!host) return { signedIn: true, host: null, launches: [] };
    const raw = await store.launchesOf(user.id), launches = raw.map(l => launchView(host, l, url.origin));
    const plan = await planOf(env, store, user, now), full = plan.pro || !plan.limited;
    // The numbers: the saved count for everyone; saves and "go now" taps by day for Pro (and for all before Pro is on offer).
    const stats = {};
    for (const l of raw) stats[l.id] = { saved: await savedBy(env, store, l.id, deps) };
    if (full && store.launchDays) {
      const since = dayOf(now - 29 * DAY);
      for (const r of await store.launchDays(raw.map(l => l.id), since)) { const s = stats[r.launch]; if (!s) continue; (s.days ||= []).push({ day: r.day, alerts: r.alerts, gos: r.gos }); s.alerts = (s.alerts || 0) + r.alerts; s.gos = (s.gos || 0) + r.gos; }
      for (const id in stats) { stats[id].days ||= []; stats[id].alerts ||= 0; stats[id].gos ||= 0; stats[id].days.sort((a, b) => a.day < b.day ? -1 : 1); }
    }
    const words = store.wordsOf ? await store.wordsOf(raw.map(l => l.id)) : new Map(), sent = store.sentOf ? await store.sentOf(raw.map(l => l.id)) : [];
    for (const v of launches) {
      v.words = words.get(v.id) || "";
      const n = sent.filter(s => s.launch === v.id && /^nudge/.test(s.kind)).sort((a, b) => a.at - b.at);
      v.nudges = { sent: n.map(s => ({ at: s.at, text: s.text, reached: s.reached })), left: Math.max(0, NUDGES - n.length), next: n.length ? n[n.length - 1].at + NUDGE_GAP : 0 };
    }
    const { firstMonthOffer } = await import("./pro.js");
    return { signedIn: true, plan: { ...plan, full, free: FREE, colors: BRAND_COLORS, discount: await firstMonthOffer(env, store, user, now) },
      host: { handle: host.handle, name: host.name, bio: host.bio, link: host.link, url: url.origin + "/@" + host.handle, followers: store.followCount ? await store.followCount(user.id) : 0, color: plan.pro && store.brandOf ? await store.brandOf(user.id) : "" },
      launches, stats };
  };
  if (path === "/api/host" && (request.method === "GET" || request.method === "HEAD")) return json(user ? await out() : { signedIn: false });
  // "It's live: go now" was tapped: one more for this launch today, while it's live. Public, this site only, says nothing about who.
  if (path === "/api/launch/go" && request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
    let id = ""; try { id = String((JSON.parse((await request.text()).slice(0, 512)) || {}).id || ""); } catch {}
    const [l] = LAUNCH_ID.test(id) && store.launchesByIds ? await store.launchesByIds([id]) : [];
    if (l && phaseOf(l, now) === "live" && store.addLaunchDay) await store.addLaunchDay(id, dayOf(now), "gos");
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  if (!user) return json({ error: "Sign in first." }, 401);
  let body = {};
  try { const b = JSON.parse((await request.text()).slice(0, 16384)); if (b && typeof b === "object") body = b; } catch {}

  if (path === "/api/host") {
    const p = cleanProfile(body);
    if (p.problem) return json({ error: p.problem }, 400);
    const mine = await store.hostOf(user.id), other = await store.hostByHandle(p.handle);
    if (other && other.user_id !== user.id) return json({ error: "That handle is taken. Try another." }, 409);
    await store.putHost({ user_id: user.id, ...p, created: mine ? mine.created : now, updated: now });
    if (!mine) await tally(env, "host.claimed", 1, now);
    return json(await out());
  }
  const host = await store.hostOf(user.id);
  if (!host) return json({ error: "Claim your page first." }, 400);
  const mine = await store.launchesOf(user.id), plan = await planOf(env, store, user, now);
  if (path === "/api/host/brand") {
    if (!plan.pro) return needPro("Your own colour comes with Pro.");
    const color = body.color === "" || body.color == null ? "" : String(body.color);
    if (color && !BRAND_COLORS.includes(color)) return json({ error: "Pick one of the colours." }, 400);
    await store.putBrand(user.id, color);
    return json(await out());
  }
  if (path === "/api/host/launch") {
    const l = cleanLaunch(body, now);
    if (l.problem) return json({ error: l.problem }, 400);
    const was = body.id ? mine.find(x => x.id === body.id) : null;
    if (body.id && !was) return json({ error: "That launch isn't yours, or it was deleted." }, 404);
    if (!was && mine.length >= MAX_LAUNCHES) return json({ error: "That's " + MAX_LAUNCHES + " launches. Delete an old one first." }, 429);
    if (plan.limited && !was && mine.filter(x => phaseOf(x, now) !== "ended").length >= FREE.live)
      return needPro("On the free plan you have one live launch at a time. Pro has no limit, or cancel the one you have.");
    const words = line(body.words, WORDS);
    if (words && !plan.pro && words !== ((was && store.wordsOf ? (await store.wordsOf([was.id])).get(was.id) : "") || "")) return needPro("Alerts in your words come with Pro.");
    const changes = was && (was.start !== l.start || was.dur !== l.dur || was.title !== l.title || was.dest !== l.dest);
    if (plan.limited && changes && await savedBy(env, store, was.id, deps) > 0)
      return needPro("People have saved this launch, so on the free plan it can't move or change now. Pro lets you change it any time, and everyone who saved it follows.");
    const id = was ? was.id : crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const slug = was ? was.slug : slugFor(l.title, new Set(mine.map(x => x.slug)));
    await store.putLaunch({ id, user_id: user.id, slug, ...l, created: was ? was.created : now, updated: now });
    if (store.putWords && (plan.pro || !words)) await store.putWords(id, words);
    // Changed what a saver relies on: the time, the length, the title or where it goes. They follow.
    const moved = was && (was.start !== l.start || was.dur !== l.dur || was.title !== l.title || was.dest !== l.dest);
    if (moved) await followChange(store, id, launchView(host, { ...was, ...l, id, slug, updated: now }, url.origin), now, url.origin);
    // A new launch, still to come: the host's followers hear about it (worker/follows.js).
    let told = 0;
    if (!was) await tally(env, "launch.published", 1, now);
    if (!was && l.start > now) { const { tellFollowers } = await import("./follows.js"); const t = await tellFollowers(store, host, { id, ...l }, "announce", now, plan.limited ? FREE.reach : Infinity); told = t.pushed + t.mailed; }
    return json({ ...(await out()), id, followed: !!moved, told });
  }
  if (path === "/api/host/launch/nudge") {
    if (!plan.pro) return needPro("Nudging everyone who saved it comes with Pro.");
    const l = mine.find(x => x.id === body.id);
    if (!l) return json({ error: "That launch isn't yours, or it was deleted." }, 404);
    if (phaseOf(l, now) === "ended") return json({ error: "This launch has happened, so there's no one left to nudge." }, 400);
    const text = line(body.text, NUDGE_TEXT);
    if (!text) return json({ error: "Write what you'd like them to read." }, 400);
    const done = (await store.sentOf([l.id])).filter(s => /^nudge/.test(s.kind)).sort((a, b) => a.at - b.at);
    if (done.length >= NUDGES) return json({ error: "You've sent both nudges for this launch." }, 429);
    if (done.length && now - done[done.length - 1].at < NUDGE_GAP) return json({ error: "Nudges go out at least an hour apart.", next: done[done.length - 1].at + NUDGE_GAP }, 429);
    const { tellSavers } = await import("./follows.js");
    const kind = "nudge" + (done.length + 1), reached = await tellSavers(store, l, kind, now);
    await store.markSent({ launch: l.id, kind, at: now, start: l.start, text, reached });
    await tally(env, "launch.nudge", 1, now);
    return json({ ...(await out()), reached });
  }
  if (path === "/api/host/launch/delete") {
    const gone = mine.find(x => x.id === body.id);
    if (!gone) return json({ error: "That launch isn't yours, or it was already deleted." }, 404);
    await store.deleteLaunch(user.id, body.id);
    // Whoever saved it hears it's cancelled; its page says so instead of vanishing.
    if (gone.start + gone.dur * 60e3 > now) {
      await store.putGone({ id: gone.id, user_id: user.id, slug: gone.slug, title: gone.title, at: now });
      await followChange(store, gone.id, null, now, url.origin);
    }
    return json(await out());
  }
  return json({ error: "Not found." }, 404);
}

/* ---------- the pages ---------- */

const two = n => String(n).padStart(2, "0");
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';
const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

function clockHTML(l, now) {
  const p = clockParts(l.start - now);
  const unit = (k, v, label) => '<span class="at-u"><b data-u="' + k + '">' + (k === "d" ? v : two(v)) + '</b><i>' + label + '</i></span>';
  return '<div class="at-clock" role="timer" aria-label="Time until it starts">' + unit("d", p.d, "days") + unit("h", p.h, "hours") + unit("m", p.m, "minutes") + unit("s", p.s, "seconds") + '</div>' +
    '<p class="at-state at-live-now">Live now</p><p class="at-state at-ended">This launch has happened.</p>';
}

/** Follow the host: the button and how many follow. public/at.js does the rest. */
export function followHTML(host, n) {
  const who = host.name || "@" + host.handle;
  return '<div class="at-follow-row"><button type="button" class="btn small at-follow" data-handle="' + esc(host.handle) + '" data-name="' + esc(who) + '" aria-pressed="false">' +
    '<span class="f-off">Follow ' + esc(who) + '</span><span class="f-on">Following</span></button><span class="at-followers" data-n="' + n + '">' + (n ? n.toLocaleString("en-US") + (n === 1 ? " follower" : " followers") : "") + '</span>' +
    '<p class="at-follow-note" role="status" hidden></p></div>';
}

/** One launch: the clock, the time, and what to do. `big` for its own page, compact on the host's page. */
export function launchHTML(host, l, v, now, { n = 0, big = true, followers = null } = {}) {
  const go = v.dest ? '<a class="btn at-go" href="' + esc(v.dest) + '" rel="noopener" target="_blank">' +
    '<span class="p-before">Go to ' + esc(v.destName) + '</span><span class="p-live">It\'s live: go now</span><span class="p-ended">Visit ' + esc(v.destName) + '</span>' + ARROW + '</a>' : "";
  const count = l.count && n > 0 ? '<p class="at-count"><b>' + n.toLocaleString("en-US") + '</b> ' + (n === 1 ? "person" : "people") + ' will be reminded</p>' : "";
  const title = big ? '<h1 class="at-title">' + esc(l.title) + '</h1>' : '<h2 class="at-title"><a href="' + esc(v.url) + '">' + esc(l.title) + '</a></h2>';
  return '<article class="at-launch' + (big ? " big" : "") + '" data-id="' + esc(l.id) + '" data-phase="' + phaseOf(l, now) + '" data-start="' + l.start + '" data-end="' + (l.start + l.dur * 60e3) + '">' +
    (big ? '<p class="at-by"><a href="/@' + esc(host.handle) + '">' + esc(host.name || "@" + host.handle) + '</a> is launching</p>' : "") + title +
    '<p class="at-when"><time datetime="' + new Date(l.start).toISOString() + '">' + esc(whenText(l.start, l.tz, now)) + '</time></p>' +
    clockHTML(l, now) + count +
    '<div class="at-actions"><a class="btn ink at-remind" href="' + esc("/r/" + v.payload) + '">' + BELL + 'Remind me</a>' + go + '</div>' +
    (big ? '<p class="at-more"><a href="' + esc(v.ics) + '">Add to Calendar</a><a href="' + esc(v.google) + '" rel="noopener" target="_blank">Google Calendar</a><button type="button" class="linkish at-share" data-url="' + esc(v.url) + '" data-title="' + esc(l.title) + '">Share</button></p>' : "") +
    (big && followers != null ? followHTML(host, followers) : "") +
    '</article>';
}

function hostHTML(host, launches, origin, now, followers = 0) {
  const views = launches.map(l => ({ l, v: launchView(host, l, origin) }));
  const upcoming = views.filter(x => phaseOf(x.l, now) !== "ended"), past = views.filter(x => phaseOf(x.l, now) === "ended").reverse();
  const head = '<header class="at-host"><h1>' + esc(host.name || "@" + host.handle) + '</h1><p class="at-handle">@' + esc(host.handle) + '</p>' +
    (host.bio ? '<p class="at-bio">' + esc(host.bio) + '</p>' : "") +
    (host.link ? '<p><a class="at-link" href="' + esc(host.link) + '" rel="noopener me" target="_blank">' + esc(host.link.replace(/^https?:\/\//, "").replace(/\/$/, "")) + '</a></p>' : "") + followHTML(host, followers) + '</header>';
  const next = upcoming[0] ? '<section aria-labelledby="at-next"><h2 class="label" id="at-next">' + (phaseOf(upcoming[0].l, now) === "live" ? "Live now" : "Next") + '</h2>' + launchHTML(host, upcoming[0].l, upcoming[0].v, now, { big: false }) + '</section>' : "";
  const row = x => '<li><a href="' + esc(x.v.url) + '"><b>' + esc(x.l.title) + '</b><time datetime="' + new Date(x.l.start).toISOString() + '">' + esc(whenText(x.l.start, x.l.tz, now)) + '</time></a></li>';
  const later = upcoming.length > 1 ? '<section aria-labelledby="at-later"><h2 class="label" id="at-later">Coming up</h2><ul class="at-list">' + upcoming.slice(1).map(row).join("") + '</ul></section>' : "";
  const before = past.length ? '<section aria-labelledby="at-past"><h2 class="label" id="at-past">Past launches</h2><ul class="at-list">' + past.slice(0, 20).map(row).join("") + '</ul></section>' : "";
  return head + (next || later || before ? next + later + before : '<p class="at-empty">No launches yet. Check back soon.</p>');
}

const NOT_FOUND = '<div class="at-missing"><h1>Not here</h1><p>There’s no page at this address. The handle may have changed, or the launch was taken down.</p><p><a class="btn ink" href="/launch">Make a launch countdown</a></p></div>';

/** The page, from public/at/index.html (our own template), with its text and preview tags filled in. */
export function fillPage(tpl, { title, description, canonical, html, image }) {
  const a = esc;
  if (image) tpl = tpl
    .replace(/(<meta property="og:image" content=")[^"]*"/, "$1" + a(image) + '"')
    .replace(/(<meta name="twitter:image" content=")[^"]*"/, "$1" + a(image) + '"')
    .replace(/(<meta property="og:image:alt" content=")[^"]*"/, "$1" + a(title) + '"');
  return tpl
    .replace(/<title>[^<]*<\/title>/, "<title>" + a(title) + "</title>")
    .replace(/(<meta name="description" content=")[^"]*"/, "$1" + a(description) + '"')
    .replace(/(<meta property="og:title" content=")[^"]*"/, "$1" + a(title) + '"')
    .replace(/(<meta property="og:description" content=")[^"]*"/, "$1" + a(description) + '"')
    .replace(/(<meta property="og:url" content=")[^"]*"/, "$1" + a(canonical) + '"')
    .replace(/(<meta name="twitter:title" content=")[^"]*"/, "$1" + a(title) + '"')
    .replace(/(<meta name="twitter:description" content=")[^"]*"/, "$1" + a(description) + '"')
    .replace(/(<link rel="canonical" href=")[^"]*"/, "$1" + a(canonical) + '"')
    .replace(/(<section class="sec at-wrap" id="at">)[\s\S]*?(<\/section>\s*<\/main>)/, (_, open, close) => open + html + close);
}

async function page(env, url, { status = 200, ...fill }) {
  const tpl = await env.ASSETS.fetch(new Request(new URL("/at", url)));
  const res = new Response(fillPage(await tpl.text(), fill), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  for (const h of ["content-security-policy", "permissions-policy", "referrer-policy", "x-content-type-options", "x-frame-options", "strict-transport-security"]) { const v = tpl.headers.get(h); if (v) res.headers.set(h, v); }
  if (status !== 200) res.headers.set("x-robots-tag", "noindex");
  return res;
}

/**
 * The card for the live picture of /@handle or /@handle/<slug> (worker/og.js), or null when there's no such page.
 * A host's own page shows their next launch; a launch shows its state, saves and the host's followers.
 */
export async function hostCard(env, handle, slug, deps = {}) {
  if (!env.DB && !deps.store) return null;
  const store = deps.store || d1Store(env.DB), now = deps.now || Date.now();
  await store.ready();
  const host = HANDLE.test(handle) ? await store.hostByHandle(handle) : null;
  if (!host) return null;
  const launches = await store.launchesOf(host.user_id), who = host.name || "@" + host.handle;
  const followers = store.followCount ? await store.followCount(host.user_id) : 0;
  const l = slug ? launches.find(x => x.slug === slug) : launches.find(x => phaseOf(x, now) !== "ended");
  if (slug && !l) return null;
  const fans = followers >= 10 ? [{ n: followers, label: "followers" }] : [];
  if (!l) return { theme: "light", eye: "@" + host.handle, title: who, line: host.bio || "Launches on remmynd", big: "", stats: fans };
  const ph = phaseOf(l, now), v = launchView(host, l, "https://remmynd.space");
  const n = l.count ? await readCount(env, v.payload, { now, store: deps.counts }) : 0;
  return { theme: "light", eye: slug ? "Launch · @" + host.handle : "Next from @" + host.handle, title: l.title, line: whenText(l.start, l.tz, now),
    big: ph === "live" ? "Live now" : ph === "ended" ? "Ended" : inText(l.start - now), tone: ph === "live" ? "live" : ph === "ended" ? "quiet" : "",
    stats: [n ? { n, label: "saved" } : null, ...fans].filter(Boolean) };
}

export async function hostPageResponse(request, env, url, deps = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const parts = decodeURIComponent(url.pathname).replace(/^\/@/, "").split("/").filter(Boolean);
  const handle = parts[0] || "", slug = parts[1] || "";
  // One spelling: lowercase, no trailing slash.
  const asked = decodeURIComponent(url.pathname), lower = asked.toLowerCase().replace(/\/+$/, "");
  if (lower !== asked && /^\/@[a-z0-9_-]+(\/[a-z0-9-]+)?$/.test(lower)) return Response.redirect(url.origin + lower, 301);
  const missing = () => page(env, url, { status: 404, title: "Not found · remmynd", description: "There’s no page at this address.", canonical: url.origin + url.pathname, html: NOT_FOUND });
  if (!env.DB && !deps.store) return missing();
  const store = deps.store || d1Store(env.DB), now = deps.now || Date.now();
  await store.ready();
  const host = HANDLE.test(handle) ? await store.hostByHandle(handle) : null;
  if (!host || parts.length > 2) return missing();
  const launches = await store.launchesOf(host.user_id);
  const who = host.name || "@" + host.handle;
  // Pro: the host's colour, and no remmynd line. Free: remmynd's colours, and a line that says where the page came from.
  const plan = await planOf(env, store, host.user_id, now);
  const color = plan.pro && store.brandOf ? await store.brandOf(host.user_id) : "";
  const dress = html => '<div class="at-brand' + (BRAND_COLORS.includes(color) ? " at-c-" + color : "") + '">' + html +
    (plan.pro ? "" : '<p class="at-made"><a href="/launch">Made with remmynd. Make your own launch page</a></p>') + '</div>';
  if (!slug) {
    const next = launches.find(l => phaseOf(l, now) !== "ended");
    return page(env, url, { title: who + " · remmynd", canonical: url.origin + "/@" + host.handle, image: ogImageURL(url.origin, "/@" + host.handle, now),
      description: host.bio || (next ? "Next: " + next.title + ", " + whenText(next.start, next.tz, now) + ". Tap Remind me so you don't miss it." : "Launches by " + who + " on remmynd."),
      html: dress(hostHTML(host, launches, url.origin, now, store.followCount ? await store.followCount(host.user_id) : 0)) });
  }
  const l = launches.find(x => x.slug === slug);
  if (!l) {
    const gone = (await store.goneOf(host.user_id)).find(g => g.slug === slug);
    if (!gone) return missing();
    return page(env, url, { status: 410, title: gone.title + " was cancelled", canonical: url.origin + "/@" + host.handle + "/" + slug,
      description: who + " cancelled " + gone.title + ".",
      html: '<div class="at-missing"><p class="at-by"><a href="/@' + esc(host.handle) + '">' + esc(who) + '</a></p><h1>' + esc(gone.title) + ' was cancelled</h1><p>The host took it down. If you saved it, your reminder was cancelled too.</p><p><a class="btn ink" href="/@' + esc(host.handle) + '">See ' + esc(who) + '’s other launches</a></p></div>' });
  }
  const v = launchView(host, l, url.origin);
  const n = l.count ? await readCount(env, v.payload, { now, store: deps.counts }) : 0;
  const ph = phaseOf(l, now);
  return page(env, url, { title: l.title + " by " + who, canonical: v.url, image: ogImageURL(url.origin, "/@" + host.handle + "/" + l.slug, now),
    description: (ph === "live" ? "Live now. " : ph === "ended" ? "This launch has happened. " : "") + whenText(l.start, l.tz, now) + "." + (ph === "before" ? " Tap Remind me so you don't miss it." : ""),
    html: dress(launchHTML(host, l, v, now, { n, followers: store.followCount ? await store.followCount(host.user_id) : 0 })) });
}
