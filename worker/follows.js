// Follow: people follow a host once, and are told when the host announces a launch and when it goes live.
//
// A follower is an anonymous push address (a browser with notifications on), a signed-in account, or both. The host
// sees how many follow them, never who. Pushes stay empty, as for every alert: a woken device asks /api/follow/inbox
// for its own short notes (which launch, and whether it was announced or is live), and they're deleted once read.
// Waking followers goes through the every-minute ping sender (worker/push.js), so a big audience is reached over a
// few minutes, inside Cloudflare's limits. Signed-in followers can also choose email when they follow.
//
//   POST /api/follow { handle, endpoint?, email? }   follow (this site only)
//   POST /api/unfollow { handle, endpoint? }
//   POST /api/follow/state { handles, endpoint? }   which of these this device or account follows, and the counts
//   POST /api/follow/inbox { endpoint }             the notes waiting for this device (the service worker asks)
//   GET  /api/follow/feed?handles=a,b               public: the upcoming launches of these hosts (the iPhone app asks)
//   GET  /api/follow/stop?u=&h=&t=                  the link in a follow email: stop emails from that host
import { signedIn, d1Store, resendMailer, page, button } from "./account.js";
import { validEndpoint } from "./push.js";
import { HANDLE, launchView, whenText, phaseOf } from "./hosts.js";
import { escapeHTML as esc } from "./preview.js";
import { tally } from "./numbers.js";
import { planOf, FREE } from "./pro.js";

const DAY = 864e5;
/** The most followers one launch reaches, for now. Pro sets the real limits (step 6). */
export const MAX_REACH = 5000;
export const MAILS_PER_MINUTE = 40;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const whoOf = (endpoint, user) => endpoint ? "e:" + endpoint : "u:" + user.id;

async function readBody(request) {
  try { const b = JSON.parse((await request.text()).slice(0, 8192)); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}

/** Tell a host's followers about a launch: "announce" when it's published, "live" at its start. */
export async function tellFollowers(store, host, launch, kind, now, reach = MAX_REACH) {
  const followers = (await store.followersOf(host.user_id)).slice(0, Math.min(reach, MAX_REACH));
  const endpoints = [...new Set(followers.map(f => f.endpoint).filter(Boolean))];
  for (let i = 0; i < endpoints.length; i += 50) await store.addFollowMsgs(endpoints.slice(i, i + 50).map(endpoint => ({ id: "f" + rid(), endpoint, launch: launch.id, kind, at: now })));
  let mailed = 0;
  if (kind === "announce") {
    const mails = followers.filter(f => f.user_id && f.email).map(f => ({ id: "m" + rid(), user_id: f.user_id, launch: launch.id, at: now }));
    for (let i = 0; i < mails.length; i += 50) await store.addFollowMails(mails.slice(i, i + 50));
    mailed = mails.length;
  }
  return { pushed: endpoints.length, mailed };
}

/** Every minute: launches that just went live, told to their followers once. */
export async function followLive(env, now = Date.now(), deps = {}) {
  if (!env.DB && !deps.store) return { live: 0 };
  const store = deps.store || d1Store(env.DB);
  await store.ready();
  let live = 0;
  for (const l of await store.liveDue(now)) {
    await store.markLive(l.id, now);
    const plan = await planOf(env, store, l.user_id, now);
    await tellFollowers(store, { user_id: l.user_id, handle: l.handle, name: l.name }, l, "live", now, plan.limited ? FREE.reach : MAX_REACH);
    live++;
  }
  if (Math.floor(now / 60000) % 60 === 23) await store.cleanFollow(now);
  return { live };
}

/** "Maya Chen announced Orbit 2.0". Links only ever point at this site. */
export function followMail(host, l, url, stopUrl, now) {
  const who = host.name || "@" + host.handle, when = whenText(l.start, l.tz, now);
  return {
    subject: who + " announced " + l.title,
    text: [who + " announced " + l.title, when, "", "See it, and tap Remind me: " + url, "", "Stop emails from " + who + ": " + stopUrl, "remmynd by Zoof04 Inc."].join("\n"),
    html: page(who + " announced " + l.title, '<p style="color:#666C75;margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase">' + esc(who) + ' announced</p><h1 style="font-size:24px;margin:0 0 8px">' + esc(l.title) + '</h1><p style="margin:0">' + esc(when) + '</p>' +
      button(url, "See it, and tap Remind me") + '<p style="color:#666C75;font-size:13px"><a href="' + esc(stopUrl) + '" style="color:#666C75">Stop emails from ' + esc(who) + '</a></p>'),
    headers: { "List-Unsubscribe": "<" + stopUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
  };
}

/** Every minute: follow emails waiting, a few at a time. */
export async function sendFollowMails(env, now = Date.now(), deps = {}) {
  if ((!env.DB && !deps.store) || (!env.RESEND_API_KEY && !deps.mailer)) return { sent: 0 };
  const store = deps.store || d1Store(env.DB), mailer = deps.mailer || resendMailer(env), origin = deps.origin || "https://remmynd.space";
  await store.ready();
  let sent = 0;
  for (const m of await store.dueFollowMails(now, MAILS_PER_MINUTE)) {
    let done = true;
    const user = await store.userById(m.user_id), [l] = await store.launchesByIds([m.launch]);
    if (user && l && l.start > now) {
      const host = { user_id: l.user_id, handle: l.handle, name: l.name }, v = launchView(host, l, origin);
      const stop = origin + "/api/follow/stop?u=" + encodeURIComponent(user.id) + "&h=" + encodeURIComponent(l.handle) + "&t=" + encodeURIComponent(user.stop_token);
      const status = await mailer({ to: user.email, ...followMail(host, l, v.url, stop, now) }).catch(() => 0);
      if (status >= 200 && status < 300) sent++;
      else if (status === 0 || status === 429 || status >= 500) done = false;
    }
    if (done) await store.deleteFollowMail(m.id);
  }
  if (sent) await tally(env, "follow.mail", sent, now);
  return { sent };
}

export async function handleFollow(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Following isn't set up on this server." }, 503);
  const store = deps.store || d1Store(env.DB), now = deps.now || Date.now();
  await store.ready();
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/follow/feed") {
    const handles = [...new Set((url.searchParams.get("handles") || "").toLowerCase().split(",").filter(h => HANDLE.test(h)))].slice(0, 50);
    const launches = [];
    for (const h of handles) {
      const host = await store.hostByHandle(h);
      if (!host) continue;
      for (const l of await store.launchesOf(host.user_id)) if (phaseOf(l, now) !== "ended") {
        const v = launchView(host, l, url.origin);
        launches.push({ id: l.id, host: host.name || "@" + host.handle, handle: host.handle, title: l.title, start: l.start, dur: l.dur, url: v.url, dest: l.dest, link: v.link });
      }
    }
    return json({ launches: launches.sort((a, b) => a.start - b.start) });
  }
  if (path === "/api/follow/stop") {
    const u = url.searchParams.get("u") || "", h = (url.searchParams.get("h") || "").toLowerCase(), t = url.searchParams.get("t") || "";
    const user = /^[A-Za-z0-9_-]{8,64}$/.test(u) ? await store.userById(u) : null, host = HANDLE.test(h) ? await store.hostByHandle(h) : null;
    if (user && host && user.stop_token === t) await store.setFollowEmail(host.user_id, user.id, false);
    const who = host ? host.name || "@" + host.handle : "this host";
    return new Response(page("Emails stopped", '<h1 style="font-size:22px;margin:0 0 12px">No more emails from ' + esc(who) + '</h1><p>You still follow them where you turned on notifications. Unfollow on their page any time.</p>'),
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  }

  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const body = await readBody(request);
  const endpoint = validEndpoint(body.endpoint) ? body.endpoint : null;
  const s = await signedIn(request, store, now), user = s ? s.user : null;

  if (path === "/api/follow/inbox") {
    if (!endpoint) return json({ notes: [] });
    const msgs = await store.takeInbox(endpoint, now - DAY);
    const launches = new Map((await store.launchesByIds([...new Set(msgs.map(m => m.launch))])).map(l => [l.id, l]));
    const notes = [];
    for (const m of msgs) {
      const l = launches.get(m.launch);
      if (!l || (m.kind === "live" && phaseOf(l, now) === "ended")) continue;
      const host = { user_id: l.user_id, handle: l.handle, name: l.name }, v = launchView(host, l, url.origin), who = host.name || "@" + host.handle;
      notes.push(m.kind === "live" ? { title: l.title + " is live now", body: who + "'s launch just started. Tap to go.", url: l.dest || v.url, tag: "live:" + l.id }
        : { title: who + " announced " + l.title, body: whenText(l.start, l.tz, now) + ". Tap to see it and get reminded.", url: v.url, tag: "announce:" + l.id });
    }
    return json({ notes });
  }

  if (path === "/api/follow/state") {
    const handles = (Array.isArray(body.handles) ? body.handles : []).map(h => String(h).toLowerCase()).filter(h => HANDLE.test(h)).slice(0, 50);
    const mine = endpoint || user ? await store.followsBy(endpoint, user && user.id) : [];
    const out = {};
    for (const h of handles) {
      const host = await store.hostByHandle(h);
      if (!host) continue;
      const rows = mine.filter(f => f.host_id === host.user_id);
      out[h] = { following: rows.length > 0, email: rows.some(f => f.email), count: await store.followCount(host.user_id), ...(user && user.id === host.user_id ? { own: true } : {}) };
    }
    return json({ signedIn: !!user, hosts: out });
  }

  const handle = String(body.handle || "").toLowerCase().replace(/^@/, "");
  const host = HANDLE.test(handle) ? await store.hostByHandle(handle) : null;
  if (!host) return json({ error: "There's no host with that handle." }, 404);
  if (path === "/api/follow") {
    if (!endpoint && !user) return json({ error: "Turn on notifications, or sign in, to follow.", need: "signin" }, 400);
    if (user && user.id === host.user_id) return json({ error: "That's your own page." }, 400);
    if (endpoint) await store.putFollow({ host_id: host.user_id, who: whoOf(endpoint, null), endpoint, user_id: null, email: false, created: now });
    // With no notifications here, email is the only way to hear, so an account follow from such a browser asks for it.
    const email = !!user && (body.email === undefined ? !endpoint : !!body.email);
    if (user) await store.putFollow({ host_id: host.user_id, who: whoOf(null, user), endpoint: null, user_id: user.id, email, created: now });
    await tally(env, "follow.new", 1, now);
    return json({ following: true, email, signedIn: !!user, count: await store.followCount(host.user_id) });
  }
  if (path === "/api/unfollow") {
    if (endpoint) await store.deleteFollow(host.user_id, whoOf(endpoint, null));
    if (user) await store.deleteFollow(host.user_id, whoOf(null, user));
    await tally(env, "follow.end", 1, now);
    return json({ following: false, count: await store.followCount(host.user_id) });
  }
  return json({ error: "Not found." }, 404);
}
